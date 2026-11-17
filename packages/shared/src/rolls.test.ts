import { describe, expect, it } from 'vitest';

import { rulesetFor } from './ruleset';
import {
  describeRoll,
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
