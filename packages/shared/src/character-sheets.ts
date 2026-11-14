/**
 * Character sheets (F1.4, governance §8 "Character sheet"). A sheet is a row of the
 * `characters` table: the in-play numbers are columns, the lists and sections are JSON
 * (D-23). Trait ids, the trait range and the Hope max come from the campaign's ruleset, so
 * the patch schema is built per ruleset.
 *
 * The GM sees the whole sheet. A player sees only their own PC, through the explicit
 * allow-list in `playerCharacterSheetSchema`, and can't edit it in Phase 1 (D-23, 19.7).
 */
import { z } from 'zod';

import { characterNameSchema } from './characters';
import { richTextSchema } from './rich-text';
import { traitIdsOf, type Ruleset } from './ruleset';
import {
  abilitySchema,
  armorSchema,
  classFeatureSchema,
  experienceSchema,
  goldSchema,
  inventoryItemSchema,
  playerInventoryItemSchema,
  sheetListSchema,
  SHEET_NUMBER_MAX,
  sheetNumberSchema,
  shortTextSchema,
  weaponSchema,
  weaponSchemaWith,
} from './sheet-parts';

const timestamp = z.iso.datetime({ offset: true });

/** A PC's full sheet, as the GM sees it. */
export const characterSheetSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The player who has this PC, or null if unassigned. */
  assignedToUserId: z.uuid().nullable(),

  // Identity
  level: z.int(),
  className: z.string(),
  publicDescription: richTextSchema,
  /** Private to the GM; never sent to the player. */
  gmNotes: richTextSchema,
  /** The puppet's visual in use ("Use this one", F2.3), or null. GM only for now. */
  visualAssetId: z.uuid().nullable(),

  /** Trait id → modifier, one entry per trait of the campaign's ruleset. */
  traits: z.record(z.string(), z.int()),

  // Defense
  evasion: z.int(),
  armorScore: z.int(),
  armorSlotsMax: z.int(),
  armorSlotsMarked: z.int(),

  // Health
  minorThreshold: z.int(),
  majorThreshold: z.int(),
  severeThreshold: z.int(),
  hpMax: z.int(),
  hpCurrent: z.int(),
  stressMax: z.int(),
  stressCurrent: z.int(),

  hope: z.int(),
  proficiency: z.int(),

  experiences: z.array(experienceSchema),
  weapons: z.object({
    primary: weaponSchema.nullable(),
    secondary: weaponSchema.nullable(),
    /** Weapons carried but not equipped. */
    inventory: z.array(weaponSchema),
  }),
  armor: armorSchema.nullable(),
  inventory: z.array(inventoryItemSchema),
  gold: goldSchema,
  classFeature: classFeatureSchema.nullable(),
  /** What the player can pick from in battle (F4.2). */
  combatOptions: z.array(abilitySchema),

  createdAt: timestamp,
  updatedAt: timestamp,
});
export type CharacterSheet = z.infer<typeof characterSheetSchema>;

/**
 * What a player may receive about their own PC: an explicit allow-list (governance §7
 * rule 5). Anything not listed here, such as the GM's notes, never reaches their browser.
 */
