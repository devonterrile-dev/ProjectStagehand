import { MinusIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { FieldError } from '@/components/FieldError';

/**
 * The player's tracks drawn as on the paper sheet (D-67): bubbles for Hope, HP, Stress and armor
 * slots, the damage thresholds as a strip, and Evasion and Armor as badges. With `onSet` the
 * bubbles are buttons: a bubble sets the track to it, and the last filled one lowers it by one.
 */

export type PipTone = 'hope' | 'hp' | 'stress' | 'armor';

const FILLED: Record<PipTone, string> = {
  hope: 'border-amber-600 bg-amber-400',
  hp: 'border-emerald-700 bg-emerald-500',
  stress: 'border-red-700 bg-red-500',
  armor: 'border-stone-600 bg-stone-400',
};
const EMPTY: Record<PipTone, string> = {
  hope: 'border-amber-600',
  hp: 'border-emerald-700',
  stress: 'border-red-700',
  armor: 'border-stone-500',
};

/** Sets one track; resolves once saved, or throws with the refusal. */
export type SetTrack = (value: number) => Promise<unknown>;

export function Pips({
  label,
  value,
  max,
  tone,
  onSet,
}: {
  label: string;
  value: number;
  max: number;
  tone: PipTone;
  onSet?: SetTrack;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: number) {
    if (onSet === undefined || next < 0 || next > max || next === value) return;
    setBusy(true);
    setError(null);
    try {
      await onSet(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const bubble = (index: number) => {
    const filled = index < value;
    const className = `inline-block size-5 rounded-full border-2 ${filled ? FILLED[tone] : EMPTY[tone]}`;
    if (onSet === undefined) return <span key={index} aria-hidden className={className} />;
    // The last filled bubble lowers the track by one; any other sets it to that bubble.
    const lowers = index + 1 === value;
    const target = lowers ? value - 1 : index + 1;
    return (
      <button
        key={index}
        type="button"
        aria-label={`${lowers ? 'Lower' : 'Set'} ${label} to ${String(target)}`}
        disabled={busy}
        className={`${className} cursor-pointer transition-transform hover:scale-110 disabled:cursor-wait`}
        onClick={() => void set(target)}
      />
    );
  };

  const step = (delta: 1 | -1) => (
    <button
      type="button"
      aria-label={`${delta > 0 ? 'Raise' : 'Lower'} ${label}`}
      disabled={busy || value + delta < 0 || value + delta > max}
      className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-40"
      onClick={() => void set(value + delta)}
    >
      {delta > 0 ? (
        <PlusIcon className="size-4" aria-hidden />
      ) : (
        <MinusIcon className="size-4" aria-hidden />
      )}
    </button>
  );

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-14 text-sm font-semibold">{label}</span>
        {onSet !== undefined && step(-1)}
        <span
          role="img"
          aria-label={`${label}: ${String(value)} of ${String(max)}`}
          className="flex flex-wrap gap-1"
        >
          {Array.from({ length: max }, (_, index) => bubble(index))}
          {max === 0 && <span className="text-sm text-muted-foreground">none</span>}
        </span>
        {onSet !== undefined && step(1)}
        <span className="text-sm text-muted-foreground">
          {value} of {max}
        </span>
      </div>
      <FieldError message={error} />
    </div>
  );
}

/**
 * The damage thresholds as on the paper sheet: Minor, Major and Severe damage with the HP each
 * marks, and the numbers between them where one becomes the next.
 */
export function ThresholdStrip({
  minor,
  major,
  severe,
}: {
  minor: number | null;
  major: number;
  severe: number;
}) {
  const box = (name: string, marks: number) => (
    <div className="flex-1 rounded-md bg-stone-800 px-2 py-1.5 text-center text-stone-50">
      <p className="text-xs leading-tight font-bold tracking-wide uppercase">{name}</p>
      <p className="text-[0.7rem] leading-tight text-stone-300">Mark {marks} HP</p>
    </div>
  );
  const number = (value: number, label: string) => (
    <div
      aria-label={`${label} threshold: ${String(value)}`}
      className="flex min-w-10 items-center justify-center rounded-md border-2 border-stone-800 bg-card px-2 text-2xl font-bold tabular-nums"
    >
      {value}
    </div>
  );
  return (
    <div role="group" aria-label="Damage thresholds" className="flex items-stretch gap-1.5">
      {minor !== null && number(minor, 'Minor')}
      {box('Minor damage', 1)}
      {number(major, 'Major')}
      {box('Major damage', 2)}
      {number(severe, 'Severe')}
      {box('Severe damage', 3)}
    </div>
  );
}

/** A shield-shaped badge with a big number: Evasion or Armor. */
function Badge({ label, value, note }: { label: string; value: number; note?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        aria-label={`${label}: ${String(value)}`}
        className="relative flex h-20 w-16 items-center justify-center border-2 border-stone-700 bg-card text-3xl font-bold tabular-nums shadow-sm"
        style={{ borderRadius: '0.6rem 0.6rem 50% 50% / 0.6rem 0.6rem 40% 40%' }}
      >
        {value}
      </div>
      <span className="rounded bg-stone-800 px-2 py-0.5 text-xs font-bold tracking-wide text-stone-50 uppercase">
        {label}
      </span>
      {note != null && note !== '' && (
        <span className="max-w-24 truncate text-xs text-muted-foreground">{note}</span>
      )}
    </div>
  );
}

/** Evasion and Armor as badges side by side, and the armor slots as grey bubbles under them. */
export function DefenseBadges({
  evasion,
  armorScore,
  armorName,
  slotsMarked,
  slotsMax,
  onSetSlots,
}: {
  evasion: number;
  armorScore: number;
  armorName: string | null;
  slotsMarked: number;
  slotsMax: number;
  onSetSlots?: SetTrack;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-6">
        <Badge label="Evasion" value={evasion} />
        <Badge label="Armor" value={armorScore} note={armorName} />
      </div>
      <Pips
        label="Armor slots"
        value={slotsMarked}
        max={slotsMax}
        tone="armor"
        onSet={onSetSlots}
      />
    </div>
  );
}
