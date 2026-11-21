/**
 * Weapons and armor (F4.4, governance §8 "Weapons and armor", D-62): gameplay records the GM
 * enters by tier. Every member of the campaign reads them; only the GM creates, edits or deletes
 * them. They are never revealed, never take notes, and the AI never sees them.
 *
 * Named `WeaponRecord` and `ArmorRecord` because a sheet's own typed weapon and armor
 * (`sheet-parts.ts`) keep the names `Weapon` and `Armor` until sheets link these (F4.7).
 *
 * A piece of gear's feature is text the table reads. The numbers in it that change evasion, the
 * armor score, a threshold or a trait are entered beside it as `bonuses`, which the sheet applies
 * while the gear is equipped (F4.7, 19.25). A weapon's damage is a die and a flat bonus: the
 * number of dice is the PC's proficiency.
 */
import { z } from 'zod';

import { TEXT_FIELD_MAX, textField } from './record-fields';
import { signed } from './rolls';
import { bonusSchema, sheetNumberSchema, SHORT_TEXT_MAX, shortTextSchema } from './sheet-parts';

const timestamp = z.iso.datetime({ offset: true });

/** Gear tiers run from 1 to 4, matching the level bands (§9). */
export const GEAR_TIER_MAX = 4;
/** Longest weapon or armor name. The database enforces it too. */
export const GEAR_NAME_MAX = SHORT_TEXT_MAX;
/** Longest feature name and text. */
export const GEAR_FEATURE_NAME_MAX = SHORT_TEXT_MAX;
export const GEAR_FEATURE_TEXT_MAX = TEXT_FIELD_MAX;

export const WEAPON_SLOTS = ['primary', 'secondary'] as const;
export const weaponSlotSchema = z.enum(WEAPON_SLOTS);
export type WeaponSlot = z.infer<typeof weaponSlotSchema>;

/** The kind of damage a weapon deals. */
export const DAMAGE_KINDS = ['physical', 'magic'] as const;
export const damageKindSchema = z.enum(DAMAGE_KINDS);
export type DamageKind = z.infer<typeof damageKindSchema>;

export const WEAPON_RANGES = ['melee', 'very_close', 'close', 'far', 'very_far'] as const;
export const weaponRangeSchema = z.enum(WEAPON_RANGES);
export type WeaponRange = z.infer<typeof weaponRangeSchema>;

const RANGE_LABELS: Record<WeaponRange, string> = {
  melee: 'Melee',
  very_close: 'Very close',
  close: 'Close',
  far: 'Far',
  very_far: 'Very far',
};

/** "Melee", "Very close", "Close", "Far" or "Very far". */
export function weaponRangeLabel(range: WeaponRange): string {
  return RANGE_LABELS[range];
}

/** How many hands a weapon takes. A secondary weapon is always one-handed. */
export const BURDENS = ['one_handed', 'two_handed'] as const;
export const burdenSchema = z.enum(BURDENS);
export type Burden = z.infer<typeof burdenSchema>;

/** The dice a weapon's damage can use. */
export const DAMAGE_DIE_SIDES = [4, 6, 8, 10, 12, 20] as const;
export type DamageDie = (typeof DAMAGE_DIE_SIDES)[number];
export const damageDieSchema = z
  .int('Must be a whole number')
  .refine(
    (sides): sides is DamageDie => (DAMAGE_DIE_SIDES as readonly number[]).includes(sides),
    'Use a d4, d6, d8, d10, d12 or d20',
  );

export const gearTierSchema = z
  .int('Must be a whole number')
  .min(1, 'Tier must be 1 or more')
  .max(GEAR_TIER_MAX, `Tier must be ${String(GEAR_TIER_MAX)} or less`);

export const gearNameSchema = z
  .string()
  .trim()
  .min(1, 'Name cannot be empty')
  .max(GEAR_NAME_MAX, `Name must be ${String(GEAR_NAME_MAX)} characters or fewer`);

/**
 * The numbers a piece of gear changes while equipped (19.25). Each is −99 to +99; `traits` maps
 * a trait id of the campaign's ruleset to its bonus (the server checks the ids), and drops zeros.
 */
export const gearBonusesSchema = z.strictObject({
  evasion: bonusSchema,
  armorScore: bonusSchema,
  majorThreshold: bonusSchema,
  severeThreshold: bonusSchema,
  traits: z
    .record(z.string().min(1), bonusSchema)
    .transform((traits) => Object.fromEntries(Object.entries(traits).filter(([, n]) => n !== 0))),
});
export type GearBonuses = z.infer<typeof gearBonusesSchema>;

/** No bonuses: what new gear starts with. */
export function noGearBonuses(): GearBonuses {
  return { evasion: 0, armorScore: 0, majorThreshold: 0, severeThreshold: 0, traits: {} };
}

/** Whether gear changes no number at all. */
export function hasNoGearBonuses(bonuses: GearBonuses): boolean {
  return (
    bonuses.evasion === 0 &&
    bonuses.armorScore === 0 &&
    bonuses.majorThreshold === 0 &&
    bonuses.severeThreshold === 0 &&
    Object.keys(bonuses.traits).length === 0
  );
}

/**
 * A weapon's damage as the table reads it: `d10+3` on its own, or `2d10+3` with the number of
 * dice (the PC's proficiency). A bonus of 0 is left out; a negative one is written `d6−1`.
 */
export function formatDamage(die: number, bonus: number, dice?: number): string {
  const count = dice === undefined ? '' : String(dice);
  return `${count}d${String(die)}${bonus === 0 ? '' : signed(bonus)}`;
}

