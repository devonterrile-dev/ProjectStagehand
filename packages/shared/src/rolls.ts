/**
 * Called rolls, Hope and Fear in a live session (F3.6, governance §9 and §13, D-54).
 *
 * The GM calls a roll for one or more PCs (a trait, a difficulty that may be hidden, a label).
 * Each PC's player rolls from their sheet page, spending Hope for the bonus if they like; the
 * server rolls the dice and resolves the roll with the rules engine (`rules.ts`). The stage
 * carries the calls waiting, the last roll and the GM's Fear to everyone, and the party's Hope
 * to the GM only. A hidden difficulty and the result it decides reach players only once the GM
 * reveals the result.
 */
import { z } from 'zod';

import type { Ruleset } from './ruleset';

const timestamp = z.iso.datetime({ offset: true });

/** Highest difficulty the GM can set. */
export const DIFFICULTY_MAX = 99;
/** Longest label of a called roll ("Climb the wall"). */
export const ROLL_LABEL_MAX = 80;
/** Longest reason the GM gives for spending Fear. */
export const FEAR_REASON_MAX = 120;

export const difficultySchema = z.int().min(1).max(DIFFICULTY_MAX);

/**
 * A called roll's edge (F5.1, D-71): advantage adds the ruleset's advantage die (a d6) to the
 * total, disadvantage takes it away. One or the other, never both. Players see it openly.
 */
export const ROLL_EDGES = ['none', 'advantage', 'disadvantage'] as const;
export const rollEdgeSchema = z.enum(ROLL_EDGES);
export type RollEdge = z.infer<typeof rollEdgeSchema>;

/** A roll waiting for its player. A player's copy leaves out a hidden difficulty. */
export const rollCallSchema = z.object({
  id: z.uuid(),
  characterId: z.uuid(),
  characterName: z.string(),
  /** A trait id of the campaign's ruleset. */
  trait: z.string(),
  /** Null in a player's copy while the difficulty is hidden. */
  difficulty: difficultySchema.nullable(),
  hidden: z.boolean(),
  label: z.string().nullable(),
  edge: rollEdgeSchema,
});
export type RollCall = z.infer<typeof rollCallSchema>;

/**
 * A roll as it landed. In a player's copy of a hidden roll, `difficulty` and `success` are null
 * until the GM reveals the result; a critical shows anyway, since the dice show it.
 */
export const rollResultSchema = z.object({
  id: z.uuid(),
  characterId: z.uuid(),
  characterName: z.string(),
  trait: z.string(),
  label: z.string().nullable(),
  dice: z.object({ hope: z.int().min(1).max(12), fear: z.int().min(1).max(12) }),
  modifier: z.int(),
  /** The bonus for spending Hope; 0 when none was spent. */
  hopeBonus: z.int().nonnegative(),
  edge: rollEdgeSchema,
  /** The advantage die as it landed; null for a roll with no edge. */
  edgeDie: z.int().positive().nullable(),
  total: z.int(),
  critical: z.boolean(),
  gained: z.enum(['hope', 'fear']),
  difficulty: difficultySchema.nullable(),
  success: z.boolean().nullable(),
  hidden: z.boolean(),
  /** A hidden roll whose result the GM has shown players. */
  revealed: z.boolean(),
  at: timestamp,
});
export type RollResult = z.infer<typeof rollResultSchema>;

/** The GM's last Fear spend, so every table plays it once (the bowl tosses the beads). */
export const fearSpendSchema = z.object({
  id: z.uuid(),
  amount: z.int().positive(),
  reason: z.string().nullable(),
});
export type FearSpend = z.infer<typeof fearSpendSchema>;

/** A PC with a player, as the GM's desk shows it: who plays it and its Hope. */
export const partyMemberSchema = z.object({
  characterId: z.uuid(),
  name: z.string(),
  playerName: z.string(),
  hope: z.int().nonnegative(),
});
export type PartyMember = z.infer<typeof partyMemberSchema>;

