import { describe, expect, it } from 'vitest';

import {
  classDomainIdsSchema,
  createClassRequestSchema,
  createSubclassRequestSchema,
  emptyHopeFeature,
  FEATURE_LIST_MAX,
  followsCreationSpread,
  hopeFeatureSchema,
  SAME_DOMAIN_TWICE,
  suggestedTraitsSchema,
  updateClassRequestSchema,
  updateSubclassRequestSchema,
} from './classes';
import { rulesetFor } from './ruleset';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';

const spread = {
  agility: 2,
  strength: 1,
  finesse: 1,
  instinct: 0,
  presence: 0,
  knowledge: -1,
};

describe('followsCreationSpread (F4.5)', () => {
  const v2 = rulesetFor(2);

  it('accepts the creation spread in any order', () => {
    expect(followsCreationSpread(spread, v2)).toBe(true);
    expect(
      followsCreationSpread(
        { agility: -1, strength: 0, finesse: 2, instinct: 1, presence: 0, knowledge: 1 },
        v2,
      ),
    ).toBe(true);
  });

  it('refuses a wrong spread, a missing trait or an unknown one', () => {
    expect(followsCreationSpread({ ...spread, knowledge: 0 }, v2)).toBe(false);
    expect(followsCreationSpread({}, v2)).toBe(false);
    const five = { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0 };
    expect(followsCreationSpread(five, v2)).toBe(false);
    expect(followsCreationSpread({ ...five, luck: -1 }, v2)).toBe(false);
  });

  it('is false for a ruleset without a spread', () => {
    expect(followsCreationSpread(spread, rulesetFor(1))).toBe(false);
  });
});

describe('class requests (F4.5)', () => {
  it('creates with a name only', () => {
    expect(createClassRequestSchema.parse({ name: '  Warrior ' })).toEqual({ name: 'Warrior' });
    expect(createClassRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createClassRequestSchema.safeParse({ name: 'Bard', startingHp: 5 }).success).toBe(false);
  });

  it('takes two different domains, either unset', () => {
    expect(classDomainIdsSchema.safeParse([A, B]).success).toBe(true);
    expect(classDomainIdsSchema.safeParse([A, null]).success).toBe(true);
    expect(classDomainIdsSchema.safeParse([null, null]).success).toBe(true);
    const twice = classDomainIdsSchema.safeParse([A, A]);
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]?.message).toBe(SAME_DOMAIN_TWICE);
  });

  it('refuses an empty patch and unknown keys', () => {
    expect(updateClassRequestSchema.safeParse({}).success).toBe(false);
    expect(updateClassRequestSchema.safeParse({ tier: 1 }).success).toBe(false);
    expect(updateClassRequestSchema.parse({ suggestedArmorId: null })).toEqual({
      suggestedArmorId: null,
    });
  });

  it('keeps Hope costs and suggested traits in range', () => {
    expect(hopeFeatureSchema.parse(emptyHopeFeature())).toEqual({ name: '', cost: 3, text: '' });
    expect(hopeFeatureSchema.safeParse({ name: 'Rally', cost: 7, text: '' }).success).toBe(false);
    expect(suggestedTraitsSchema.safeParse({ agility: 3 }).success).toBe(false);
    expect(suggestedTraitsSchema.safeParse({ agility: -2 }).success).toBe(false);
    expect(suggestedTraitsSchema.parse(spread)).toEqual(spread);
  });

  it('caps a feature list and needs a name on each row', () => {
    const row = { name: 'Combat Training', text: 'Ignore burden.' };
    expect(updateClassRequestSchema.safeParse({ classFeatures: [row] }).success).toBe(true);
    expect(
      updateClassRequestSchema.safeParse({ classFeatures: [{ name: ' ', text: '' }] }).success,
    ).toBe(false);
    const many = Array.from({ length: FEATURE_LIST_MAX + 1 }, () => row);
    expect(updateClassRequestSchema.safeParse({ classFeatures: many }).success).toBe(false);
  });
});

describe('subclass requests (F4.5)', () => {
  it('creates in a class, with a name', () => {
    expect(createSubclassRequestSchema.parse({ classId: A, name: 'Troubadour' })).toEqual({
      classId: A,
      name: 'Troubadour',
    });
    expect(createSubclassRequestSchema.safeParse({ name: 'Troubadour' }).success).toBe(false);
  });

  it('can clear the spellcast trait but not move to another class', () => {
    expect(updateSubclassRequestSchema.parse({ spellcastTrait: null })).toEqual({
      spellcastTrait: null,
    });
    expect(updateSubclassRequestSchema.safeParse({ classId: B }).success).toBe(false);
    expect(updateSubclassRequestSchema.safeParse({}).success).toBe(false);
  });
});
