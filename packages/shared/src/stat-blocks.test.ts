import { describe, expect, it } from 'vitest';

import { createStatBlockRequestSchema, updateStatBlockRequestSchema } from './stat-blocks';

describe('createStatBlockRequestSchema', () => {
  it('needs a name, with an optional tier and role', () => {
    expect(createStatBlockRequestSchema.parse({ name: ' Reef Shark ' })).toEqual({
      name: 'Reef Shark',
    });
    expect(
      createStatBlockRequestSchema.parse({ name: 'Reef Shark', tier: 2, role: 'Bruiser' }),
    ).toEqual({ name: 'Reef Shark', tier: 2, role: 'Bruiser' });
    expect(createStatBlockRequestSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(createStatBlockRequestSchema.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
    expect(createStatBlockRequestSchema.safeParse({ name: 'S', tier: 0 }).success).toBe(false);
    expect(createStatBlockRequestSchema.safeParse({ name: 'S', hpMax: 3 }).success).toBe(false);
  });
});

describe('updateStatBlockRequestSchema', () => {
  const attack = { name: 'Bite', range: 'Melee', damageDice: '1d8+2', damageType: 'physical' };

  it('accepts any subset, and null only for the standard attack', () => {
    expect(updateStatBlockRequestSchema.safeParse({ standardAttack: attack }).success).toBe(true);
    expect(updateStatBlockRequestSchema.safeParse({ standardAttack: null }).success).toBe(true);
    expect(updateStatBlockRequestSchema.safeParse({ hpMax: null }).success).toBe(false);
    expect(updateStatBlockRequestSchema.safeParse({ motives: null }).success).toBe(false);
    expect(updateStatBlockRequestSchema.safeParse({}).success).toBe(false);
  });

  it('allows a negative attack modifier but no negative numbers elsewhere', () => {
    expect(updateStatBlockRequestSchema.safeParse({ attackModifier: -2 }).success).toBe(true);
    expect(updateStatBlockRequestSchema.safeParse({ difficulty: -1 }).success).toBe(false);
    expect(updateStatBlockRequestSchema.safeParse({ attackModifier: 100 }).success).toBe(false);
  });

  it('checks attacks, features and motives', () => {
    expect(
      updateStatBlockRequestSchema.safeParse({ standardAttack: { ...attack, damageDice: 'big' } })
        .success,
    ).toBe(false);
    expect(
      updateStatBlockRequestSchema.safeParse({
        features: [{ name: 'Thrash', kind: 'reaction', cost: 'Mark a Stress', description: '' }],
      }).success,
    ).toBe(true);
    expect(
      updateStatBlockRequestSchema.safeParse({
        features: [{ name: 'Thrash', kind: 'bonus', cost: '', description: '' }],
      }).success,
    ).toBe(false);
    expect(updateStatBlockRequestSchema.parse({ motives: [' Circle ', 'Bite'] })).toEqual({
      motives: ['Circle', 'Bite'],
    });
    expect(updateStatBlockRequestSchema.safeParse({ motives: [''] }).success).toBe(false);
    expect(
      updateStatBlockRequestSchema.safeParse({ motives: Array.from({ length: 21 }, () => 'x') })
        .success,
    ).toBe(false);
  });
});
