import { describe, expect, it } from 'vitest';

import {
  characterSheetPatchSchemaFor,
  characterSheetSchema,
  PLAYER_CHARACTER_SHEET_KEYS,
  playerCharacterSheetSchema,
  type CharacterSheet,
  type CharacterSheetLimits,
} from './character-sheets';
import { emptyRichText } from './rich-text';
import { rulesetFor } from './ruleset';

const ITEM_ID = '5d1a0c7e-2b3f-4e8a-9c61-0f4b2d7e8a19';

const v1 = rulesetFor(1);
const patch = (body: unknown, current?: CharacterSheetLimits) =>
  characterSheetPatchSchemaFor(v1, current).safeParse(body);
const messages = (body: unknown, current?: CharacterSheetLimits) => {
  const result = patch(body, current);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

const TRAITS = { agility: 2, strength: 1, finesse: 0, instinct: 0, presence: -1, knowledge: 1 };
const WEAPON = {
  name: 'Longsword',
  trait: 'strength',
  range: 'Melee',
  damageDice: '1d10+3',
  damageType: 'physical',
  feature: '',
};

const SHEET: CharacterSheet = {
  id: '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11',
  name: 'Vex',
  assignedToUserId: null,
  level: 1,
  className: 'Ranger',
  publicDescription: emptyRichText(),
  gmNotes: emptyRichText(),
  visualAssetId: null,
  traits: TRAITS,
  evasion: 10,
  armorScore: 3,
  armorSlotsMax: 3,
  armorSlotsMarked: 1,
  minorThreshold: 1,
  majorThreshold: 6,
  severeThreshold: 12,
  hpMax: 6,
  hpCurrent: 6,
  stressMax: 6,
  stressCurrent: 0,
  hope: 2,
  proficiency: 1,
  experiences: [{ name: 'Sailor', bonus: 2 }],
  weapons: { primary: WEAPON, secondary: null, inventory: [] },
  armor: null,
  inventory: [{ name: 'Rope', detail: '50 ft' }],
  gold: { handfuls: 1, bags: 0, chests: 0 },
  classFeature: null,
  combatOptions: [{ name: 'Volley', kind: 'action', cost: '1 Hope', description: '' }],
  createdAt: '2026-11-10T12:00:00.000Z',
  updatedAt: '2026-11-10T12:00:00.000Z',
};

describe('characterSheetSchema', () => {
  it('parses a full sheet', () => {
    expect(characterSheetSchema.parse(SHEET)).toEqual(SHEET);
  });
});

describe('playerCharacterSheetSchema', () => {
  it('allows exactly the listed keys: no GM notes, no player id', () => {
    const parsed = playerCharacterSheetSchema.parse(SHEET);
    expect(Object.keys(parsed).sort()).toEqual([...PLAYER_CHARACTER_SHEET_KEYS].sort());
    expect(parsed).not.toHaveProperty('gmNotes');
    expect(parsed).not.toHaveProperty('assignedToUserId');
    // The visual stays the GM's until the stage needs it (F2.3).
    expect(parsed).not.toHaveProperty('visualAssetId');
  });

  it("drops an inventory row's Item record link, keeping its name and detail", () => {
    const linked = {
      ...SHEET,
      inventory: [{ name: 'Tide key', detail: 'Cold', recordId: ITEM_ID }],
    };
    expect(characterSheetSchema.parse(linked).inventory[0]?.recordId).toBe(ITEM_ID);
    expect(playerCharacterSheetSchema.parse(linked).inventory).toEqual([
      { name: 'Tide key', detail: 'Cold' },
    ]);
  });
});

describe('characterSheetPatchSchemaFor', () => {
  it('accepts every key with valid values, and trims text', () => {
    const body = {
      name: ' Vex ',
      level: 2,
      className: ' Ranger ',
      traits: TRAITS,
      evasion: 11,
      hope: 6,
      experiences: [{ name: 'Sailor', bonus: 2 }],
      weapons: { primary: { ...WEAPON, damageDice: '1D10+3' }, secondary: null, inventory: [] },
      armor: {
        name: 'Leather',
        baseMajorThreshold: 6,
        baseSevereThreshold: 13,
        baseScore: 3,
        feature: '',
      },
      inventory: [],
      gold: { handfuls: 2, bags: 1, chests: 0 },
      classFeature: { name: 'Ranger’s Focus', description: '' },
      combatOptions: SHEET.combatOptions,
    };
    const result = patch(body);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: 'Vex',
      className: 'Ranger',
      weapons: { primary: { damageDice: '1d10+3' } },
    });
  });

  it('refuses an empty patch and unknown keys', () => {
    expect(messages({})).toEqual([': Nothing to update']);
    expect(patch({ id: SHEET.id }).success).toBe(false);
    expect(patch({ gmSecret: 'x' }).success).toBe(false);
  });

  it('allows null only where it removes something', () => {
    expect(patch({ armor: null, classFeature: null }).success).toBe(true);
    for (const key of ['hpMax', 'level', 'traits', 'weapons', 'experiences', 'name', 'gold']) {
      expect(patch({ [key]: null }).success, key).toBe(false);
    }
  });

  it('checks traits against the ruleset: every trait, in range, nothing else', () => {
    expect(messages({ traits: { ...TRAITS, agility: 3 } })).toEqual([
      'traits.agility: Must be from -1 to +2',
    ]);
    expect(messages({ traits: { ...TRAITS, presence: -2 } })).toEqual([
      'traits.presence: Must be from -1 to +2',
    ]);
    expect(patch({ traits: { ...TRAITS, luck: 1 } }).success).toBe(false);
    const missing = Object.fromEntries(Object.entries(TRAITS).filter(([id]) => id !== 'knowledge'));
    expect(patch({ traits: missing }).success).toBe(false);
  });

  it('caps Hope at the ruleset max', () => {
    expect(patch({ hope: 6 }).success).toBe(true);
    expect(messages({ hope: 7 })).toEqual(["hope: Hope can't be above 6"]);
    expect(patch({ hope: -1 }).success).toBe(false);
  });

  it('checks numbers are whole and in range', () => {
    expect(patch({ evasion: 1.5 }).success).toBe(false);
    expect(patch({ evasion: -1 }).success).toBe(false);
    expect(patch({ hpMax: 1000 }).success).toBe(false);
    expect(patch({ level: 0 }).success).toBe(false);
  });

  it('checks a weapon’s trait and damage dice', () => {
    const weapons = (primary: object) => ({ weapons: { primary, secondary: null, inventory: [] } });
    expect(patch(weapons({ ...WEAPON, trait: null })).success).toBe(true);
    expect(patch(weapons({ ...WEAPON, trait: 'luck' })).success).toBe(false);
    for (const dice of ['2d6', '1d8-1', '10d20+12']) {
      expect(patch(weapons({ ...WEAPON, damageDice: dice })).success, dice).toBe(true);
    }
    for (const dice of ['d6', '0d6', '1d7', '2d6+', '1d6+0', '1d6 + 2', '']) {
      expect(patch(weapons({ ...WEAPON, damageDice: dice })).success, dice).toBe(false);
    }
  });

  it('keeps current values at or below their max, within one patch', () => {
    expect(messages({ hpMax: 5, hpCurrent: 6 })).toEqual(["hpCurrent: Can't be above HP max (5)"]);
    expect(messages({ stressMax: 2, stressCurrent: 3 })).toEqual([
      "stressCurrent: Can't be above Stress max (2)",
    ]);
    expect(patch({ hpMax: 6, hpCurrent: 6 }).success).toBe(true);
  });

  it('checks against the stored sheet, naming the key that was sent', () => {
    expect(messages({ hpCurrent: 7 }, SHEET)).toEqual(["hpCurrent: Can't be above HP max (6)"]);
    expect(messages({ hpMax: 4 }, SHEET)).toEqual([
      "hpMax: Can't be below current HP (6); lower that first",
    ]);
    expect(messages({ armorSlotsMax: 0 }, SHEET)).toEqual([
      "armorSlotsMax: Can't be below marked slots (1); lower that first",
    ]);
    expect(patch({ hpMax: 4, hpCurrent: 4 }, SHEET).success).toBe(true);
    expect(patch({ evasion: 12 }, SHEET).success).toBe(true);
  });

  it('has no ordering rule for damage thresholds', () => {
    expect(patch({ minorThreshold: 9, majorThreshold: 3, severeThreshold: 0 }).success).toBe(true);
  });

  it('accepts an inventory row linked to an Item record, by id only', () => {
    const schema = characterSheetPatchSchemaFor(rulesetFor(1));
    expect(
      schema.parse({ inventory: [{ name: 'Tide key', detail: '', recordId: ITEM_ID }] }),
    ).toEqual({ inventory: [{ name: 'Tide key', detail: '', recordId: ITEM_ID }] });
    expect(
      schema.safeParse({ inventory: [{ name: 'Tide key', detail: '', recordId: 'nope' }] }).success,
    ).toBe(false);
  });

  it('limits list lengths', () => {
    const experiences = Array.from({ length: 51 }, (_, i) => ({ name: `E${String(i)}`, bonus: 1 }));
    expect(patch({ experiences }).success).toBe(false);
    expect(patch({ experiences: experiences.slice(0, 50) }).success).toBe(true);
  });
});
