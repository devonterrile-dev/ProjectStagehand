/**
 * Building blocks shared by character sheets and stat blocks (governance §8, F1.4).
 * Numbers that change in play are database columns; these schemas cover the repeating
 * lists and sections stored as JSON (D-23).
 */
import { z } from 'zod';

import { textField } from './record-fields';

/** Largest value of a sheet number (HP, evasion, thresholds, gold…). */
export const SHEET_NUMBER_MAX = 999;
/** Most rows in any sheet list (experiences, weapons, inventory, features…). */
export const SHEET_LIST_MAX = 50;
/** Longest short text (class name, a cost, a range, a damage type…). */
export const SHORT_TEXT_MAX = 80;
/** Largest bonus or attack modifier, either sign. */
export const BONUS_MAX = 99;

/** A whole number from 0 to 999. */
export const sheetNumberSchema = z
  .int('Must be a whole number')
  .min(0, 'Must be 0 or more')
  .max(SHEET_NUMBER_MAX, `Must be ${String(SHEET_NUMBER_MAX)} or less`);

/** A whole number from −99 to +99. */
export const bonusSchema = z
  .int('Must be a whole number')
  .min(-BONUS_MAX, `Must be −${String(BONUS_MAX)} or more`)
  .max(BONUS_MAX, `Must be ${String(BONUS_MAX)} or less`);

/** Optional short text: trimmed, up to 80 characters; empty means "none". */
export const shortTextSchema = z
  .string()
  .trim()
  .max(SHORT_TEXT_MAX, `Must be ${String(SHORT_TEXT_MAX)} characters or fewer`);

/** A required name inside a list row. */
export function rowNameSchema(what: string) {
  return z
    .string()
    .trim()
    .min(1, `${what} needs a name`)
    .max(SHORT_TEXT_MAX, `A name must be ${String(SHORT_TEXT_MAX)} characters or fewer`);
}

/** A list of up to 50 rows. */
export function sheetListSchema<T extends z.ZodType>(item: T) {
  return z.array(item).max(SHEET_LIST_MAX, `At most ${String(SHEET_LIST_MAX)} rows`);
}

export const experienceSchema = z.strictObject({
  name: rowNameSchema('An experience'),
  bonus: bonusSchema,
});
export type Experience = z.infer<typeof experienceSchema>;

export const ABILITY_KINDS = ['action', 'reaction', 'passive'] as const;
export const abilityKindSchema = z.enum(ABILITY_KINDS);
export type AbilityKind = z.infer<typeof abilityKindSchema>;

/** A PC's combat option or a stat block's feature. An empty cost means it's free. */
export const abilitySchema = z.strictObject({
  name: rowNameSchema('An ability'),
  kind: abilityKindSchema,
  /** E.g. "1 Hope", "Mark a Stress", "Spend a Fear". */
  cost: shortTextSchema,
  description: textField,
});
export type Ability = z.infer<typeof abilitySchema>;

/**
 * Damage dice such as `1d8`, `2d6+3` or `1d12-1`. Rolling (F3.6, F4.2) parses this, so the
 * shape is strict: 1–99 dice of d4, d6, d8, d10, d12 or d20, plus an optional flat bonus.
 */
export const damageDiceSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[1-9]\d?d(4|6|8|10|12|20)([+-][1-9]\d?)?$/, 'Use dice like 1d8 or 2d6+3');

const attackShape = {
  name: rowNameSchema('An attack'),
  /** E.g. "Melee", "Close", "Far". Free text until the ruleset defines ranges. */
  range: shortTextSchema,
  damageDice: damageDiceSchema,
  /** E.g. "physical", "magic". */
  damageType: shortTextSchema,
};

/** A stat block's standard attack. */
export const attackSchema = z.strictObject(attackShape);
export type Attack = z.infer<typeof attackSchema>;

/**
 * A PC's weapon: an attack plus the trait it rolls with and its feature text. `trait` is a
 * trait id of the campaign's ruleset; the patch schema checks it against that list.
 */
export function weaponSchemaWith<T extends z.ZodType<string | null>>(trait: T) {
  return z.strictObject({ ...attackShape, trait, feature: textField });
}
export const weaponSchema = weaponSchemaWith(z.string().nullable());
export type Weapon = z.infer<typeof weaponSchema>;

export const armorSchema = z.strictObject({
  name: rowNameSchema('Armor'),
  baseMajorThreshold: sheetNumberSchema,
  baseSevereThreshold: sheetNumberSchema,
  baseScore: sheetNumberSchema,
  feature: textField,
});
export type Armor = z.infer<typeof armorSchema>;

/**
 * An inventory row. `recordId` optionally links an Item record of the same campaign (D-24);
 * the server checks it, and the player's own sheet never receives it.
 */
export const inventoryItemSchema = z.strictObject({
  name: rowNameSchema('An item'),
  detail: textField,
  recordId: z.uuid('Pick an Item record').optional(),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

/** An inventory row as its player sees it: not strict, so parsing drops `recordId`. */
export const playerInventoryItemSchema = z.object({ name: z.string(), detail: z.string() });
export type PlayerInventoryItem = z.infer<typeof playerInventoryItemSchema>;

export const goldSchema = z.strictObject({
  handfuls: sheetNumberSchema,
  bags: sheetNumberSchema,
  chests: sheetNumberSchema,
});
export type Gold = z.infer<typeof goldSchema>;

export const classFeatureSchema = z.strictObject({
  name: rowNameSchema('A class feature'),
  description: textField,
});
export type ClassFeature = z.infer<typeof classFeatureSchema>;