/** What both views of the stage carry about rolls and Fear. */
export const rollStage = {
  /** The GM's Rest switch (F4.7): while on, PCs move domain cards between loadout and vault free. */
  rest: z.boolean(),
  fear: z.int().nonnegative(),
  fearCap: z.int().positive(),
  lastFearSpend: fearSpendSchema.nullable(),
  calls: z.array(rollCallSchema),
  lastRoll: rollResultSchema.nullable(),
};

const label = z
  .string()
  .trim()
  .max(ROLL_LABEL_MAX)
  .transform((value) => (value === '' ? undefined : value))
  .optional();

/** GM: calls a roll for one or more PCs. A new call replaces a PC's call still waiting. */
export const rollCallRequestSchema = z.strictObject({
  characterIds: z
    .array(z.uuid())
    .min(1)
    .max(6)
    .refine((ids) => new Set(ids).size === ids.length, 'A PC is named twice'),
  trait: z.string().min(1).max(40),
  difficulty: difficultySchema,
  hidden: z.boolean(),
  label,
  edge: rollEdgeSchema.default('none'),
});
export type RollCallRequest = z.input<typeof rollCallRequestSchema>;

/** GM: takes back a call. Player: rolls it, spending Hope for the bonus or not. */
export const cancelRollRequestSchema = z.strictObject({ callId: z.uuid() });
export type CancelRollRequest = z.infer<typeof cancelRollRequestSchema>;
export const makeRollRequestSchema = z.strictObject({ callId: z.uuid(), spendHope: z.boolean() });
export type MakeRollRequest = z.infer<typeof makeRollRequestSchema>;

/** GM: shows players the result of a hidden roll. */
export const revealRollRequestSchema = z.strictObject({ rollId: z.uuid() });
export type RevealRollRequest = z.infer<typeof revealRollRequestSchema>;

/** GM: spends Fear, with a reason players see if one is given. */
export const spendFearRequestSchema = z.strictObject({
  amount: z.int().min(1).max(99),
  reason: z
    .string()
    .trim()
    .max(FEAR_REASON_MAX)
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
});
export type SpendFearRequest = z.input<typeof spendFearRequestSchema>;

/** GM corrections (§9 "Fear"): set Fear, or a PC's Hope, to a value. Logged. */
export const setFearRequestSchema = z.strictObject({ fear: z.int().min(0).max(99) });
export type SetFearRequest = z.infer<typeof setFearRequestSchema>;
export const setHopeRequestSchema = z.strictObject({
  characterId: z.uuid(),
  hope: z.int().min(0).max(99),
});
export type SetHopeRequest = z.infer<typeof setHopeRequestSchema>;

/** GM: turns Rest on or off (F4.7). */
export const setRestRequestSchema = z.strictObject({ rest: z.boolean() });
export type SetRestRequest = z.infer<typeof setRestRequestSchema>;

/** Server to browser: a PC's sheet changed (a roll, a correction, the GM's edit). */
export const sheetChangedSchema = z.object({ characterId: z.uuid() });
export type SheetChanged = z.infer<typeof sheetChangedSchema>;

/** What the session's log holds (§8 `session_events`). */
export const SESSION_LOG_KINDS = [
  'scene_load',
  'reveal',
  'unreveal',
  'roll',
  'roll_reveal',
  'fear_spend',
  'fear_adjust',
  'hope_adjust',
  'free_roll',
  'rest',
  'card_recall',
  'track_adjust',
  'level_up',
  'battle_start',
  'battle_end',
] as const;
export const sessionLogKindSchema = z.enum(SESSION_LOG_KINDS);
export type SessionLogKind = z.infer<typeof sessionLogKindSchema>;

/** One line of the GM's log: what happened, said in words, newest first. */
export const sessionLogEntrySchema = z.object({
  id: z.uuid(),
  kind: sessionLogKindSchema,
  at: timestamp,
  /** Who did it; null for what the stage did by itself, or a deleted account. */
  actorName: z.string().nullable(),
  text: z.string(),
});
export type SessionLogEntry = z.infer<typeof sessionLogEntrySchema>;

/** `GET /api/campaigns/:campaignId/play-session/log` (GM only): the running session's log. */
export const sessionLogResponseSchema = z.object({ entries: z.array(sessionLogEntrySchema) });
export type SessionLogResponse = z.infer<typeof sessionLogResponseSchema>;

