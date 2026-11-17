import {
  signed,
  traitLabel,
  type PlayerCharacterSheet,
  type RollCall,
  type Ruleset,
} from '@stagehand/shared';
import { useState } from 'react';

import { CharacterSheetView } from '@/components/sheets/CharacterSheetView';

import { PAPER_CLASS } from './InspectPapers';

interface SheetPaperProps {
  /** Undefined while it loads; null when the sheet can't be read. */
  sheet: PlayerCharacterSheet | null | undefined;
  ruleset: Ruleset;
  /** The roll called for this PC, waiting; null for none. */
  call: RollCall | null;
  /** Rolls the call. Answers why it was refused, or null once it is rolled. */
  onRoll: (spendHope: boolean) => Promise<string | null>;
  onBack: () => void;
}

/** Hope as pips: one filled for each Hope held, out of the most a PC can hold. */
function HopePips({ hope, max }: { hope: number; max: number }) {
  return (
    <p className="flex items-center gap-2" aria-label={`Hope: ${String(hope)} of ${String(max)}`}>
      <span className="text-lg font-semibold">Hope</span>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={`inline-block size-5 rounded-full border-2 border-amber-700 ${i < hope ? 'bg-amber-400' : 'bg-transparent'}`}
        />
      ))}
    </p>
  );
}

/**
 * The player's sheet page on the table (F3.6, governance §12 "The sheet page"): their PC's
 * sheet as paper, with their Hope as pips at the top and, while the GM has called a roll for
 * them, the roll to make: the trait and its modifier, the difficulty unless it is hidden, Spend
 * Hope for the bonus, and Roll. Plain DOM with no router or query context: it is drawn inside
 * the 3D scene (drei `Html`).
 */
export function SheetPaper({ sheet, ruleset, call, onRoll, onBack }: SheetPaperProps) {
  const [spendHope, setSpendHope] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const hope = sheet?.hope ?? 0;
  const canSpend = hope > 0;

  async function roll() {
    setRolling(true);
    setRefusal(null);
    const refused = await onRoll(spendHope && canSpend);
    setRolling(false);
    setRefusal(refused);
    if (refused === null) setSpendHope(false);
  }

  return (
    <section
      aria-label="Your sheet"
      className={`${PAPER_CLASS} paper-light flex h-full w-full flex-col gap-3 rounded-sm px-7 pt-5 pb-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-3xl font-semibold">{sheet?.name ?? 'Your sheet'}</h2>
          {sheet != null && (
            <p className="text-stone-700">
              Level {sheet.level}
              {sheet.className === '' ? '' : ` · ${sheet.className}`}
            </p>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 rounded px-2 py-1 text-lg underline-offset-4 hover:underline"
          aria-label="Put the sheet down"
          onClick={onBack}
        >
          ✕ Back
        </button>
      </div>

      {sheet != null && <HopePips hope={hope} max={ruleset.hopeMax} />}

      {call !== null && sheet != null && (
        <div
          role="group"
          aria-label="Called roll"
          className="space-y-2 rounded-md border-2 border-amber-600 bg-amber-50 px-4 py-3"
        >
          <p className="text-sm tracking-wide text-amber-800 uppercase">The GM calls for a roll</p>
          <p className="text-2xl font-semibold">
            {traitLabel(ruleset, call.trait)} {signed(sheet.traits[call.trait] ?? 0)}
            {call.label === null ? '' : ` · ${call.label}`}
          </p>
          <p className="text-lg">
            {call.difficulty === null
              ? 'Difficulty hidden'
              : `Difficulty ${String(call.difficulty)}`}
          </p>
          <label className="flex items-center gap-2 text-lg">
            <input
              type="checkbox"
              className="size-5 accent-amber-600"
              checked={spendHope && canSpend}
              disabled={!canSpend || rolling}
              onChange={(event) => {
                setSpendHope(event.target.checked);
              }}
            />
            Spend 1 Hope for +{ruleset.hopeSpendBonus}
            {!canSpend && <span className="text-sm text-stone-600">(no Hope to spend)</span>}
          </label>
          <button
            type="button"
            data-autofocus
            className="w-full rounded bg-amber-500 px-4 py-2 text-xl font-semibold shadow hover:bg-amber-400 disabled:opacity-60"
            disabled={rolling}
            onClick={() => void roll()}
          >
            {rolling ? 'Rolling…' : 'Roll'}
          </button>
          {refusal !== null && (
            <p role="alert" className="text-red-700">
              {refusal}
            </p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto font-sans">
        {sheet === undefined && <p className="text-stone-600">Picking up your sheet…</p>}
        {sheet === null && (
          <p className="text-stone-600">Your sheet can&apos;t be read right now.</p>
        )}
        {sheet != null && <CharacterSheetView sheet={sheet} ruleset={ruleset} />}
      </div>
    </section>
  );
}
