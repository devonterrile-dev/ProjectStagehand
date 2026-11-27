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

  it('version 2 holds the values in governance §9 (F4.1, D-58)', () => {
    const v2 = rulesetFor(2);
    expect(v2.traits).toBe(rulesetFor(1).traits);
    expect(v2.traitModifier).toEqual({ min: -1, max: 5 });
    expect(v2).toMatchObject({
      hopeMax: 6,
      hopeSpendBonus: 2,
      teamworkCost: 3,
      fearStart: 3,
      fearCap: 12,
      levels: { min: 1, max: 10 },
      proficiency: { start: 1, perTier: 1 },
      start: { hope: 0, stressSlots: 6 },
      domainCards: { atCreation: 2, loadoutMax: 5 },
      advantageDie: 6,
    });
    expect(rulesetFor(1).advantageDie).toBeUndefined();
    expect(v2.tiers).toEqual([
      { tier: 1, minLevel: 1, maxLevel: 1 },
      { tier: 2, minLevel: 2, maxLevel: 4 },
      { tier: 3, minLevel: 5, maxLevel: 7 },
      { tier: 4, minLevel: 8, maxLevel: 10 },
    ]);
    expect([...(v2.creationTraitSpread ?? [])].sort()).toEqual([-1, 0, 0, 1, 1, 2]);
  });

  it('version 2 tiers cover every level once, and the trait spread has one value per trait', () => {
    const v2 = rulesetFor(2);
    const covered = (v2.tiers ?? []).flatMap((tier) =>
      Array.from({ length: tier.maxLevel - tier.minLevel + 1 }, (_, i) => tier.minLevel + i),
    );
    expect(covered).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(v2.creationTraitSpread).toHaveLength(v2.traits.length);
  });

  it('new campaigns get version 2', () => {
    expect(DEFAULT_RULESET_VERSION).toBe(2);
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
    for (const ruleset of Object.values(RULESETS)) {
      expect(Object.isFrozen(ruleset)).toBe(true);
      expect(Object.isFrozen(ruleset.traits)).toBe(true);
      expect(ruleset.traits.every((trait) => Object.isFrozen(trait))).toBe(true);
      for (const part of [ruleset.traitModifier, ruleset.tiers, ruleset.start, ruleset.levels]) {
        if (part !== undefined) expect(Object.isFrozen(part)).toBe(true);
      }
    }
  });
});
