import {
  describeFreeRoll,
  describeRoll,
  dieLabel,
  traitLabel,
  type FreeRoll,
  type LiveStage,
  type Ruleset,
} from '@stagehand/shared';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { rollTitle } from '@/lib/rolls';
import { freeDiceLanded, freeDiceSeconds, TOSS_SECONDS } from '@/stage/dice';

/** How long a roll's result stays up once the dice have landed. */
export const ROLL_NOTICE_MS = 20_000;
/** How long a Fear spend is told. */
export const FEAR_NOTICE_MS = 8_000;
/** How long a free roll's result is told once its dice have landed (F4.2). */
export const FREE_ROLL_NOTICE_MS = 10_000;

/**
 * Whether something that happened at the table is being told right now: from `delayMs` after
 * `key` changes, for `forMs`. What was already there when the table opened is not told.
 */
function useMoment(key: string | null, delayMs: number, forMs: number): boolean {
  const [atStart] = useState(key);
  const [told, setTold] = useState<string | null>(null);
  useEffect(() => {
    if (key === null || key === atStart) return;
    const show = window.setTimeout(() => {
      setTold(key);
    }, delayMs);
    const hide = window.setTimeout(() => {
      setTold((current) => (current === key ? null : current));
    }, delayMs + forMs);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [key, atStart, delayMs, forMs]);
  return told !== null && told === key;
}

const CARD = 'rounded-md bg-black/80 px-3 py-2 text-sm text-white shadow-lg';

/** Whether the person asked for less motion; false where the browser can't say. */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A free roll from the dice tray (F4.2, D-60), told as its dice land on the table ("Vex rolls
 * 5d6: 5 + 3 + …"), then in full for a while. With reduced motion, in full at once.
 */
function FreeRollNotice({ roll }: { roll: FreeRoll }) {
  const count = roll.results.length;
  const [started] = useState(() => Date.now());
  const [quick] = useState(prefersReducedMotion);
  const playMs = quick ? 0 : freeDiceSeconds(count) * 1000;
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time - started >= playMs + FREE_ROLL_NOTICE_MS) window.clearInterval(timer);
    }, 100);
    return () => {
      window.clearInterval(timer);
    };
  }, [started, playMs]);

  const elapsed = now - started;
  if (elapsed >= playMs + FREE_ROLL_NOTICE_MS) return null;
  const landed = quick ? count : freeDiceLanded(count, elapsed / 1000);
  const dice = `${count > 1 ? String(count) : ''}${dieLabel(roll.die)}`;
  if (landed < count) {
    return (
      <div role="status" aria-label="Dice rolling" className={CARD}>
        <p className="font-semibold">
          {roll.rollerName} rolls {dice}
        </p>
        <p className="tabular-nums">
          {landed > 0 ? `${roll.results.slice(0, landed).join(' + ')} + …` : '…'}
        </p>
      </div>
    );
  }
  return (
    <div role="status" aria-label="Dice rolled" className={CARD}>
      <p className="font-semibold">
        {roll.rollerName} rolled {count > 1 ? dice : `a ${dice}`}
        {roll.private ? ', privately' : ''}
      </p>
      <p className="tabular-nums">{describeFreeRoll(roll)}</p>
    </div>
  );
}

/**
 * What the table says in words over the theater (F3.6): a roll called for the player's own PC,
 * with the way to their sheet; who else is rolling; a roll's result once its dice have landed;
 * a Fear spend, with the GM's reason; and (F4.2) someone else's free roll from the dice tray.
 */
export function TableNotices({
  stage,
  ruleset,
  characterId,
  atSheet,
  onGoToSheet,
  freeRoll,
}: {
  stage: LiveStage;
  ruleset: Ruleset;
  /** The player's own PC; null for the GM or a player without one. */
  characterId: string | null;
  /** The player is looking at their sheet already. */
  atSheet: boolean;
  onGoToSheet: () => void;
  /** The last free roll (F4.2): told to everyone who gets it, the roller too. */
  freeRoll: FreeRoll | null;
}) {
  const roll = stage.lastRoll;
  // A hidden result shown later is told again.
  const rollKey = roll === null ? null : `${roll.id}:${String(roll.revealed)}`;
  const rollShown = useMoment(rollKey, TOSS_SECONDS * 1000, ROLL_NOTICE_MS);
  const spend = stage.lastFearSpend;
  const spendShown = useMoment(spend?.id ?? null, 0, FEAR_NOTICE_MS);
  // A free roll that was there when the table opened isn't told again.
  const [freeAtStart] = useState(freeRoll?.id ?? null);
  const fresh = freeRoll !== null && freeRoll.id !== freeAtStart ? freeRoll : null;

  const mine = stage.calls.find((call) => call.characterId === characterId) ?? null;
  // The GM's desk lists every call; a player is told who else is rolling.
  const othersRolling =
    stage.role === 'player' ? stage.calls.filter((call) => call.characterId !== characterId) : [];

  return (
    <div className="pointer-events-none absolute top-14 left-1/2 z-20 flex w-[min(28rem,90%)] -translate-x-1/2 flex-col items-center gap-2">
      {mine !== null && !atSheet && (
        <div role="status" className={`${CARD} pointer-events-auto flex items-center gap-3`}>
          <span>
            The GM calls for a roll: {traitLabel(ruleset, mine.trait)}
            {mine.label === null ? '' : `, ${mine.label}`}
          </span>
          <Button size="xs" onClick={onGoToSheet}>
            Go to sheet
          </Button>
        </div>
      )}
      {othersRolling.length > 0 && (
        <p className={CARD}>
          {othersRolling
            .map((call) => `${call.characterName} is rolling ${traitLabel(ruleset, call.trait)}`)
            .join(' · ')}
          …
        </p>
      )}
      {roll !== null && rollShown && (
        <div role="status" aria-label="Roll result" className={CARD}>
          <p className="font-semibold">{rollTitle(roll, ruleset)}</p>
          <p>{describeRoll(roll)}</p>
        </div>
      )}
      {fresh !== null && <FreeRollNotice key={fresh.id} roll={fresh} />}
      {spend !== null && spendShown && (
        <p role="status" className={`${CARD} bg-purple-950/90`}>
          The GM spends {spend.amount} Fear{spend.reason === null ? '' : `: ${spend.reason}`}
        </p>
      )}
    </div>
  );
}
