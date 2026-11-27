/**
 * The control desk's rolls, Hope and Fear (F3.6, governance §9 and §12, D-54): calling a roll
 * for one or more PCs, the calls waiting, the last roll and its hidden result, the GM's Fear to
 * spend or correct, each PC's Hope to correct, and the session's log.
 */
import {
  describeRoll,
  type FreeRoll,
  DIFFICULTY_MAX,
  FEAR_REASON_MAX,
  ROLL_LABEL_MAX,
  traitLabel,
  type ActionResult,
  type GmStage,
  type RollEdge,
  type Ruleset,
} from '@stagehand/shared';
import { useState } from 'react';

import { Toggle } from '@/components/scenes/PlacementControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSessionLog } from '@/lib/queries';
import { EDGE_CHOICES, rollTitle } from '@/lib/rolls';
import type { PlayRoom } from '@/play/room';

import { DiceTray } from '@/components/table/DiceTray';

import { Section } from './DeskSection';

export type RollRoom = Pick<
  PlayRoom,
  | 'callRolls'
  | 'cancelRoll'
  | 'revealRoll'
  | 'spendFear'
  | 'setFear'
  | 'setHope'
  | 'setRest'
  | 'freeRoll'
>;

interface DeskPartProps {
  stage: GmStage;
  ruleset: Ruleset;
  room: RollRoom;
  /** Connected and not waiting on another action. */
  idle: boolean;
  /** Sends one action; a refusal is said at the top of the desk. */
  send: (action: () => Promise<ActionResult>) => Promise<void>;
}

/**
 * The GM's dice tray (F4.2): the same tray as a player's sheet page, plus Private, and the GM's
 * own last roll in words. Its refusals show in the tray, not at the top of the desk.
 */
export function DiceSection({
  room,
  userId,
  lastFreeRoll,
}: {
  room: Pick<RollRoom, 'freeRoll'>;
  userId: string | null;
  lastFreeRoll: FreeRoll | null;
}) {
  // A roll that was already there when the desk opened isn't said again.
  const [seenId] = useState(lastFreeRoll?.id ?? null);
  const mine =
    lastFreeRoll !== null && lastFreeRoll.userId === userId && lastFreeRoll.id !== seenId
      ? lastFreeRoll
      : null;
  return (
    <Section title="Dice">
      <DiceTray
        shown={mine}
        canHide
        tone="desk"
        onRoll={async (die, count, hidden) => {
          const result = await room.freeRoll(die, count, hidden);
          return result.ok ? null : result.message;
        }}
      />
    </Section>
  );
}

/** " (hidden, advantage)": what a waiting call has beyond its trait and difficulty. */
function callNotes(hidden: boolean, edge: RollEdge): string {
  const notes = [...(hidden ? ['hidden'] : []), ...(edge === 'none' ? [] : [edge])];
  return notes.length === 0 ? '' : ` (${notes.join(', ')})`;
}

