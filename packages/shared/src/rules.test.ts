import { describe, expect, it } from 'vitest';

import { rulesetFor } from './ruleset';
import {
  hopeSpendBonusOf,
  isDie,
  resolveActionRoll,
  setFear,
  setHope,
  spendFear,
  tierOf,
  type ActionRollInput,
} from './rules';

const ruleset = rulesetFor(2);

function roll(overrides: Partial<ActionRollInput> = {}) {
  return resolveActionRoll({
    dice: { hope: 7, fear: 4 },
    modifier: 1,
    difficulty: 12,
    spendHope: false,
    pcHopeBonus: 0,
    hope: 2,
    fear: 3,
    ruleset,
    ...overrides,
  });
}

describe('isDie', () => {
  it('accepts 1 to 12 only', () => {
    expect([1, 6, 12].every(isDie)).toBe(true);
    expect([0, 13, -1, 2.5, Number.NaN].some(isDie)).toBe(false);
  });
});

describe('resolveActionRoll', () => {
  it('adds the dice and the modifier, and the Hope die gives the player Hope', () => {
    expect(roll()).toEqual({
      ok: true,
      total: 12,
      hopeBonus: 0,
      critical: false,
      success: true,
      gained: 'hope',
      hope: 3,
      fear: 3,
    });
  });

  it('succeeds on a total equal to the difficulty and fails one short (19.2)', () => {
    expect(roll({ difficulty: 12 })).toMatchObject({ success: true });
    expect(roll({ difficulty: 13 })).toMatchObject({ success: false });
  });

  it('gives the GM Fear when the Fear die is higher, success or not', () => {
    expect(roll({ dice: { hope: 3, fear: 10 }, difficulty: 5 })).toMatchObject({
      success: true,
      gained: 'fear',
      hope: 2,
      fear: 4,
    });
    expect(roll({ dice: { hope: 3, fear: 10 }, difficulty: 20 })).toMatchObject({
      success: false,
      gained: 'fear',
      fear: 4,
    });
  });

  it('gives Hope on a failure when the Hope die is higher', () => {
    expect(roll({ dice: { hope: 5, fear: 2 }, difficulty: 20 })).toMatchObject({
      success: false,
      gained: 'hope',
      hope: 3,
    });
  });

  it('spends 1 Hope for the bonus', () => {
    expect(roll({ spendHope: true, dice: { hope: 2, fear: 9 } })).toMatchObject({
      total: 14,
      hopeBonus: 2,
      hope: 1,
      fear: 4,
    });
  });

  it("adds the PC's own Hope bonus when Hope is spent, and only then", () => {
    expect(roll({ spendHope: true, pcHopeBonus: 2, dice: { hope: 2, fear: 9 } })).toMatchObject({
      total: 16,
      hopeBonus: 4,
    });
    expect(roll({ pcHopeBonus: 2 })).toMatchObject({ total: 12, hopeBonus: 0 });
  });

  it('keeps version 1 at +3', () => {
    expect(
      roll({ ruleset: rulesetFor(1), spendHope: true, dice: { hope: 2, fear: 9 } }),
    ).toMatchObject({ total: 15, hopeBonus: 3 });
  });

  it('spends then gains back when the Hope die wins', () => {
    expect(roll({ spendHope: true, hope: 1 })).toMatchObject({ hope: 1, gained: 'hope' });
  });

  it('refuses to spend Hope at 0 Hope', () => {
    expect(roll({ spendHope: true, hope: 0 })).toEqual({ ok: false, reason: 'NO_HOPE' });
  });

  it('rolls without spending at 0 Hope', () => {
    expect(roll({ hope: 0, dice: { hope: 1, fear: 2 } })).toMatchObject({ ok: true, hope: 0 });
  });

  it('refuses dice that are not d12 faces', () => {
    expect(roll({ dice: { hope: 0, fear: 4 } })).toEqual({ ok: false, reason: 'BAD_DIE' });
    expect(roll({ dice: { hope: 4, fear: 13 } })).toEqual({ ok: false, reason: 'BAD_DIE' });
  });

  it('makes double 1s a critical success that gives Hope, whatever the difficulty', () => {
    expect(roll({ dice: { hope: 1, fear: 1 }, modifier: -1, difficulty: 30 })).toMatchObject({
      total: 1,
      critical: true,
      success: true,
      gained: 'hope',
      hope: 3,
      fear: 3,
    });
  });

  it('makes double 12s a critical success', () => {
    expect(roll({ dice: { hope: 12, fear: 12 } })).toMatchObject({
      total: 25,
      critical: true,
      success: true,
      gained: 'hope',
    });
  });

  it('caps Hope at the ruleset maximum', () => {
    expect(roll({ hope: 6 })).toMatchObject({ gained: 'hope', hope: 6 });
    expect(roll({ hope: 6, dice: { hope: 4, fear: 4 } })).toMatchObject({
      critical: true,
      hope: 6,
    });
  });

  it('caps Fear at the ruleset cap', () => {
    expect(roll({ fear: 12, dice: { hope: 1, fear: 2 } })).toMatchObject({
      gained: 'fear',
      fear: 12,
    });
  });
});

describe('hopeSpendBonusOf', () => {
  it("is the ruleset's bonus plus the PC's", () => {
    expect(hopeSpendBonusOf(ruleset, 0)).toBe(2);
    expect(hopeSpendBonusOf(ruleset, 3)).toBe(5);
  });
});

describe('tierOf', () => {
  it('finds the tier of each level, edges included', () => {
    expect([1, 2, 4, 5, 7, 8, 10].map((level) => tierOf(level, ruleset))).toEqual([
      1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it('is null outside every tier, or for a ruleset without tiers', () => {
    expect(tierOf(0, ruleset)).toBeNull();
    expect(tierOf(11, ruleset)).toBeNull();
    expect(tierOf(3, rulesetFor(1))).toBeNull();
  });
});

describe('spendFear', () => {
  it('spends up to what the GM holds', () => {
    expect(spendFear(3, 1)).toBe(2);
    expect(spendFear(3, 3)).toBe(0);
  });

  it('refuses more than the GM holds, nothing, or a fraction', () => {
    expect(spendFear(3, 4)).toBeNull();
    expect(spendFear(3, 0)).toBeNull();
    expect(spendFear(3, 1.5)).toBeNull();
  });
});

describe('setFear and setHope', () => {
  it('accept 0 to the cap', () => {
    expect(setFear(0, ruleset)).toBe(0);
    expect(setFear(12, ruleset)).toBe(12);
    expect(setHope(6, ruleset)).toBe(6);
  });

  it('refuse values outside the range', () => {
    expect(setFear(13, ruleset)).toBeNull();
    expect(setFear(-1, ruleset)).toBeNull();
    expect(setHope(7, ruleset)).toBeNull();
    expect(setHope(1.5, ruleset)).toBeNull();
  });
});
