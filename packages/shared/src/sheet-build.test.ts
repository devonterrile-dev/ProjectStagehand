import { describe, expect, it } from 'vitest';

import { characterSheetPatchSchemaFor, SPECIES_PAIR } from './character-sheets';
import type { DomainCard } from './domains';
import { noGearBonuses, type ArmorRecord, type WeaponRecord } from './gear';
import { emptyRichText } from './rich-text';
import { rulesetFor } from './ruleset';
import {
  buildSheet,
  effectiveTraits,
  equippedBonuses,
  moveHeldCardRequestSchema,
  NO_SHEET_RECORDS,
  noSheetLinks,
  notEnoughStress,
  unlinkedSheetParts,
  type SheetRecords,
  type StoredSheet,
} from './sheet-build';

const v2 = rulesetFor(2);
const AT = '2026-11-21T12:00:00.000Z';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const STORED: StoredSheet = {
  name: 'Vex',
  level: 3,
  className: 'Typed class',
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
  evasion: 10,
  armorScore: 2,
  armorSlotsMax: 2,
  minorThreshold: 3,
  majorThreshold: 7,
  severeThreshold: 14,
  proficiency: 2,
  weapons: {
    primary: {
      name: 'Old sword',
      trait: 'strength',
      range: 'Melee',
      damageDice: '1d8',
      damageType: 'physical',
      feature: '',
    },
    secondary: null,
    inventory: [],
  },
  armor: { name: 'Old leather' },
};

