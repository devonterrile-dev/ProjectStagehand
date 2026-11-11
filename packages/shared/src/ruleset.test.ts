import { describe, expect, it } from 'vitest';

import { DEFAULT_RULESET_VERSION, RULESETS, rulesetFor, traitIdsOf } from './ruleset';

describe('rulesets', () => {
  it('version 1 holds the values in governance §9', () => {
    const v1 = rulesetFor(1);
    expect(traitIdsOf(v1)).toEqual([
      'agility',
      'strength',
      'finesse',
      'instinct',
      'presence',
      'knowledge',
    ]);
    expect(v1.traitModifier).toEqual({ min: -1, max: 2 });
    expect(v1).toMatchObject({
      hopeMax: 6,
      hopeSpendBonus: 3,
      teamworkCost: 3,
      fearStart: 3,
      fearCap: 12,
    });
  });

  it('the default version exists and every version has unique trait ids', () => {
    expect(rulesetFor(DEFAULT_RULESET_VERSION).version).toBe(DEFAULT_RULESET_VERSION);
    for (const ruleset of Object.values(RULESETS)) {
      const ids = traitIdsOf(ruleset);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('refuses an unknown version', () => {
    expect(() => rulesetFor(99)).toThrow('Unknown ruleset version 99');
  });

  it('is frozen, so a published version cannot be edited at runtime', () => {
    expect(Object.isFrozen(rulesetFor(1))).toBe(true);
    expect(Object.isFrozen(rulesetFor(1).traits)).toBe(true);
  });
});
