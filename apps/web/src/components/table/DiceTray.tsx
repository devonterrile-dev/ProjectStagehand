import {
  describeFreeRoll,
  dieLabel,
  FREE_DICE,
  FREE_ROLL_COUNT_MAX,
  type FreeDie,
  type FreeRoll,
} from '@stagehand/shared';
import { useState } from 'react';

/** Each die's flat outline, in a 40 by 40 box, and where its number sits. */
const OUTLINES: Record<FreeDie, { points: string; textY: number }> = {
  4: { points: '20,4 37,35 3,35', textY: 29 },
  6: { points: '6,6 34,6 34,34 6,34', textY: 25 },
  8: { points: '20,3 37,20 20,37 3,20', textY: 25 },
  10: { points: '20,3 36,16 20,37 4,16', textY: 23 },
  100: { points: '20,3 36,16 20,37 4,16', textY: 23 },
  12: { points: '20,3 37,15 30,36 10,36 3,15', textY: 25 },
  20: { points: '20,2 36,11 36,29 20,38 4,29 4,11', textY: 25 },
};

const TONES = {
  /** On the sheet page at the table: paper and ink. */
  paper: {
    die: 'size-10 rounded text-stone-800 hover:bg-amber-100',
    picked: 'bg-amber-200 ring-2 ring-amber-600',
    field: 'w-14 rounded border border-stone-400 bg-white/70 px-1.5 py-0.5 text-lg',
    button:
      'rounded bg-amber-500 px-3 py-1 text-lg font-semibold shadow hover:bg-amber-400 disabled:opacity-60',
    text: 'text-lg',
    muted: 'text-stone-600',
    refusal: 'text-red-700',
  },
  /** In the GM's control desk. */
  desk: {
    die: 'size-8 rounded hover:bg-accent',
    picked: 'bg-accent ring-2 ring-primary',
    field: 'h-7 w-14 rounded border bg-transparent px-1.5 text-sm',
    button:
      'h-7 rounded bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60',
    text: 'text-sm',
    muted: 'text-muted-foreground',
    refusal: 'text-destructive',
  },
} as const;

export interface DiceTrayProps {
  /**
   * A roll to say under the tray: the GM's own last one, in the desk. The sheet page says none;
   * its rolls are tossed on the table (D-60).
   */
  shown?: FreeRoll | null;
  /** Asks the server to roll; answers a refusal in words, or null. */
  onRoll: (die: FreeDie, count: number, hidden: boolean) => Promise<string | null>;
  /** The GM may roll for their eyes only (19.20). */
  canHide?: boolean;
  tone: keyof typeof TONES;
}

/**
 * The dice tray (F4.2, governance §9 "Free rolls"): pick a die, how many, and **Roll N**. The
 * server rolls, and the dice are tossed on the table for everyone (D-60). Plain DOM with no
 * router or query context: on the sheet page it is drawn inside the 3D scene (drei `Html`).
 */
export function DiceTray({ shown = null, onRoll, canHide = false, tone }: DiceTrayProps) {
  const look = TONES[tone];
  const [die, setDie] = useState<FreeDie>(20);
  const [countText, setCountText] = useState('1');
  const [hidden, setHidden] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const count = Number(countText);
  const validCount = Number.isInteger(count) && count >= 1 && count <= FREE_ROLL_COUNT_MAX;

  async function roll() {
    if (!validCount) return;
    setRolling(true);
    setRefusal(null);
    const refused = await onRoll(die, count, canHide && hidden);
    setRolling(false);
    setRefusal(refused);
  }

  return (
    <div role="group" aria-label="Dice tray" className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {FREE_DICE.map((face) => {
          const outline = OUTLINES[face];
          return (
            <button
              key={face}
              type="button"
              aria-label={dieLabel(face)}
              aria-pressed={face === die}
              className={`${look.die} ${face === die ? look.picked : ''}`}
              onClick={() => {
                setDie(face);
              }}
            >
              <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
                <polygon
                  points={outline.points}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <text
                  x="20"
                  y={outline.textY}
                  textAnchor="middle"
                  fontSize={face === 100 ? 13 : 12}
                  fontWeight="600"
                  fill="currentColor"
                >
                  {face === 100 ? '%' : face}
                </text>
              </svg>
            </button>
          );
        })}
      </div>
      <div className={`flex flex-wrap items-center gap-2 ${look.text}`}>
        <input
          type="number"
          aria-label="How many dice"
          inputMode="numeric"
          min={1}
          max={FREE_ROLL_COUNT_MAX}
          step={1}
          className={look.field}
          value={countText}
          onChange={(event) => {
            setCountText(event.target.value);
          }}
        />
        <button
          type="button"
          className={look.button}
          disabled={!validCount || rolling}
          onClick={() => void roll()}
        >
          {rolling ? 'Rolling…' : `Roll ${validCount ? String(count) : 'N'}`}
        </button>
        {canHide && (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(event) => {
                setHidden(event.target.checked);
              }}
            />
            Private
          </label>
        )}
      </div>
      {!validCount && (
        <p className={`${look.text} ${look.refusal}`}>From 1 to {FREE_ROLL_COUNT_MAX} dice</p>
      )}
      {shown !== null && (
        <p
          role="status"
          aria-label="Dice result"
          className={`${look.text} font-semibold tabular-nums`}
        >
          {describeFreeRoll(shown)}
          {shown.private && <span className={look.muted}> (private)</span>}
        </p>
      )}
      {refusal !== null && (
        <p role="alert" className={`${look.text} ${look.refusal}`}>
          {refusal}
        </p>
      )}
    </div>
  );
}