const weapon = (over: Partial<WeaponRecord>): WeaponRecord => ({
  id: id(1),
  tier: 1,
  name: 'Greatsword',
  slot: 'primary',
  kind: 'physical',
  trait: 'strength',
  range: 'melee',
  damageDie: 10,
  damageBonus: 3,
  burden: 'two_handed',
  featureName: 'Massive',
  featureText: '−1 to Evasion',
  bonuses: { ...noGearBonuses(), evasion: -1 },
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const ARMOR: ArmorRecord = {
  id: id(2),
  tier: 1,
  name: 'Chainmail',
  baseMajorThreshold: 7,
  baseSevereThreshold: 15,
  baseScore: 4,
  featureName: 'Heavy',
  featureText: '−1 to Evasion',
  bonuses: { ...noGearBonuses(), evasion: -1, traits: { agility: -1 } },
  createdAt: AT,
  updatedAt: AT,
};

const card = (over: Partial<DomainCard>): DomainCard => ({
  id: id(10),
  name: 'Whirlwind',
  domainId: id(20),
  domainName: 'Blade',
  level: 1,
  recallCost: 1,
  type: 'ability',
  feature: emptyRichText(),
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const records = (over: Partial<SheetRecords>): SheetRecords => ({ ...NO_SHEET_RECORDS, ...over });

describe('buildSheet (F4.7)', () => {
  it('shows the typed values of a sheet that links nothing', () => {
    const { built, cards } = buildSheet(STORED, noSheetLinks(), NO_SHEET_RECORDS, v2);
    expect(built).toMatchObject({
      className: 'Typed class',
      traits: STORED.traits,
      evasion: 10,
      armorScore: 2,
      armorSlotsMax: 2,
      thresholds: { minor: 3, major: 7, severe: 14 },
      armorName: 'Old leather',
      linked: { class: false, armor: false, primary: false, secondary: false },
      warnings: [],
    });
    expect(built.weapons.primary).toMatchObject({ weaponId: null, damage: '1d8', range: 'Melee' });
    expect(cards).toMatchObject({ class: null, subclass: null, species: [], loadout: [] });
  });

  it('works out armor, thresholds, evasion and traits from linked gear', () => {
    const { built } = buildSheet(
      STORED,
      noSheetLinks(),
      records({ primary: weapon({}), armor: ARMOR }),
      v2,
    );
    expect(built).toMatchObject({
      evasion: 8,
      armorScore: 4,
      armorSlotsMax: 4,
      thresholds: { minor: null, major: 10, severe: 18 },
      armorName: 'Chainmail',
      linked: { armor: true, primary: true },
    });
    expect(built.traits['agility']).toBe(1);
    expect(built.weapons.primary).toEqual({
      weaponId: id(1),
      name: 'Greatsword',
      trait: 'strength',
      range: 'Melee',
      damage: '2d10+3',
      damageType: 'physical',
      burden: 'two_handed',
      feature: 'Massive: −1 to Evasion',
    });
  });

  it('adds gear bonuses to typed armor too, and warns about gear above the tier', () => {
    const shield = weapon({
      id: id(3),
      name: 'Tower shield',
      slot: 'secondary',
      burden: 'one_handed',
      tier: 3,
      featureName: '',
      featureText: '',
      bonuses: { ...noGearBonuses(), armorScore: 1, majorThreshold: 2 },
    });
    const { built } = buildSheet(STORED, noSheetLinks(), records({ secondary: shield }), v2);
    expect(built.armorScore).toBe(3);
    expect(built.armorSlotsMax).toBe(2);
    expect(built.thresholds).toEqual({ minor: 3, major: 9, severe: 14 });
    expect(built.weapons.secondary?.feature).toBe('');
    expect(built.warnings).toEqual(["Tower shield is tier 3, above Vex's tier (2)"]);
  });

  it('lists typed spares, then linked ones', () => {
    const knife = {
      name: 'Knife',
      trait: 'finesse',
      range: 'Melee',
      damageDice: '1d4',
      damageType: 'physical',
      feature: '',
    };
    const typed = { ...STORED.weapons, inventory: [knife] };
    const { built } = buildSheet(
      { ...STORED, weapons: typed },
      noSheetLinks(),
      records({ spares: [weapon({ name: 'Spare axe', featureName: '', featureText: 'Heavy' })] }),
      v2,
    );
    expect(built.weapons.spares.map((one) => [one.name, one.feature])).toEqual([
      ['Knife', ''],
      ['Spare axe', 'Heavy'],
    ]);
  });

  it('gives the class, the subclass cards held and the species features', () => {
    const subclass = {
      id: id(5),
      name: 'Troubadour',
      className: 'Bard',
      spellcastTrait: 'presence',
      foundation: [{ name: 'Gifted Performer', text: '' }],
      specialization: [{ name: 'Maestro', text: '' }],
      mastery: [{ name: 'Virtuoso', text: '' }],
    };
    const bard = {
      id: id(4),
      name: 'Bard',
      domainIds: [id(20), id(21)],
      hopeFeature: { name: 'Make a Scene', cost: 3, text: '' },
      classFeatures: [{ name: 'Rally', text: '' }],
    };
    const faerie = {
      id: id(6),
      name: 'Faerie',
      features: [
        { name: 'Luckbender', text: '' },
        { name: 'Wings', text: '' },
      ],
    };
    const orc = {
      id: id(7),
      name: 'Orc',
      features: [
        { name: 'Sturdy', text: '' },
        { name: 'Tusks', text: '' },
      ],
    };

    const one = buildSheet(
      STORED,
      { subclassCards: 2 },
      records({ class: bard, subclass, species: [faerie, null] }),
      v2,
    );
    expect(one.built.className).toBe('Bard');
    expect(one.cards.class?.hopeFeature.name).toBe('Make a Scene');
    expect(one.cards.subclass).toMatchObject({
      foundation: subclass.foundation,
      specialization: subclass.specialization,
      mastery: null,
    });
    expect(one.cards.species).toEqual([faerie]);

    const mixed = buildSheet(STORED, { subclassCards: 0 }, records({ species: [faerie, orc] }), v2);
    expect(mixed.cards.species.map((s) => s.features.map((f) => f.name))).toEqual([
      ['Luckbender'],
      ['Tusks'],
    ]);
  });

  it('sorts held cards by place and level, and warns without refusing', () => {
    const bard = {
      id: id(4),
      name: 'Bard',
      domainIds: [id(20), null],
      hopeFeature: { name: '', cost: 3, text: '' },
      classFeatures: [],
    };
    const { cards } = buildSheet(
      STORED,
      noSheetLinks(),
      records({
        class: bard,
        cards: [
          { card: card({ id: id(11), name: 'Zap', level: 2 }), place: 'loadout', takenAtLevel: 2 },
          { card: card({ id: id(12), name: 'Bolt', level: 5 }), place: 'loadout', takenAtLevel: 3 },
          {
            card: card({ id: id(13), name: 'Mend', domainId: id(30), domainName: 'Splendor' }),
            place: 'vault',
            takenAtLevel: 1,
          },
        ],
      }),
      v2,
    );
    expect(cards.loadout.map((held) => [held.name, held.warning])).toEqual([
      ['Zap', null],
      ['Bolt', "Level 5, above Vex's level (3)"],
    ]);
    expect(cards.vault[0]?.warning).toBe("Splendor isn't one of Bard's domains");
  });
});

describe('gear bonuses on a sheet (19.25)', () => {
  it('sums equipped bonuses, traits included', () => {
    const total = equippedBonuses([weapon({}), null, ARMOR]);
    expect(total).toEqual({
      evasion: -2,
      armorScore: 0,
      majorThreshold: 0,
      severeThreshold: 0,
      traits: { agility: -1 },
    });
    expect(effectiveTraits({ agility: 2 }, total, v2)).toEqual({
      agility: 1,
      strength: 0,
      finesse: 0,
      instinct: 0,
      presence: 0,
      knowledge: 0,
    });
  });
});

describe('sheet link and card requests (F4.7)', () => {
  const patch = characterSheetPatchSchemaFor(v2);

  it('takes links, and null unlinks', () => {
    expect(patch.parse({ armorId: id(2), classId: null })).toEqual({
      armorId: id(2),
      classId: null,
    });
    expect(patch.safeParse({ subclassCards: 4 }).success).toBe(false);
    expect(patch.safeParse({ spareWeaponIds: [id(1), id(1)] }).success).toBe(true);
  });

  it('wants two different species, the first one first', () => {
    expect(patch.safeParse({ speciesIds: [id(6), id(7)] }).success).toBe(true);
    expect(patch.safeParse({ speciesIds: [id(6), null] }).success).toBe(true);
    for (const pair of [
      [id(6), id(6)],
      [null, id(7)],
    ]) {
      const result = patch.safeParse({ speciesIds: pair });
      expect(result.error?.issues[0]?.message).toBe(SPECIES_PAIR);
    }
  });

  it('moves into the loadout or the vault', () => {
    expect(moveHeldCardRequestSchema.parse({ to: 'loadout', swapOut: id(1) })).toEqual({
      to: 'loadout',
      swapOut: id(1),
    });
    expect(moveHeldCardRequestSchema.safeParse({ to: 'hand' }).success).toBe(false);
    expect(notEnoughStress(3, 1)).toBe('Bringing it back marks 3 Stress; only 1 left');
  });

  it('builds the parts of an unlinked sheet', () => {
    expect(unlinkedSheetParts(STORED, v2).links).toEqual(noSheetLinks());
  });
});
