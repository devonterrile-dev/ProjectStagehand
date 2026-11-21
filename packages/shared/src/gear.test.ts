import { describe, expect, it } from 'vitest';

import {
  createArmorRequestSchema,
  createWeaponRequestSchema,
  formatDamage,
  gearBonusesSchema,
  hasNoGearBonuses,
  noGearBonuses,
  updateArmorRequestSchema,
  updateWeaponRequestSchema,
} from './gear';
import { signed } from './rolls';

describe('formatDamage (F4.4)', () => {
  it('writes a die and its bonus, and the number of dice when given', () => {
    expect(formatDamage(10, 3)).toBe('d10+3');
    expect(formatDamage(8, 0)).toBe('d8');
    expect(formatDamage(6, -1)).toBe('d6−1');
    expect(formatDamage(10, 3, 2)).toBe('2d10+3');
    expect(formatDamage(12, 0, 1)).toBe('1d12');
  });

  it('signs numbers with a true minus', () => {
    expect(signed(2)).toBe('+2');
    expect(signed(-1)).toBe('−1');
    expect(signed(0)).toBe('0');
  });
});

describe('gear bonuses (19.25)', () => {
  it('drops trait bonuses of 0', () => {
    expect(
      gearBonusesSchema.parse({
        evasion: -1,
        armorScore: 0,
        majorThreshold: 0,
        severeThreshold: 3,
        traits: { agility: -1, presence: 0 },
      }),
    ).toEqual({
      evasion: -1,
      armorScore: 0,
      majorThreshold: 0,
      severeThreshold: 3,
      traits: { agility: -1 },
    });
  });

  it('keeps each number within ±99 and needs every key', () => {
    expect(gearBonusesSchema.safeParse({ ...noGearBonuses(), evasion: 100 }).success).toBe(false);
    expect(
      gearBonusesSchema.safeParse({ ...noGearBonuses(), traits: { agility: -100 } }).success,
    ).toBe(false);
    expect(gearBonusesSchema.safeParse({ evasion: 1 }).success).toBe(false);
    expect(gearBonusesSchema.safeParse({ ...noGearBonuses(), luck: 1 }).success).toBe(false);
  });

  it('tells when gear changes nothing', () => {
    expect(hasNoGearBonuses(noGearBonuses())).toBe(true);
    expect(hasNoGearBonuses({ ...noGearBonuses(), traits: { agility: 1 } })).toBe(false);
    expect(hasNoGearBonuses({ ...noGearBonuses(), armorScore: 1 })).toBe(false);
  });
});

describe('weapon requests', () => {
  it('needs only a name to create, trimmed', () => {
    expect(createWeaponRequestSchema.parse({ name: ' Broadsword ' })).toEqual({
      name: 'Broadsword',
    });
    expect(createWeaponRequestSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(createWeaponRequestSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
    expect(createWeaponRequestSchema.safeParse({ name: 'A', extra: 1 }).success).toBe(false);
  });

  it('takes tiers 1 to 4 and the six dice', () => {
    expect(updateWeaponRequestSchema.safeParse({ tier: 4 }).success).toBe(true);
    expect(updateWeaponRequestSchema.safeParse({ tier: 0 }).success).toBe(false);
    expect(updateWeaponRequestSchema.safeParse({ tier: 5 }).success).toBe(false);
    for (const die of [4, 6, 8, 10, 12, 20]) {
      expect(updateWeaponRequestSchema.safeParse({ damageDie: die }).success).toBe(true);
    }
    expect(updateWeaponRequestSchema.safeParse({ damageDie: 7 }).success).toBe(false);
    expect(updateWeaponRequestSchema.safeParse({ damageBonus: -3 }).success).toBe(true);
  });

  it('knows the ranges, slots, kinds and burdens', () => {
    expect(
      updateWeaponRequestSchema.parse({
        range: 'very_far',
        slot: 'secondary',
        kind: 'magic',
        burden: 'one_handed',
      }),
    ).toEqual({ range: 'very_far', slot: 'secondary', kind: 'magic', burden: 'one_handed' });
    expect(updateWeaponRequestSchema.safeParse({ range: 'very melee' }).success).toBe(false);
  });

  it('refuses an empty patch', () => {
    expect(updateWeaponRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('armor requests', () => {
  it('needs only a name to create', () => {
    expect(createArmorRequestSchema.parse({ name: 'Leather armor' })).toEqual({
      name: 'Leather armor',
    });
  });

  it('takes thresholds and a score from 0 to 999, and a feature', () => {
    expect(
      updateArmorRequestSchema.parse({
        baseMajorThreshold: 6,
        baseSevereThreshold: 13,
        baseScore: 3,
        featureName: ' Heavy ',
        featureText: '−1 to Evasion',
      }),
    ).toEqual({
      baseMajorThreshold: 6,
      baseSevereThreshold: 13,
      baseScore: 3,
      featureName: 'Heavy',
      featureText: '−1 to Evasion',
    });
    expect(updateArmorRequestSchema.safeParse({ baseScore: -1 }).success).toBe(false);
    expect(updateArmorRequestSchema.safeParse({ featureName: 'x'.repeat(81) }).success).toBe(false);
  });
});
