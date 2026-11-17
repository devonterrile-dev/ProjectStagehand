import { describeRoll, traitLabel, type LiveStage, type Ruleset } from '@stagehand/shared';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { rollTitle } from '@/lib/rolls';
import { TOSS_SECONDS } from '@/stage/dice';

/** How long a roll's result stays up once the dice have landed. */
export const ROLL_NOTICE_MS = 20_000;
/** How long a Fear spend is told. */
export const FEAR_NOTICE_MS = 8_000;

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

/**
 * What the table says in words over the theater (F3.6): a roll called for the player's own PC,
 * with the way to their sheet; who else is rolling; a roll's result once its dice have landed;
 * and a Fear spend, with the GM's reason.
 */
export function TableNotices({
  stage,
  ruleset,
  characterId,
  atSheet,
  onGoToSheet,
}: {
  stage: LiveStage;
  ruleset: Ruleset;
  /** The player's own PC; null for the GM or a player without one. */
  characterId: string | null;
  /** The player is looking at their sheet already. */
  atSheet: boolean;
  onGoToSheet: () => void;
}) {
  const roll = stage.lastRoll;
  // A hidden result shown later is told again.
  const rollKey = roll === null ? null : `${roll.id}:${String(roll.revealed)}`;
  const rollShown = useMoment(rollKey, TOSS_SECONDS * 1000, ROLL_NOTICE_MS);
  const spend = stage.lastFearSpend;
  const spendShown = useMoment(spend?.id ?? null, 0, FEAR_NOTICE_MS);

  const mine = stage.calls.find((call) => call.characterId === characterId) ?? null;
  // The GM's desk lists every call; a player is told who else is rolling.
  const others =
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
      {others.length > 0 && (
        <p className={CARD}>
          {others
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
      {spend !== null && spendShown && (
        <p role="status" className={`${CARD} bg-purple-950/90`}>
          The GM spends {spend.amount} Fear{spend.reason === null ? '' : `: ${spend.reason}`}
        </p>
      )}
    </div>
  );
}
