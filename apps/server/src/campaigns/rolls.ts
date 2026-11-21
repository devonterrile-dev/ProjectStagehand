/**
 * Called rolls, Hope and Fear in a live session (F3.6, governance §9, D-54). Part of the
 * campaign data-access layer: every query is scoped to `scope.campaignId`.
 *
 * Every change holds the running session's row (`lockRunning`), and a change to a PC's Hope also
 * holds that PC's row, so two rolls or a roll and a correction can't lose each other's Hope or
 * Fear. The dice come from the caller (`RollDie`) and the rules from the shared engine, so
 * nothing here decides an outcome.
 *
 * What a change did beyond the stage is returned for the live room to pass on: the PCs whose
 * sheets changed, so their players read them again.
 */
import {
  describeFreeRoll,
  describeRoll,
  partyMemberSchema,
  resolveActionRoll,
  rollCallSchema,
  rollResultSchema,
  rulesetFor,
  sessionLogEntrySchema,
  setFear,
  setHope,
  spendFear,
  traitIdsOf,
  traitLabel,
  type FearSpend,
  type PartyMember,
  type RollCall,
  type RollResult,
  type Ruleset,
  type SessionLogEntry,
  type SessionLogKind,
} from '@stagehand/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/client';
import {
  campaignMembers,
  characters,
  playRollCalls,
  playSessions,
  records,
  sessionEvents,
  users,
} from '../db/schema';
import { httpError } from '../http/errors';
import { shownName } from '../users/profile';

import { freeRollEventSchema } from './free-rolls';
import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';
import { lockRunning, logEvent, running, type SessionRow } from './session-core';

/** Rolls one d12, 1 to 12. The live room's is `crypto.randomInt`; tests pass their own. */
export type RollDie = () => number;

const NO_CALL = 'That roll is no longer called';
const NO_ROLL = 'That roll is not in this session';

/** What a `roll` event keeps (its `data`): everything the roll was and how it came out. */
const rollEventSchema = z.object({
  characterId: z.uuid(),
  characterName: z.string(),
  trait: z.string(),
  label: z.string().nullable(),
  difficulty: z.int(),
  hidden: z.boolean(),
  dice: z.object({ hope: z.int(), fear: z.int() }),
  modifier: z.int(),
  hopeBonus: z.int(),
  total: z.int(),
  critical: z.boolean(),
  success: z.boolean(),
  gained: z.enum(['hope', 'fear']),
  /** The PC's Hope and the GM's Fear after it. */
  hope: z.int(),
  fear: z.int(),
});
type RollEvent = z.infer<typeof rollEventSchema>;

const fearSpendEventSchema = z.object({
  amount: z.int(),
  reason: z.string().nullable(),
  from: z.int(),
  to: z.int(),
});
const fearAdjustEventSchema = z.object({ from: z.int(), to: z.int() });
const hopeAdjustEventSchema = z.object({
  characterId: z.uuid(),
  characterName: z.string(),
  from: z.int(),
  to: z.int(),
});
const rollRevealEventSchema = z.object({ rollId: z.uuid() });
const sceneLoadEventSchema = z.object({ name: z.string() });

function rulesetOf(scope: CampaignScope): Ruleset {
  return rulesetFor(scope.campaign.rulesetVersion);
}

/** The PCs that have a player, with who plays them, by PC name. */
async function partyRows(db: DbOrTx, scope: CampaignScope, characterIds?: readonly string[]) {
  return db
    .select({
      characterId: characters.id,
      name: characters.name,
      hope: characters.hope,
      userName: users.name,
      displayName: users.displayName,
    })
    .from(campaignMembers)
    .innerJoin(
      characters,
      and(
        eq(characters.id, campaignMembers.characterId),
        eq(characters.campaignId, campaignMembers.campaignId),
      ),
    )
    .innerJoin(users, eq(users.id, campaignMembers.userId))
    .where(
      and(
        eq(campaignMembers.campaignId, scope.campaignId),
        characterIds === undefined ? undefined : inArray(characters.id, [...characterIds]),
      ),
    )
    .orderBy(asc(characters.name));
}

/**
 * Calls a roll for one or more PCs (§13 `roll:call`): each gets its own call, replacing one
 * still waiting. Every PC must have a player, who is the one to roll it.
 */
