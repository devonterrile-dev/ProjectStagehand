import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom has no layout. ProseMirror (behind TipTap) asks for these when it focuses the
// editor or places the cursor; zero-sized answers are enough for it to carry on.
const zeroRect = (): DOMRect => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
});
const noRects = (): DOMRectList => ({
  length: 0,
  item: () => null,
  [Symbol.iterator]: [][Symbol.iterator],
});

Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = zeroRect;
document.elementFromPoint = () => null;
Element.prototype.scrollIntoView = () => undefined;

// Inserting a mention calls `getSelection().collapseToEnd()` (@tiptap/extension-mention).
// In a browser the focused editor always has a selection; in jsdom it can be empty,
// depending on timing (it was on CI), and jsdom then throws "There is no selection to
// collapse" as an uncaught error that fails the run. With no selection there is nothing to
// collapse, so do nothing.
for (const method of ['collapseToEnd', 'collapseToStart'] as const) {
  const original = Object.getOwnPropertyDescriptor(Selection.prototype, method)?.value as (
    this: Selection,
  ) => void;
  Selection.prototype[method] = function (this: Selection) {
    if (this.rangeCount > 0) original.call(this);
  };
}