/** Calling a roll, the calls waiting, and the last roll. */
export function RollsSection({ stage, ruleset, room, idle, send }: DeskPartProps) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [trait, setTrait] = useState(ruleset.traits[0]?.id ?? '');
  const [difficulty, setDifficulty] = useState('12');
  const [hidden, setHidden] = useState(false);
  const [label, setLabel] = useState('');
  // Advantage or disadvantage (F5.1): back to None after each call, since it fits one moment.
  const [edge, setEdge] = useState<RollEdge>('none');
  const hasEdges = ruleset.advantageDie !== undefined;

  // Only PCs still in the party can be picked.
  const party = stage.party;
  const chosen = party.filter((pc) => picked.has(pc.characterId)).map((pc) => pc.characterId);
  const everyone = party.length > 0 && chosen.length === party.length;
  const value = Number(difficulty);
  const validDifficulty = Number.isInteger(value) && value >= 1 && value <= DIFFICULTY_MAX;

  function pick(characterId: string, on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(characterId);
      else next.delete(characterId);
      return next;
    });
  }

  const roll = stage.lastRoll;
  return (
    <Section title="Rolls">
      {party.length === 0 ? (
        <p className="text-xs text-muted-foreground">No PC has a player yet.</p>
      ) : (
        <form
          aria-label="Call a roll"
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(async () => {
              const result = await room.callRolls({
                characterIds: chosen,
                trait,
                difficulty: value,
                hidden,
                ...(label.trim() === '' ? {} : { label: label.trim() }),
                ...(hasEdges ? { edge } : {}),
              });
              if (result.ok) setEdge('none');
              return result;
            });
          }}
        >
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted-foreground">Who rolls</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={everyone}
                onChange={(event) => {
                  setPicked(
                    event.target.checked ? new Set(party.map((pc) => pc.characterId)) : new Set(),
                  );
                }}
              />
              All
            </label>
            {party.map((pc) => (
              <label key={pc.characterId} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(pc.characterId)}
                  onChange={(event) => {
                    pick(pc.characterId, event.target.checked);
                  }}
                />
                <span className="truncate">
                  {pc.name} <span className="text-xs text-muted-foreground">({pc.playerName})</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <label className="flex-1 space-y-1">
              <span className="block text-xs text-muted-foreground">Trait</span>
              <select
                className="h-8 w-full rounded-md border bg-background px-2"
                value={trait}
                onChange={(event) => {
                  setTrait(event.target.value);
                }}
              >
                {ruleset.traits.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-20 space-y-1">
              <span className="block text-xs text-muted-foreground">Difficulty</span>
              <Input
                type="number"
                min={1}
                max={DIFFICULTY_MAX}
                className="h-8"
                value={difficulty}
                onChange={(event) => {
                  setDifficulty(event.target.value);
                }}
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="block text-xs text-muted-foreground">What for (optional)</span>
            <Input
              className="h-8"
              maxLength={ROLL_LABEL_MAX}
              placeholder="Climb the wall"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(event) => {
                setHidden(event.target.checked);
              }}
            />
            Hide the difficulty from players
          </label>
          {hasEdges && (
            <fieldset className="space-y-1">
              <legend className="text-xs text-muted-foreground">Edge</legend>
              {EDGE_CHOICES.map((choice) => (
                <label key={choice.edge} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="roll-edge"
                    checked={edge === choice.edge}
                    onChange={() => {
                      setEdge(choice.edge);
                    }}
                  />
                  {choice.label}
                </label>
              ))}
            </fieldset>
          )}
          <Button
            type="submit"
            size="sm"
            className="w-full"
            disabled={!idle || chosen.length === 0 || !validDifficulty}
          >
            Call roll
          </Button>
        </form>
      )}

      {stage.calls.length > 0 && (
        <ul aria-label="Waiting to roll" className="space-y-1">
          {stage.calls.map((call) => (
            <li key={call.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {call.characterName}: {traitLabel(ruleset, call.trait)} vs {call.difficulty}
                {callNotes(call.hidden, call.edge)}
              </span>
              <Button
                size="xs"
                variant="secondary"
                disabled={!idle}
                aria-label={`Cancel ${call.characterName}'s roll`}
                onClick={() => void send(() => room.cancelRoll(call.id))}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}

      {roll !== null && (
        <div aria-label="Last roll" className="space-y-1 rounded-md border px-2 py-2">
          <p className="font-medium">{rollTitle(roll, ruleset)}</p>
          <p className="text-xs">{describeRoll(roll)}</p>
          {roll.hidden && !roll.revealed && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Players don&apos;t see the result
              </span>
              <Button
                size="xs"
                disabled={!idle}
                onClick={() => void send(() => room.revealRoll(roll.id))}
              >
                Reveal result
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/** The GM's Fear: spend it, with a reason players see, or correct it. */
export function FearSection({ stage, room, idle, send }: Omit<DeskPartProps, 'ruleset'>) {
  const [amount, setAmount] = useState('1');
  const [reason, setReason] = useState('');
  const value = Number(amount);
  const validAmount = Number.isInteger(value) && value >= 1 && value <= stage.fear;

  return (
    <Section title="Fear">
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="secondary"
          aria-label="Lower Fear"
          disabled={!idle || stage.fear <= 0}
          onClick={() => void send(() => room.setFear(stage.fear - 1))}
        >
          −
        </Button>
        <span className="flex-1 text-center text-base font-semibold">
          {stage.fear} of {stage.fearCap}
        </span>
        <Button
          size="xs"
          variant="secondary"
          aria-label="Raise Fear"
          disabled={!idle || stage.fear >= stage.fearCap}
          onClick={() => void send(() => room.setFear(stage.fear + 1))}
        >
          +
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        − and + correct it. Spending it shows players.
      </p>
      <form
        aria-label="Spend Fear"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const why = reason.trim();
          void send(() => room.spendFear(value, why === '' ? undefined : why)).then(() => {
            setReason('');
          });
        }}
      >
        <Input
          type="number"
          aria-label="Fear to spend"
          min={1}
          max={stage.fearCap}
          className="h-8 w-14"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
        <Input
          aria-label="Why (optional)"
          placeholder="Why (optional)"
          maxLength={FEAR_REASON_MAX}
          className="h-8 min-w-0 flex-1"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <Button type="submit" size="sm" disabled={!idle || !validAmount}>
          Spend
        </Button>
      </form>
    </Section>
  );
}

/**
 * The Rest switch (F4.7, §9): while it is on, players move domain cards between their loadout and
 * vault free; while it is off, bringing one back marks its recall cost in Stress.
 */
export function RestSection({ stage, room, idle, send }: Omit<DeskPartProps, 'ruleset'>) {
  return (
    <Section title="Rest">
      <Toggle
        pressed={stage.rest}
        disabled={!idle}
        onChange={(rest) => void send(() => room.setRest(rest))}
      >
        {stage.rest ? 'Resting: card swaps are free' : 'Rest: make card swaps free'}
      </Toggle>
      <p className="text-xs text-muted-foreground">
        {stage.rest
          ? 'Players move domain cards between loadout and vault for free. Turn it off when the rest ends.'
          : 'Bringing a card back from the vault costs its recall cost in Stress.'}
      </p>
    </Section>
  );
}

/** Each PC's Hope, to correct. */
export function HopeSection({ stage, ruleset, room, idle, send }: DeskPartProps) {
  if (stage.party.length === 0) return null;
  return (
    <Section title="Hope">
      <ul className="space-y-1">
        {stage.party.map((pc) => (
          <li key={pc.characterId} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{pc.name}</span>
            <Button
              size="xs"
              variant="secondary"
              aria-label={`Lower ${pc.name}'s Hope`}
              disabled={!idle || pc.hope <= 0}
              onClick={() => void send(() => room.setHope(pc.characterId, pc.hope - 1))}
            >
              −
            </Button>
            <span className="w-10 text-center" aria-label={`${pc.name}'s Hope`}>
              {pc.hope}/{ruleset.hopeMax}
            </span>
            <Button
              size="xs"
              variant="secondary"
              aria-label={`Raise ${pc.name}'s Hope`}
              disabled={!idle || pc.hope >= ruleset.hopeMax}
              onClick={() => void send(() => room.setHope(pc.characterId, pc.hope + 1))}
            >
              +
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** The session's log, newest first: every roll, reveal, scene load, Fear spend and correction. */
export function LogSection({ campaignId }: { campaignId: string }) {
  const log = useSessionLog(campaignId);
  return (
    <Section title="Log">
      {log.isError && <p className="text-xs text-destructive">Could not read the log.</p>}
      {log.data?.length === 0 && <p className="text-xs text-muted-foreground">Nothing yet.</p>}
      <ol aria-label="Session log" className="max-h-64 space-y-1 overflow-y-auto text-xs">
        {log.data?.map((entry) => (
          <li key={entry.id}>
            <span className="text-muted-foreground">{time.format(new Date(entry.at))} </span>
            {entry.text}
            {entry.actorName === null ? (
              ''
            ) : (
              <span className="text-muted-foreground"> · {entry.actorName}</span>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}