export async function callRolls(
  db: Database,
  scope: CampaignScope,
  request: {
    characterIds: readonly string[];
    trait: string;
    difficulty: number;
    hidden: boolean;
    label?: string | undefined;
  },
): Promise<void> {
  if (!traitIdsOf(rulesetOf(scope)).includes(request.trait)) {
    throw httpError(400, 'Choose one of the traits');
  }
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    const party = await partyRows(tx, scope, request.characterIds);
    if (party.length !== request.characterIds.length) {
      throw httpError(404, 'Choose PCs that have a player');
    }
    await tx
      .delete(playRollCalls)
      .where(
        and(
          eq(playRollCalls.playSessionId, session.id),
          inArray(playRollCalls.characterId, [...request.characterIds]),
        ),
      );
    await tx.insert(playRollCalls).values(
      request.characterIds.map((characterId) => ({
        playSessionId: session.id,
        campaignId: scope.campaignId,
        characterId,
        trait: request.trait,
        difficulty: request.difficulty,
        difficultyHidden: request.hidden,
        label: request.label ?? null,
        calledBy: scope.userId,
      })),
    );
  });
}

/** Takes back a call nobody has rolled (§13 `roll:cancel`). */
export async function cancelRollCall(
  db: Database,
  scope: CampaignScope,
  callId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    const removed = await tx
      .delete(playRollCalls)
      .where(and(eq(playRollCalls.id, callId), eq(playRollCalls.playSessionId, session.id)))
      .returning({ id: playRollCalls.id });
    if (removed.length === 0) throw httpError(404, NO_CALL);
  });
}

/**
 * A player makes the roll called for their own PC (§9, §13 `roll:make`): the server rolls the
 * Hope die and the Fear die, the engine resolves them, and the PC's Hope, the GM's Fear, the
 * call and the log change together. Answers the PC whose sheet changed.
 */
export async function makeRoll(
  db: Database,
  scope: CampaignScope,
  request: { callId: string; spendHope: boolean },
  rollDie: RollDie,
): Promise<{ characterId: string }> {
  return db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    const [call] = await tx
      .select()
      .from(playRollCalls)
      .where(
        and(eq(playRollCalls.id, request.callId), eq(playRollCalls.playSessionId, session.id)),
      );
    if (call === undefined) throw httpError(404, NO_CALL);

    const [member] = await tx
      .select({ characterId: campaignMembers.characterId })
      .from(campaignMembers)
      .where(
        and(
          eq(campaignMembers.campaignId, scope.campaignId),
          eq(campaignMembers.userId, scope.userId),
        ),
      );
    if (member?.characterId !== call.characterId) {
      throw httpError(403, 'That roll is for another player');
    }

    const [pc] = await tx
      .select({
        name: characters.name,
        hope: characters.hope,
        hopeBonus: characters.hopeBonus,
        traits: characters.traits,
      })
      .from(characters)
      .where(and(eq(characters.id, call.characterId), eq(characters.campaignId, scope.campaignId)))
      .for('update');
    if (pc === undefined) throw httpError(404, NO_CALL);

    const ruleset = rulesetOf(scope);
    const modifier = pc.traits[call.trait] ?? 0;
    const dice = { hope: rollDie(), fear: rollDie() };
    const result = resolveActionRoll({
      dice,
      modifier,
      difficulty: call.difficulty,
      spendHope: request.spendHope,
      pcHopeBonus: pc.hopeBonus,
      hope: pc.hope,
      fear: session.fear,
      ruleset,
    });
    if (!result.ok) {
      if (result.reason === 'NO_HOPE') throw httpError(409, 'You have no Hope to spend');
      throw new Error('the dice were not d12 faces');
    }

    if (result.hope !== pc.hope) {
      await tx
        .update(characters)
        .set({ hope: result.hope })
        .where(
          and(eq(characters.id, call.characterId), eq(characters.campaignId, scope.campaignId)),
        );
    }
    if (result.fear !== session.fear) {
      await tx
        .update(playSessions)
        .set({ fear: result.fear })
        .where(eq(playSessions.id, session.id));
    }
    await tx.delete(playRollCalls).where(eq(playRollCalls.id, call.id));

    const event: RollEvent = {
      characterId: call.characterId,
      characterName: pc.name,
      trait: call.trait,
      label: call.label,
      difficulty: call.difficulty,
      hidden: call.difficultyHidden,
      dice,
      modifier,
      hopeBonus: result.hopeBonus,
      total: result.total,
      critical: result.critical,
      success: result.success,
      gained: result.gained,
      hope: result.hope,
      fear: result.fear,
    };
    await logEvent(tx, scope, session, 'roll', { actorUserId: scope.userId, data: event });
    return { characterId: call.characterId };
  });
}

