import { describe, expect, it } from 'vitest';

import {
  BUILD_MESSAGES,
  buildCharacterRequestSchema,
  creationCardProblem,
  defaultGearProblem,
  EMPTY_KIT,
  startingGearSchema,
  startingItems,
  traitSpreadMessage,
  traitsProblem,
} from './character-build';
import { SPECIES_PAIR } from './character-sheets';
import { emptyRichText } from './rich-text';
import { rulesetFor } from './ruleset';

const v1 = rulesetFor(1);
const v2 = rulesetFor(2);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const REQUEST = {
  name: 'Vex',
  publicDescription: emptyRichText(),
  classId: id(1),
  subclassId: id(2),
  speciesIds: [id(3), null],
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
  gear: { primaryWeaponId: id(4), secondaryWeaponId: null, armorId: id(5), potion: 'health' },
  cardIds: [id(6), id(7)],
};

describe('buildCharacterRequestSchema', () => {
  it('parses what the guide sends, with or without gear picks', () => {
    expect(buildCharacterRequestSchema.parse(REQUEST)).toEqual(REQUEST);
    expect(buildCharacterRequestSchema.parse({ ...REQUEST, gear: null }).gear).toBeNull();
  });

  it('refuses the same species twice, a missing class, a missing potion and unknown keys', () => {
    const issues = (input: unknown) =>
      buildCharacterRequestSchema.safeParse(input).error?.issues.map((issue) => issue.message);
    expect(issues({ ...REQUEST, speciesIds: [id(3), id(3)] })).toEqual([SPECIES_PAIR]);
    expect(issues({ ...REQUEST, classId: '' })).toEqual(['Pick a class']);
    expect(issues({ ...REQUEST, gear: { ...REQUEST.gear, potion: 'ale' } })).toEqual([
      'Pick a potion',
    ]);
    expect(buildCharacterRequestSchema.safeParse({ ...REQUEST, level: 3 }).success).toBe(false);
  });
});

describe('startingGearSchema', () => {
  it('parses a mode and a kit', () => {
    const gear = {
      mode: 'set',
      kit: { ...EMPTY_KIT, armorId: id(5), items: [{ name: 'Lute', detail: 'Worn' }] },
    };
    expect(startingGearSchema.parse(gear)).toEqual(gear);
    expect(startingGearSchema.safeParse({ ...gear, mode: 'some' }).success).toBe(false);
    expect(
      startingGearSchema.safeParse({ ...gear, kit: { ...gear.kit, items: [{ name: '' }] } })
        .success,
    ).toBe(false);
  });
});

describe('traitsProblem', () => {
  it('passes the creation spread and says the spread otherwise', () => {
    expect(traitsProblem(REQUEST.traits, v2)).toBeNull();
    expect(traitsProblem({ ...REQUEST.traits, knowledge: 0 }, v2)).toBe(
      'Give your traits +2, +1, +1, 0, 0 and −1, one each',
    );
    expect(traitSpreadMessage(v2)).toBe('Give your traits +2, +1, +1, 0, 0 and −1, one each');
    expect(traitsProblem(REQUEST.traits, v1)).not.toBeNull();
  });
});

describe('defaultGearProblem', () => {
  const primary = { slot: 'primary', tier: 1, burden: 'one_handed' } as const;
  const secondary = { slot: 'secondary', tier: 1 } as const;
  const armor = { tier: 1 };

  it('passes a tier 1 primary and armor, with or without a secondary', () => {
    expect(defaultGearProblem({ primary, secondary, armor })).toBeNull();
    expect(defaultGearProblem({ primary, secondary: null, armor })).toBeNull();
  });

  it('names what is missing or wrong', () => {
    const cases = [
      [{ primary: null, secondary: null, armor }, BUILD_MESSAGES.primaryNeeded],
      [{ primary: { ...primary, tier: 2 }, secondary: null, armor }, BUILD_MESSAGES.primary],
      [
        { primary: { ...primary, slot: 'secondary' }, secondary: null, armor },
        BUILD_MESSAGES.primary,
      ],
      [{ primary, secondary: { ...secondary, tier: 2 }, armor }, BUILD_MESSAGES.secondary],
      [{ primary, secondary: { ...secondary, slot: 'primary' }, armor }, BUILD_MESSAGES.secondary],
      [
        { primary: { ...primary, burden: 'two_handed' }, secondary, armor },
        BUILD_MESSAGES.twoHanded,
      ],
      [{ primary, secondary: null, armor: null }, BUILD_MESSAGES.armorNeeded],
      [{ primary, secondary: null, armor: { tier: 2 } }, BUILD_MESSAGES.armor],
    ] as const;
    for (const [gear, message] of cases) {
      expect(defaultGearProblem(gear)).toBe(message);
    }
  });
});

describe('creationCardProblem', () => {
  const GRACE = id(10);
  const BLADE = id(11);
  const card = (n: number, over: { level?: number; domainId?: string } = {}) => ({
    id: id(n),
    name: `Card ${String(n)}`,
    domainId: GRACE,
    level: 1,
    ...over,
  });

  it('passes two different level-1 cards from the class domains', () => {
    expect(creationCardProblem([card(1), card(2, { domainId: BLADE })], [GRACE, BLADE], v2)).toBe(
      null,
    );
  });

  it('refuses the wrong count, a card twice, a higher level and another domain', () => {
    const domains = [GRACE, null];
    expect(creationCardProblem([card(1)], domains, v2)).toBe('Pick 2 different domain cards');
    expect(creationCardProblem([card(1), card(1)], domains, v2)).toBe(
      'Pick 2 different domain cards',
    );
    expect(creationCardProblem([card(1), card(2, { level: 2 })], domains, v2)).toBe(
      'Card 2 is level 2: pick level 1 cards',
    );
    expect(creationCardProblem([card(1), card(2, { domainId: BLADE })], domains, v2)).toBe(
      "Card 2 isn't from your class's domains",
    );
  });
});

describe('startingItems', () => {
  it('gives the default items, the potion and a handful of gold', () => {
    const { items, gold } = startingItems('default', EMPTY_KIT, 'stamina');
    expect(items.map((item) => item.name)).toEqual([
      'Torch',
      '50 feet of rope',
      'Basic supplies',
      'Minor Stamina Potion',
    ]);
    expect(gold).toEqual({ handfuls: 1, bags: 0, chests: 0 });
  });

  it("gives the GM's kit, or nothing", () => {
    const kit = {
      items: [{ name: 'Lute', detail: '' }],
      gold: { handfuls: 0, bags: 2, chests: 0 },
    };
    expect(startingItems('set', kit, null)).toEqual(kit);
    expect(startingItems('none', kit, null)).toEqual({
      items: [],
      gold: { handfuls: 0, bags: 0, chests: 0 },
    });
  });
});
