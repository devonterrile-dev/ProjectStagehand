import {
  PAINT_COLORS,
  PAINT_SIZE_NAMES,
  type ActionResult,
  type PaintColor,
  type PaintSize,
} from '@stagehand/shared';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import type { MatBrush, MatTool } from '@/stage/MatPaint';
import { PAINT_HEX } from '@/stage/paint';

const TOOL_LABELS: Record<MatTool, string> = {
  move: 'Move tokens',
  paint: 'Paint',
  erase: 'Erase',
};
const TOOLS: readonly MatTool[] = ['move', 'paint', 'erase'];

const COLOR_LABELS: Record<PaintColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  black: 'Black',
};

const SIZE_LABELS: Record<PaintSize, string> = { fine: 'Fine', medium: 'Medium', broad: 'Broad' };

/** How big each size's dot is drawn on its button, in pixels. */
const SIZE_DOTS: Record<PaintSize, number> = { fine: 4, medium: 8, broad: 14 };

/**
 * The GM's paint panel (F5.6, governance §12 "Battle mode"), beside the mat at the left edge of
 * the GM's view while a battle is on: what a drag on the mat does (move tokens, paint, rub
 * out), the paint's color and the brush's size, Undo for the last stroke, and Clear, which asks
 * first. The brush is the GM's own, kept in the page.
 */
export function PaintPanel({
  brush,
  onBrushChange,
  disabled,
  onUndo,
  onClear,
}: {
  brush: MatBrush;
  onBrushChange: (brush: MatBrush) => void;
  /** Nothing can be sent: the connection is down. */
  disabled: boolean;
  onUndo: () => Promise<ActionResult>;
  onClear: () => Promise<ActionResult>;
}) {
  const [clearing, setClearing] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function send(action: () => Promise<ActionResult>) {
    setRefusal(null);
    const result = await action();
    if (!result.ok) setRefusal(result.message);
  }

  return (
    <section
      aria-label="Paint"
      className="absolute top-1/2 left-3 z-20 w-36 -translate-y-1/2 space-y-3 rounded-md bg-black/70 p-2.5 text-xs text-white"
    >
      <div role="radiogroup" aria-label="Tool" className="space-y-1">
        {TOOLS.map((tool) => (
          <Button
            key={tool}
            size="xs"
            role="radio"
            aria-checked={brush.tool === tool}
            variant={brush.tool === tool ? 'default' : 'secondary'}
            className="w-full justify-start"
            onClick={() => {
              onBrushChange({ ...brush, tool });
            }}
          >
            {TOOL_LABELS[tool]}
          </Button>
        ))}
      </div>

      <div role="group" aria-label="Color" className="grid grid-cols-3 gap-1.5">
        {PAINT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={COLOR_LABELS[color]}
            aria-pressed={brush.color === color}
            className={`h-6 rounded-full border-2 ${brush.color === color ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: PAINT_HEX[color] }}
            onClick={() => {
              // Picking a color picks up the brush.
              onBrushChange({ ...brush, color, tool: 'paint' });
            }}
          />
        ))}
      </div>

      <div role="group" aria-label="Brush size" className="grid grid-cols-3 gap-1.5">
        {PAINT_SIZE_NAMES.map((size) => (
          <button
            key={size}
            type="button"
            aria-label={SIZE_LABELS[size]}
            aria-pressed={brush.size === size}
            className={`flex h-7 items-center justify-center rounded-md ${brush.size === size ? 'bg-white/30' : 'bg-white/10'}`}
            onClick={() => {
              onBrushChange({ ...brush, size });
            }}
          >
            <span
              aria-hidden
              className="rounded-full bg-white"
              style={{ width: SIZE_DOTS[size], height: SIZE_DOTS[size] }}
            />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="xs"
          variant="secondary"
          disabled={disabled}
          aria-keyshortcuts="Control+Z"
          onClick={() => void send(onUndo)}
        >
          Undo
        </Button>
        <Button
          size="xs"
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            setClearing(true);
          }}
        >
          Clear
        </Button>
      </div>

      {refusal !== null && (
        <p role="alert" className="text-red-200">
          {refusal}
        </p>
      )}

      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title="Clear the paint?"
        description="Every stroke on the mat goes, for everyone. The tokens stay where they are."
        confirmLabel="Clear the paint"
        onConfirm={async () => {
          const result = await onClear();
          if (!result.ok) throw new Error(result.message);
        }}
      />
    </section>
  );
}