/** A `roll` event of the running session, or 404. */
async function rollOf(tx: DbOrTx, session: SessionRow, rollId: string): Promise<RollEvent> {
  const [row] = await tx
    .select({ data: sessionEvents.data })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.id, rollId),
        eq(sessionEvents.playSessionId, session.id),
        eq(sessionEvents.kind, 'roll'),
      ),
    );
  const roll = rollEventSchema.safeParse(row?.data);
  if (!roll.success) throw httpError(404, NO_ROLL);
  return roll.data;
}

/** Shows players the result of a hidden roll (§9 step 7, 19.3). Once is enough. */
export async function revealRoll(db: Database, scope: CampaignScope, rollId: string) {
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    const roll = await rollOf(tx, session, rollId);
    if (!roll.hidden) throw httpError(409, "That roll's difficulty wasn't hidden");
    if (await isRevealed(tx, session, rollId)) return;
    await logEvent(tx, scope, session, 'roll_reveal', {
      actorUserId: scope.userId,
      data: { rollId },
    });
  });
}

async function isRevealed(db: DbOrTx, session: { id: string }, rollId: string): Promise<boolean> {
  const [found] = await db
    .select({ id: sessionEvents.id })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.playSessionId, session.id),
        eq(sessionEvents.kind, 'roll_reveal'),
        sql`${sessionEvents.data}->>'rollId' = ${rollId}`,
      ),
    )
    .limit(1);
  return found !== undefined;
}

/** The GM spends Fear (§9 "Fear"): every table sees the bowl lose it, with the reason if any. */
export async function spendFearLive(
  db: Database,
  scope: CampaignScope,
  request: { amount: number; reason?: string | undefined },
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    const to = spendFear(session.fear, request.amount);
    if (to === null) {
      throw httpError(409, `There is only ${String(session.fear)} Fear to spend`);
    }
    await tx.update(playSessions).set({ fear: to }).where(eq(playSessions.id, session.id));
    await logEvent(tx, scope, session, 'fear_spend', {
      actorUserId: scope.userId,
      data: { amount: request.amount, reason: request.reason ?? null, from: session.fear, to },
    });
  });
}

/** The GM corrects Fear (§9: "as a correction"); logged, and nothing when it doesn't change. */
export async function setFearLive(db: Database, scope: CampaignScope, fear: number) {
  const ruleset = rulesetOf(scope);
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    const to = setFear(fear, ruleset);
    if (to === null) throw httpError(400, `Fear is from 0 to ${String(ruleset.fearCap)}`);
    if (to === session.fear) return;
    await tx.update(playSessions).set({ fear: to }).where(eq(playSessions.id, session.id));
    await logEvent(tx, scope, session, 'fear_adjust', {
      actorUserId: scope.userId,
      data: { from: session.fear, to },
    });
  });
}

/**
 * The GM corrects a PC's Hope during a session; logged. Answers the PC when its sheet changed,
 * null when the value was already that.
 */
export async function setHopeLive(
  db: Database,
  scope: CampaignScope,
  request: { characterId: string; hope: number },
): Promise<{ characterId: string } | null> {
  const ruleset = rulesetOf(scope);
  return db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    const where = and(
      eq(characters.id, request.characterId),
      eq(characters.campaignId, scope.campaignId),
    );
    const [pc] = await tx
      .select({ name: characters.name, hope: characters.hope })
      .from(characters)
      .where(where)
      .for('update');
    if (pc === undefined) throw httpError(404, 'PC not found');
    const to = setHope(request.hope, ruleset);
    if (to === null) throw httpError(400, `Hope is from 0 to ${String(ruleset.hopeMax)}`);
    if (to === pc.hope) return null;
    await tx.update(characters).set({ hope: to }).where(where);
    await logEvent(tx, scope, session, 'hope_adjust', {
      actorUserId: scope.userId,
      data: { characterId: request.characterId, characterName: pc.name, from: pc.hope, to },
    });
    return { characterId: request.characterId };
  });
}

