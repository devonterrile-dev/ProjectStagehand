import { describe, expect, it } from 'vitest';

import { rulesetFor } from './ruleset';
import {
  describeFreeRoll,
  describeRoll,
  dieLabel,
  FREE_DICE,
  freeRollRequestSchema,
  rollCallRequestSchema,
  signed,
  spendFearRequestSchema,
  traitLabel,
  type RollResult,
} from './rolls';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const roll: RollResult = {
  id: id(1),
  characterId: id(2),
  characterName: 'Mira',
  trait: 'agility',
  label: 'Climb the wall',
  dice: { hope: 9, fear: 4 },
  modifier: 2,
  hopeBonus: 3,
  edge: 'none',
  edgeDie: null,
  total: 18,
  critical: false,
  gained: 'hope',
  difficulty: 12,
  success: true,
  hidden: false,
  revealed: false,
  at: '2026-11-17T20:00:00.000Z',
};

describe('describeRoll', () => {
  it('writes the sum, the difficulty and the outcome', () => {
    expect(describeRoll(roll)).toBe('9 + 4 + 2 + 3 = 18 vs 12: success with Hope');
  });

  it('writes a negative modifier and no bonus', () => {
    expect(
      describeRoll({
        ...roll,
        modifier: -1,
        hopeBonus: 0,
        total: 12,
        success: false,
        gained: 'fear',
      }),
    ).toBe('9 + 4 − 1 = 12 vs 12: failure with Fear');
  });

  it('leaves out a difficulty players do not have', () => {
    expect(describeRoll({ ...roll, modifier: 0, difficulty: null, success: null })).toBe(
      '9 + 4 + 3 = 18: result hidden with Hope',
    );
  });

  it('adds the die with advantage and takes it away with disadvantage (F5.1)', () => {
    expect(describeRoll({ ...roll, edge: 'advantage', edgeDie: 4, total: 22 })).toBe(
      '9 + 4 + 2 + 3 + 4 (advantage) = 22 vs 12: success with Hope',
    );
    expect(
      describeRoll({ ...roll, hopeBonus: 0, edge: 'disadvantage', edgeDie: 5, total: 10 }),
    ).toBe('9 + 4 + 2 − 5 (disadvantage) = 10 vs 12: success with Hope');
  });

  it('names a critical', () => {
    expect(describeRoll({ ...roll, dice: { hope: 5, fear: 5 }, critical: true })).toContain(
      'critical success with Hope',
    );
  });
});

describe('the requests', () => {
  it('drops an empty label and reason, and refuses a PC named twice', () => {
    const call = { characterIds: [id(1)], trait: 'agility', difficulty: 12, hidden: false };
    expect(rollCallRequestSchema.parse({ ...call, label: '  ' }).label).toBeUndefined();
    expect(rollCallRequestSchema.safeParse({ ...call, characterIds: [id(1), id(1)] }).success).toBe(
      false,
    );
    expect(rollCallRequestSchema.safeParse({ ...call, difficulty: 0 }).success).toBe(false);
    expect(rollCallRequestSchema.parse(call).edge).toBe('none');
    expect(rollCallRequestSchema.parse({ ...call, edge: 'disadvantage' }).edge).toBe(
      'disadvantage',
    );
    expect(rollCallRequestSchema.safeParse({ ...call, edge: 'both' }).success).toBe(false);
    expect(spendFearRequestSchema.parse({ amount: 1, reason: '' }).reason).toBeUndefined();
  });
});

describe('labels', () => {
  it('names a trait from the ruleset, and writes modifiers with their sign', () => {
    expect(traitLabel(rulesetFor(1), 'knowledge')).toBe('Knowledge');
    expect(traitLabel(rulesetFor(1), 'luck')).toBe('luck');
    expect([signed(2), signed(0), signed(-1)]).toEqual(['+2', '0', '−1']);
  });
});

describe('free rolls (F4.2)', () => {
  it('names the dice, with d% for the percentile die', () => {
    expect(FREE_DICE.map(dieLabel)).toEqual(['d4', 'd6', 'd8', 'd10', 'd%', 'd12', 'd20']);
  });

  it('says a roll with every die and the total, or one die alone', () => {
    expect(describeFreeRoll({ die: 6, results: [5, 3, 2, 6, 1], total: 17 })).toBe(
      '5d6: 5 + 3 + 2 + 6 + 1 = 17',
    );
    expect(describeFreeRoll({ die: 20, results: [14], total: 14 })).toBe('d20: 14');
    expect(describeFreeRoll({ die: 100, results: [37, 82], total: 119 })).toBe(
      '2d%: 37 + 82 = 119',
    );
  });

  it('takes one of the tray dice, 1 to 20 of them', () => {
    const ok = (body: object) => freeRollRequestSchema.safeParse(body).success;
    expect(ok({ die: 100, count: 1, private: false })).toBe(true);
    expect(ok({ die: 20, count: 20, private: true })).toBe(true);
    expect(ok({ die: 3, count: 1, private: false })).toBe(false);
    expect(ok({ die: 6, count: 0, private: false })).toBe(false);
    expect(ok({ die: 6, count: 21, private: false })).toBe(false);
    expect(ok({ die: 6, count: 1.5, private: false })).toBe(false);
    expect(ok({ die: 6, count: 2 })).toBe(false);
  });
});