/**
 * Free rolls (F4.2, §9 "Free rolls"): any number of one kind of die from the dice tray, rolled
 * on the server. No trait, difficulty or modifier, and never any Hope or Fear. The dice, in the
 * tray's order; 100 is the percentile die, d%.
 */
export const FREE_DICE = [4, 6, 8, 10, 100, 12, 20] as const;
export type FreeDie = (typeof FREE_DICE)[number];
/** Most dice in one free roll. */
export const FREE_ROLL_COUNT_MAX = 20;

const freeDieSchema = z.literal(FREE_DICE);

/** Anyone at the table: rolls `count` dice. Only the GM may roll privately (19.20). */
export const freeRollRequestSchema = z.strictObject({
  die: freeDieSchema,
  count: z.int().min(1).max(FREE_ROLL_COUNT_MAX),
  private: z.boolean(),
});
export type FreeRollRequest = z.infer<typeof freeRollRequestSchema>;

/** Server to browser: a free roll as it landed, sent once. A private one goes to the GM only. */
export const freeRollSchema = z.object({
  id: z.uuid(),
  /** Who rolled, so their own tray plays it. */
  userId: z.uuid(),
  /** The PC's name for a player with one, otherwise the person's name; "The GM" for the GM. */
  rollerName: z.string(),
  die: freeDieSchema,
  /** Each die, in the order rolled. */
  results: z.array(z.int().positive()).min(1).max(FREE_ROLL_COUNT_MAX),
  total: z.int().positive(),
  private: z.boolean(),
  at: timestamp,
});
export type FreeRoll = z.infer<typeof freeRollSchema>;

/** "d6", or "d%" for the percentile die. */
export function dieLabel(die: FreeDie): string {
  return die === 100 ? 'd%' : `d${String(die)}`;
}

/** "5d6: 5 + 3 + 2 + 6 + 1 = 17", or "d20: 14" for one die. */
export function describeFreeRoll(roll: Pick<FreeRoll, 'die' | 'results' | 'total'>): string {
  const dice = `${roll.results.length > 1 ? String(roll.results.length) : ''}${dieLabel(roll.die)}`;
  if (roll.results.length === 1) return `${dice}: ${String(roll.total)}`;
  return `${dice}: ${roll.results.join(' + ')} = ${String(roll.total)}`;
}

/** A trait's label in a ruleset, or its id when the ruleset has no such trait. */
export function traitLabel(ruleset: Ruleset, trait: string): string {
  return ruleset.traits.find((entry) => entry.id === trait)?.label ?? trait;
}

/** "+2", "0", "−1": a modifier as the sheet writes it. */
export function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : value < 0 ? `−${String(-value)}` : '0';
}

/**
 * A roll in words, as the GM's log and the table's slip say it:
 * "7 + 9 + 2 + 3 = 21 vs 12: success with Hope", and with an edge (F5.1) "… + 4 (advantage) = 25"
 * or "… − 4 (disadvantage) = 17". The difficulty part is left out when the copy has none (a
 * hidden roll in a player's copy).
 */
export function describeRoll(roll: RollResult): string {
  let sum = `${String(roll.dice.hope)} + ${String(roll.dice.fear)}`;
  if (roll.modifier > 0) sum += ` + ${String(roll.modifier)}`;
  if (roll.modifier < 0) sum += ` − ${String(-roll.modifier)}`;
  if (roll.hopeBonus > 0) sum += ` + ${String(roll.hopeBonus)}`;
  if (roll.edge !== 'none' && roll.edgeDie !== null) {
    sum += ` ${roll.edge === 'advantage' ? '+' : '−'} ${String(roll.edgeDie)} (${roll.edge})`;
  }
  sum += ` = ${String(roll.total)}`;
  const outcome = roll.critical
    ? 'critical success'
    : roll.success === null
      ? 'result hidden'
      : roll.success
        ? 'success'
        : 'failure';
  const against = roll.difficulty === null ? '' : ` vs ${String(roll.difficulty)}`;
  return `${sum}${against}: ${outcome} with ${roll.gained === 'hope' ? 'Hope' : 'Fear'}`;
}