/** A roll event as the stage shows it; `forPlayers` hides a hidden result until revealed. */
function toRollResult(
  id: string,
  at: Date,
  roll: RollEvent,
  revealed: boolean,
  forPlayers: boolean,
): RollResult {
  const withheld = forPlayers && roll.hidden && !revealed;
  return rollResultSchema.parse({
    id,
    characterId: roll.characterId,
    characterName: roll.characterName,
    trait: roll.trait,
    label: roll.label,
    dice: roll.dice,
    modifier: roll.modifier,
    hopeBonus: roll.hopeBonus,
    total: roll.total,
    critical: roll.critical,
    gained: roll.gained,
    difficulty: withheld ? null : roll.difficulty,
    // A critical always succeeds, and the dice show it: no secret to keep.
    success: withheld && !roll.critical ? null : roll.success,
    hidden: roll.hidden,
    revealed,
    at: at.toISOString(),
  });
}

/** The latest event of a kind in the session. */
async function latest(db: DbOrTx, session: SessionRow, kind: SessionLogKind) {
  const [row] = await db
    .select({ id: sessionEvents.id, at: sessionEvents.at, data: sessionEvents.data })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.playSessionId, session.id), eq(sessionEvents.kind, kind)))
    .orderBy(desc(sessionEvents.at), desc(sessionEvents.id))
    .limit(1);
  return row;
}

interface RollStageView {
  fear: number;
  fearCap: number;
  lastFearSpend: FearSpend | null;
  calls: RollCall[];
  lastRoll: RollResult | null;
}

/**
 * What the stage carries about rolls and Fear (§13), for the GM and for players. A player's copy
 * is written field by field: a hidden difficulty and its result are left out.
 */
export async function rollStageOf(
  db: DbOrTx,
  scope: CampaignScope,
  session: SessionRow,
): Promise<{ gm: RollStageView & { party: PartyMember[] }; player: RollStageView }> {
  const ruleset = rulesetOf(scope);
  const callRows = await db
    .select({ call: playRollCalls, characterName: characters.name })
    .from(playRollCalls)
    .innerJoin(
      characters,
      and(
        eq(characters.id, playRollCalls.characterId),
        eq(characters.campaignId, playRollCalls.campaignId),
      ),
    )
    .where(
      and(
        eq(playRollCalls.playSessionId, session.id),
        eq(playRollCalls.campaignId, scope.campaignId),
      ),
    )
    .orderBy(asc(playRollCalls.calledAt), asc(characters.name));
  const callOf = (row: (typeof callRows)[number], forPlayers: boolean): RollCall =>
    rollCallSchema.parse({
      id: row.call.id,
      characterId: row.call.characterId,
      characterName: row.characterName,
      trait: row.call.trait,
      difficulty: forPlayers && row.call.difficultyHidden ? null : row.call.difficulty,
      hidden: row.call.difficultyHidden,
      label: row.call.label,
    });

  const rollRow = await latest(db, session, 'roll');
  const roll = rollRow === undefined ? null : rollEventSchema.safeParse(rollRow.data);
  const revealed =
    rollRow !== undefined && roll?.success === true && roll.data.hidden
      ? await isRevealed(db, session, rollRow.id)
      : false;
  const lastRollFor = (forPlayers: boolean) =>
    rollRow === undefined || roll?.success !== true
      ? null
      : toRollResult(rollRow.id, rollRow.at, roll.data, revealed, forPlayers);

  const spendRow = await latest(db, session, 'fear_spend');
  const spend = spendRow === undefined ? null : fearSpendEventSchema.safeParse(spendRow.data);
  const lastFearSpend =
    spendRow === undefined || spend?.success !== true
      ? null
      : { id: spendRow.id, amount: spend.data.amount, reason: spend.data.reason };

  const party = (await partyRows(db, scope)).map((row) =>
    partyMemberSchema.parse({
      characterId: row.characterId,
      name: row.name,
      playerName: shownName({ name: row.userName, displayName: row.displayName }),
      hope: row.hope,
    }),
  );

  const shared = { fear: session.fear, fearCap: ruleset.fearCap, lastFearSpend };
  return {
    gm: {
      ...shared,
      calls: callRows.map((row) => callOf(row, false)),
      lastRoll: lastRollFor(false),
      party,
    },
    player: {
      ...shared,
      calls: callRows.map((row) => callOf(row, true)),
      lastRoll: lastRollFor(true),
    },
  };
}

/** Most lines the GM's log sends at once. */
const LOG_LIMIT = 200;

/**
 * The running session's log for the GM's desk (`GET …/play-session/log`), newest first, each
 * line said in words. Empty when no session is running.
 */