const PLAYER_SHEET_KEYS = {
  id: true,
  name: true,
  level: true,
  className: true,
  publicDescription: true,
  traits: true,
  evasion: true,
  armorScore: true,
  armorSlotsMax: true,
  armorSlotsMarked: true,
  minorThreshold: true,
  majorThreshold: true,
  severeThreshold: true,
  hpMax: true,
  hpCurrent: true,
  stressMax: true,
  stressCurrent: true,
  hope: true,
  proficiency: true,
  experiences: true,
  weapons: true,
  armor: true,
  inventory: true,
  gold: true,
  classFeature: true,
  combatOptions: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * `GET …/characters/:characterId` as the PC's own player. Inventory rows lose their Item
 * record link (D-24): the player sees each row's name and detail only.
 */
export const playerCharacterSheetSchema = characterSheetSchema
  .pick(PLAYER_SHEET_KEYS)
  .extend({ inventory: z.array(playerInventoryItemSchema) });
export type PlayerCharacterSheet = z.infer<typeof playerCharacterSheetSchema>;

/** Every key a player may receive, for tests and serializers. */
export const PLAYER_CHARACTER_SHEET_KEYS = Object.keys(
  PLAYER_SHEET_KEYS,
) as readonly (keyof PlayerCharacterSheet)[];

/** The GM-editable part of a sheet. Each key replaces its whole value (D-23). */
export type CharacterSheetPatch = Partial<
  Omit<CharacterSheet, 'id' | 'assignedToUserId' | 'createdAt' | 'updatedAt'>
>;

/** The stored values the cross-field rules compare against. */
export type CharacterSheetLimits = Pick<
  CharacterSheet,
  'hpMax' | 'hpCurrent' | 'stressMax' | 'stressCurrent' | 'armorSlotsMax' | 'armorSlotsMarked'
>;

function patchShapeFor(ruleset: Ruleset) {
  const traitIds = traitIdsOf(ruleset);
  const { min, max } = ruleset.traitModifier;
  const range = `Must be from ${String(min)} to +${String(max)}`;
  const modifier = z.int('Must be a whole number').min(min, range).max(max, range);
  const traits = z.strictObject(Object.fromEntries(traitIds.map((id) => [id, modifier])));
  const weapon = weaponSchemaWith(
    z.enum(traitIds as [string, ...string[]], 'Pick one of the traits').nullable(),
  );
  return {
    name: characterNameSchema,
    level: z
      .int('Must be a whole number')
      .min(1, 'Level must be 1 or more')
      .max(SHEET_NUMBER_MAX, `Must be ${String(SHEET_NUMBER_MAX)} or less`),
    className: shortTextSchema,
    publicDescription: richTextSchema,
    gmNotes: richTextSchema,
    traits,
    evasion: sheetNumberSchema,
    armorScore: sheetNumberSchema,
    armorSlotsMax: sheetNumberSchema,
    armorSlotsMarked: sheetNumberSchema,
    minorThreshold: sheetNumberSchema,
    majorThreshold: sheetNumberSchema,
    severeThreshold: sheetNumberSchema,
    hpMax: sheetNumberSchema,
    hpCurrent: sheetNumberSchema,
    stressMax: sheetNumberSchema,
    stressCurrent: sheetNumberSchema,
    hope: z
      .int('Must be a whole number')
      .min(0, 'Must be 0 or more')
      .max(ruleset.hopeMax, `Hope can't be above ${String(ruleset.hopeMax)}`),
    proficiency: sheetNumberSchema,
    experiences: sheetListSchema(experienceSchema),
    weapons: z.strictObject({
      primary: weapon.nullable(),
      secondary: weapon.nullable(),
      inventory: sheetListSchema(weapon),
    }),
    /** Null removes the armor. */
    armor: armorSchema.nullable(),
    inventory: sheetListSchema(inventoryItemSchema),
    gold: goldSchema,
    /** Null removes the class feature. */
    classFeature: classFeatureSchema.nullable(),
    combatOptions: sheetListSchema(abilitySchema),
  };
}

function patchSchemaOf(ruleset: Ruleset) {
  const shape = patchShapeFor(ruleset);
  const optional = Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, schema.optional()]),
  );
  return z
    .strictObject(optional)
    .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
}

const patchSchemas = new Map<number, ReturnType<typeof patchSchemaOf>>();

/** current ≤ max pairs, checked against the stored sheet merged with the patch. */
const LIMIT_PAIRS = [
  { max: 'hpMax', current: 'hpCurrent', maxLabel: 'HP max', currentLabel: 'current HP' },
  {
    max: 'stressMax',
    current: 'stressCurrent',
    maxLabel: 'Stress max',
    currentLabel: 'current Stress',
  },
  {
    max: 'armorSlotsMax',
    current: 'armorSlotsMarked',
    maxLabel: 'Armor slots',
    currentLabel: 'marked slots',
  },
] as const satisfies readonly {
  max: keyof CharacterSheetLimits;
  current: keyof CharacterSheetLimits;
  maxLabel: string;
  currentLabel: string;
}[];

/**
 * The PATCH schema of `…/characters/:characterId` for a campaign's ruleset. Any subset of
 * the keys; each replaces its whole value, so lists and sections are sent complete. Null is
 * allowed only for `armor` and `classFeature`, where it removes them. Thresholds have no
 * ordering rule (D-23).
 *
 * Pass the stored sheet as `current` to also check that no current value ends up above its
 * max (HP, Stress, armor slots). The issue goes on the key that was sent.
 */
export function characterSheetPatchSchemaFor(
  ruleset: Ruleset,
  current?: CharacterSheetLimits,
): z.ZodType<CharacterSheetPatch> {
  let base = patchSchemas.get(ruleset.version);
  if (!base) {
    base = patchSchemaOf(ruleset);
    patchSchemas.set(ruleset.version, base);
  }
  return base.superRefine((patch: Record<string, unknown>, ctx) => {
    for (const pair of LIMIT_PAIRS) {
      const max = patch[pair.max] ?? current?.[pair.max];
      const value = patch[pair.current] ?? current?.[pair.current];
      if (typeof max !== 'number' || typeof value !== 'number' || value <= max) continue;
      if (pair.current in patch) {
        ctx.addIssue({
          code: 'custom',
          path: [pair.current],
          message: `Can't be above ${pair.maxLabel} (${String(max)})`,
        });
      } else {
        ctx.addIssue({
          code: 'custom',
          path: [pair.max],
          message: `Can't be below ${pair.currentLabel} (${String(value)}); lower that first`,
        });
      }
    }
  });
}
