/**
 * The rules engine (governance §9, D-54): pure functions over the ruleset's values. No I/O and
 * no randomness: the server rolls the dice with a secure generator and passes them in, so every
 * rule here is tested exhaustively (CI holds this file at 100% coverage, `pnpm test:rules`).
 */
import type { Ruleset } from './ruleset';

/** The faces of a d12. */
export const DIE_FACES = 12;

/** Who an action roll's dice handed something to: the player (Hope) or the GM (Fear). */
export type RollGain = 'hope' | 'fear';

/** A called roll's advantage or disadvantage (F5.1), and the die the server rolled for it. */
export interface RollEdgeDie {
  readonly kind: 'advantage' | 'disadvantage';
  /** 1 to the ruleset's advantage die. */
  readonly die: number;
}

export interface ActionRollInput {
  /** The Hope die and the Fear die, each 1 to 12. */
  readonly dice: { readonly hope: number; readonly fear: number };
  /** The PC's modifier for the called trait. */
  readonly modifier: number;
  readonly difficulty: number;
  /** Whether the player spends 1 Hope for the bonus (open question 19.1). */
  readonly spendHope: boolean;
  /** The PC's own Hope bonus from level-ups, added to the ruleset's when Hope is spent. */
  readonly pcHopeBonus: number;
  /** The PC's Hope before the roll. */
  readonly hope: number;
  /** The GM's Fear before the roll. */
  readonly fear: number;
  readonly ruleset: Ruleset;
  /** Advantage or disadvantage with its die (F5.1); none when left out or null. */
  readonly edge?: RollEdgeDie | null;
}

/** `NO_EDGE_DIE`: an edge on a ruleset without an advantage die (v1). */
export type ActionRollRefusal = 'BAD_DIE' | 'NO_HOPE' | 'NO_EDGE_DIE';

export interface ActionRollOutcome {
  readonly ok: true;
  /** Dice plus modifier plus the Hope bonus, plus or minus the advantage die. */
  readonly total: number;
  /** The bonus added for spending Hope (the ruleset's plus the PC's), 0 when none was spent. */
  readonly hopeBonus: number;
  /** The advantage die as added: positive with advantage, negative with disadvantage, or 0. */
  readonly edgeBonus: number;
  /** Both dice match: an automatic success that gives the player 1 Hope. */
  readonly critical: boolean;
  /** Meets or beats the difficulty (open question 19.2), or a critical. */
  readonly success: boolean;
  /** Who the dice favoured. A gain already at its cap changes nothing, but still counts here. */
  readonly gained: RollGain;
  /** The PC's Hope after spending and gaining. */
  readonly hope: number;
  /** The GM's Fear after the roll. */
  readonly fear: number;
}

export type ActionRollResult =
  ActionRollOutcome | { readonly ok: false; readonly reason: ActionRollRefusal };

/** Whether a number is a face of a d12. */
export function isDie(value: number): boolean {
  return isFace(value, DIE_FACES);
}

function isFace(value: number, faces: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= faces;
}

/**
 * Resolves an action roll (§9 "Resolving an action roll", steps 4 to 6). A critical gives
 * Hope; otherwise the higher die gives Hope to the player or Fear to the GM, success or not.
 * Gains stop at the ruleset's caps. Advantage adds its die to the total and disadvantage takes
 * it away (F5.1); only the d12s decide a critical and who gains.
 */
export function resolveActionRoll(input: ActionRollInput): ActionRollResult {
  const { dice, ruleset } = input;
  const edge = input.edge ?? null;
  if (!isDie(dice.hope) || !isDie(dice.fear)) return { ok: false, reason: 'BAD_DIE' };
  if (edge !== null) {
    if (ruleset.advantageDie === undefined) return { ok: false, reason: 'NO_EDGE_DIE' };
    if (!isFace(edge.die, ruleset.advantageDie)) return { ok: false, reason: 'BAD_DIE' };
  }
  if (input.spendHope && input.hope < 1) return { ok: false, reason: 'NO_HOPE' };

  const hopeBonus = input.spendHope ? hopeSpendBonusOf(ruleset, input.pcHopeBonus) : 0;
  const edgeBonus = edge === null ? 0 : edge.kind === 'advantage' ? edge.die : -edge.die;
  const total = dice.hope + dice.fear + input.modifier + hopeBonus + edgeBonus;
  const critical = dice.hope === dice.fear;
  const success = critical || total >= input.difficulty;
  const gained: RollGain = critical || dice.hope > dice.fear ? 'hope' : 'fear';

  const hopeAfterSpend = input.spendHope ? input.hope - 1 : input.hope;
  const hope = gained === 'hope' ? Math.min(hopeAfterSpend + 1, ruleset.hopeMax) : hopeAfterSpend;
  const fear = gained === 'fear' ? Math.min(input.fear + 1, ruleset.fearCap) : input.fear;
  return { ok: true, total, hopeBonus, edgeBonus, critical, success, gained, hope, fear };
}

/** What spending 1 Hope adds to a roll: the ruleset's bonus plus the PC's own (§9). */
export function hopeSpendBonusOf(ruleset: Ruleset, pcHopeBonus: number): number {
  return ruleset.hopeSpendBonus + pcHopeBonus;
}

/**
 * The tier a level is in (§9 "Levels and tiers"), or null for a ruleset without tiers or a
 * level outside every tier.
 */
export function tierOf(level: number, ruleset: Ruleset): number | null {
  const found = ruleset.tiers?.find((tier) => level >= tier.minLevel && level <= tier.maxLevel);
  return found?.tier ?? null;
}

/** The GM's Fear after spending `amount`, or null when that is more than they hold. */
export function spendFear(fear: number, amount: number): number | null {
  if (!Number.isInteger(amount) || amount < 1 || amount > fear) return null;
  return fear - amount;
}

/** A corrected Fear value, or null when it is outside 0 to the ruleset's cap. */
export function setFear(value: number, ruleset: Ruleset): number | null {
  return inRange(value, ruleset.fearCap);
}

/** A corrected Hope value, or null when it is outside 0 to the ruleset's maximum. */
export function setHope(value: number, ruleset: Ruleset): number | null {
  return inRange(value, ruleset.hopeMax);
}

function inRange(value: number, max: number): number | null {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}