export async function sessionLog(db: Database, scope: CampaignScope): Promise<SessionLogEntry[]> {
  const ruleset = rulesetOf(scope);
  const rows = await db
    .select({
      id: sessionEvents.id,
      kind: sessionEvents.kind,
      at: sessionEvents.at,
      data: sessionEvents.data,
      actorUserId: sessionEvents.actorUserId,
      actorName: users.name,
      actorDisplayName: users.displayName,
      recordName: records.name,
    })
    .from(sessionEvents)
    .innerJoin(playSessions, and(eq(playSessions.id, sessionEvents.playSessionId), running(scope)))
    .leftJoin(users, eq(users.id, sessionEvents.actorUserId))
    .leftJoin(
      records,
      and(eq(records.id, sessionEvents.recordId), eq(records.campaignId, scope.campaignId)),
    )
    .where(eq(sessionEvents.campaignId, scope.campaignId))
    .orderBy(desc(sessionEvents.at), desc(sessionEvents.id))
    .limit(LOG_LIMIT);

  const rolls = new Map<string, RollEvent>();
  for (const row of rows) {
    if (row.kind !== 'roll') continue;
    const roll = rollEventSchema.safeParse(row.data);
    if (roll.success) rolls.set(row.id, roll.data);
  }

  return rows.map((row) =>
    sessionLogEntrySchema.parse({
      id: row.id,
      kind: row.kind,
      at: row.at.toISOString(),
      actorName:
        row.actorName === null
          ? null
          : shownName({ name: row.actorName, displayName: row.actorDisplayName }),
      text: logText(row.kind, row.data, row.recordName, ruleset, rolls, row.id),
    }),
  );
}

/** A log line in words. Data that doesn't read as its kind's is said plainly, not thrown. */
function logText(
  kind: SessionLogKind,
  data: unknown,
  recordName: string | null,
  ruleset: Ruleset,
  rolls: ReadonlyMap<string, RollEvent>,
  id: string,
): string {
  const record = recordName ?? 'a deleted record';
  switch (kind) {
    case 'scene_load': {
      const scene = sceneLoadEventSchema.safeParse(data);
      return scene.success ? `Loaded the scene “${scene.data.name}”` : 'Loaded a scene';
    }
    case 'reveal':
      return `Revealed ${record}`;
    case 'unreveal':
      return `Took back ${record}`;
    case 'roll': {
      const roll = rolls.get(id);
      if (roll === undefined) return 'A roll';
      return `${rollTitle(roll, ruleset)}: ${describeRoll(toRollResult(id, new Date(0), roll, false, false))}`;
    }
    case 'roll_reveal': {
      const reveal = rollRevealEventSchema.safeParse(data);
      const roll = reveal.success ? rolls.get(reveal.data.rollId) : undefined;
      return roll === undefined
        ? "Showed players a hidden roll's result"
        : `Showed players the result: ${rollTitle(roll, ruleset)}`;
    }
    case 'fear_spend': {
      const spend = fearSpendEventSchema.safeParse(data);
      if (!spend.success) return 'Spent Fear';
      const { amount, reason, from, to } = spend.data;
      return `Spent ${String(amount)} Fear (${String(from)} → ${String(to)})${reason === null ? '' : `: ${reason}`}`;
    }
    case 'fear_adjust': {
      const adjust = fearAdjustEventSchema.safeParse(data);
      return adjust.success
        ? `Set Fear from ${String(adjust.data.from)} to ${String(adjust.data.to)}`
        : 'Set Fear';
    }
    case 'free_roll': {
      const free = freeRollEventSchema.safeParse(data);
      if (!free.success) return 'Rolled dice';
      const { rollerName, private: hidden } = free.data;
      return `${rollerName} rolled ${describeFreeRoll(free.data)}${hidden ? ', private' : ''}`;
    }
    case 'hope_adjust': {
      const adjust = hopeAdjustEventSchema.safeParse(data);
      return adjust.success
        ? `Set ${adjust.data.characterName}'s Hope from ${String(adjust.data.from)} to ${String(adjust.data.to)}`
        : 'Set Hope';
    }
  }
}

/** "Mira rolled Agility (Climb the wall), hidden". */
function rollTitle(roll: RollEvent, ruleset: Ruleset): string {
  const label = roll.label === null ? '' : ` (${roll.label})`;
  return `${roll.characterName} rolled ${traitLabel(ruleset, roll.trait)}${label}${roll.hidden ? ', hidden' : ''}`;
}