const featureShape = {
  /** E.g. "Heavy". Empty when the feature has no name. */
  featureName: shortTextSchema,
  /** E.g. "−1 to Evasion". Plain text; line breaks kept. */
  featureText: textField,
};

/** A weapon, as every read returns it. */
export const weaponRecordSchema = z.object({
  id: z.uuid(),
  tier: z.int(),
  name: z.string(),
  slot: weaponSlotSchema,
  kind: damageKindSchema,
  /** A trait id of the campaign's ruleset: the trait the attack rolls with. */
  trait: z.string(),
  range: weaponRangeSchema,
  damageDie: z.int(),
  damageBonus: z.int(),
  burden: burdenSchema,
  featureName: z.string(),
  featureText: z.string(),
  bonuses: gearBonusesSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type WeaponRecord = z.infer<typeof weaponRecordSchema>;

/** A piece of armor, as every read returns it. */
export const armorRecordSchema = z.object({
  id: z.uuid(),
  tier: z.int(),
  name: z.string(),
  /** Damage at or above this marks 2 HP; below it, 1 HP (19.16). The level is added on a sheet. */
  baseMajorThreshold: z.int(),
  /** Damage at or above this marks 3 HP. */
  baseSevereThreshold: z.int(),
  /** The sheet's armor slots: how many times it can reduce incoming damage. */
  baseScore: z.int(),
  featureName: z.string(),
  featureText: z.string(),
  bonuses: gearBonusesSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type ArmorRecord = z.infer<typeof armorRecordSchema>;

/** `GET /api/campaigns/:campaignId/weapons`: any member. By tier, slot, then name. */
export const weaponListResponseSchema = z.object({ weapons: z.array(weaponRecordSchema) });
export type WeaponListResponse = z.infer<typeof weaponListResponseSchema>;

/** `GET /api/campaigns/:campaignId/armor`: any member. By tier, then name. */
export const armorListResponseSchema = z.object({ armor: z.array(armorRecordSchema) });
export type ArmorListResponse = z.infer<typeof armorListResponseSchema>;

const weaponFields = {
  tier: gearTierSchema,
  name: gearNameSchema,
  slot: weaponSlotSchema,
  kind: damageKindSchema,
  trait: z.string().min(1, 'Pick a trait'),
  range: weaponRangeSchema,
  damageDie: damageDieSchema,
  damageBonus: bonusSchema,
  burden: burdenSchema,
  ...featureShape,
  bonuses: gearBonusesSchema,
};

const armorFields = {
  tier: gearTierSchema,
  name: gearNameSchema,
  baseMajorThreshold: sheetNumberSchema,
  baseSevereThreshold: sheetNumberSchema,
  baseScore: sheetNumberSchema,
  ...featureShape,
  bonuses: gearBonusesSchema,
};

/**
 * `POST /api/campaigns/:campaignId/weapons`: the GM; refused while archived. A name, and any
 * other field; the rest start as a tier 1 one-handed physical melee primary with a d6 and the
 * ruleset's first trait.
 */
export const createWeaponRequestSchema = z.strictObject({
  ...weaponFields,
  tier: weaponFields.tier.optional(),
  slot: weaponFields.slot.optional(),
  kind: weaponFields.kind.optional(),
  trait: weaponFields.trait.optional(),
  range: weaponFields.range.optional(),
  damageDie: weaponFields.damageDie.optional(),
  damageBonus: weaponFields.damageBonus.optional(),
  burden: weaponFields.burden.optional(),
  featureName: weaponFields.featureName.optional(),
  featureText: weaponFields.featureText.optional(),
  bonuses: weaponFields.bonuses.optional(),
});
export type CreateWeaponRequest = z.infer<typeof createWeaponRequestSchema>;

/**
 * `PATCH /api/campaigns/:campaignId/weapons/:weaponId`: the GM; refused while archived. Any
 * subset of the keys; each replaces its whole value. Making a weapon secondary makes it
 * one-handed too.
 */
export const updateWeaponRequestSchema = z
  .strictObject(weaponFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
export type UpdateWeaponRequest = z.infer<typeof updateWeaponRequestSchema>;

/** `POST /api/campaigns/:campaignId/armor`: the GM; refused while archived. Starts at tier 1. */
export const createArmorRequestSchema = z.strictObject({
  ...armorFields,
  tier: armorFields.tier.optional(),
  baseMajorThreshold: armorFields.baseMajorThreshold.optional(),
  baseSevereThreshold: armorFields.baseSevereThreshold.optional(),
  baseScore: armorFields.baseScore.optional(),
  featureName: armorFields.featureName.optional(),
  featureText: armorFields.featureText.optional(),
  bonuses: armorFields.bonuses.optional(),
});
export type CreateArmorRequest = z.infer<typeof createArmorRequestSchema>;

/** `PATCH /api/campaigns/:campaignId/armor/:armorId`: the GM; refused while archived. */
export const updateArmorRequestSchema = z
  .strictObject(armorFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
export type UpdateArmorRequest = z.infer<typeof updateArmorRequestSchema>;

/** The refusal for a two-handed secondary weapon. */
export const SECONDARY_ONE_HANDED = 'A secondary weapon is one-handed';
/**
 * The GM form's warning for a severe threshold below the major one. Allowed, since the form saves
 * one field at a time.
 */
export const SEVERE_BELOW_MAJOR = 'The severe threshold is usually at least the major threshold';
