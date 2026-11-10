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
