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

export interface ActionRollInput {
  /** The Hope die and the Fear die, each 1 to 12. */
  readonly dice: { readonly hope: number; readonly fear: number };
  /** The PC's modifier for the called trait. */
  readonly modifier: number;
  readonly difficulty: number;
  /** Whether the player spends 1 Hope for the ruleset's bonus (open question 19.1). */
  readonly spendHope: boolean;
  /** The PC's Hope before the roll. */
  readonly hope: number;
  /** The GM's Fear before the roll. */
  readonly fear: number;
  readonly ruleset: Ruleset;
}

export type ActionRollRefusal = 'BAD_DIE' | 'NO_HOPE';

export interface ActionRollOutcome {
  readonly ok: true;
  /** Dice plus modifier plus the Hope bonus. */
  readonly total: number;
  /** The bonus added for spending Hope, 0 when none was spent. */
  readonly hopeBonus: number;
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
  return Number.isInteger(value) && value >= 1 && value <= DIE_FACES;
}

/**
 * Resolves an action roll (§9 "Resolving an action roll", steps 4 to 6). A critical gives
 * Hope; otherwise the higher die gives Hope to the player or Fear to the GM, success or not.
 * Gains stop at the ruleset's caps.
 */
export function resolveActionRoll(input: ActionRollInput): ActionRollResult {
  const { dice, ruleset } = input;
  if (!isDie(dice.hope) || !isDie(dice.fear)) return { ok: false, reason: 'BAD_DIE' };
  if (input.spendHope && input.hope < 1) return { ok: false, reason: 'NO_HOPE' };

  const hopeBonus = input.spendHope ? ruleset.hopeSpendBonus : 0;
  const total = dice.hope + dice.fear + input.modifier + hopeBonus;
  const critical = dice.hope === dice.fear;
  const success = critical || total >= input.difficulty;
  const gained: RollGain = critical || dice.hope > dice.fear ? 'hope' : 'fear';

  const hopeAfterSpend = input.spendHope ? input.hope - 1 : input.hope;
  const hope = gained === 'hope' ? Math.min(hopeAfterSpend + 1, ruleset.hopeMax) : hopeAfterSpend;
  const fear = gained === 'fear' ? Math.min(input.fear + 1, ruleset.fearCap) : input.fear;
  return { ok: true, total, hopeBonus, critical, success, gained, hope, fear };
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
