/**
 * Classes and subclasses (F4.5, governance §8 "Classes and subclasses", D-63): gameplay records
 * the GM enters. Every member of the campaign reads them; only the GM creates, edits or deletes
 * them. They are never revealed, never take notes, and the AI never sees them.
 *
 * A class names its two domains, a PC's starting evasion and HP, its Hope feature, its class
 * features, and what it suggests a new PC starts with: a spread of trait modifiers and tier 1
 * gear. A subclass belongs to one class and holds its spellcast trait and its foundation,
 * specialization and mastery features. Feature text is read by the table, not run by the app.
 */
import { z } from 'zod';

import { textField } from './record-fields';
import type { Ruleset } from './ruleset';
import { rowNameSchema, SHORT_TEXT_MAX, sheetNumberSchema, shortTextSchema } from './sheet-parts';

const timestamp = z.iso.datetime({ offset: true });

/** Longest class or subclass name. The database enforces it too. */
export const CLASS_NAME_MAX = SHORT_TEXT_MAX;
/** Most rows in a list of features. */
export const FEATURE_LIST_MAX = 20;
/** Most Hope a Hope feature can cost: all the Hope a PC can hold (§9). */
export const HOPE_FEATURE_COST_MAX = 6;
/** A suggested trait modifier runs over the creation spread's range (§9). */
export const SUGGESTED_TRAIT_MIN = -1;
export const SUGGESTED_TRAIT_MAX = 2;
/** A new class's starting evasion and HP, before the GM sets them. */
export const DEFAULT_STARTING_EVASION = 10;
export const DEFAULT_STARTING_HP = 6;

export const classNameSchema = z
  .string()
  .trim()
  .min(1, 'Name cannot be empty')
  .max(CLASS_NAME_MAX, `Name must be ${String(CLASS_NAME_MAX)} characters or fewer`);

/** A feature on a card: a name and plain text, line breaks kept. */
export const featureRowSchema = z.strictObject({
  name: rowNameSchema('A feature'),
  text: textField,
});
export type FeatureRow = z.infer<typeof featureRowSchema>;

export const featureListSchema = z
  .array(featureRowSchema)
  .max(FEATURE_LIST_MAX, `At most ${String(FEATURE_LIST_MAX)} features`);

export const hopeFeatureCostSchema = z
  .int('Must be a whole number')
  .min(0, 'Must be 0 or more')
  .max(HOPE_FEATURE_COST_MAX, `Must be ${String(HOPE_FEATURE_COST_MAX)} or less`);

/** The class's own way to spend Hope. Its name may be empty while the GM fills it in. */
export const hopeFeatureSchema = z.strictObject({
  name: shortTextSchema,
  cost: hopeFeatureCostSchema,
  text: textField,
});
export type HopeFeature = z.infer<typeof hopeFeatureSchema>;

/** A new class's Hope feature: unnamed, costing 3 Hope. */
export function emptyHopeFeature(): HopeFeature {
  return { name: '', cost: 3, text: '' };
}

export const suggestedTraitSchema = z
  .int('Must be a whole number')
  .min(SUGGESTED_TRAIT_MIN, `Must be ${String(SUGGESTED_TRAIT_MIN)} or more`)
  .max(SUGGESTED_TRAIT_MAX, `Must be ${String(SUGGESTED_TRAIT_MAX)} or less`);

/**
 * The trait modifiers a class suggests, by trait id of the campaign's ruleset (the server checks
 * the ids). Empty means no suggestion yet. A set that isn't the creation spread can be saved,
 * since the GM's form saves as it goes; the form warns, and the creation guide (F4.8) only fills
 * in a set that follows the spread.
 */
export const suggestedTraitsSchema = z.record(z.string().min(1), suggestedTraitSchema);
export type SuggestedTraits = z.infer<typeof suggestedTraitsSchema>;

/**
 * Whether suggested traits give every trait of the ruleset one modifier of its creation spread
 * (+2, +1, +1, 0, 0, −1 in v2). False for a ruleset without a spread.
 */
export function followsCreationSpread(traits: SuggestedTraits, ruleset: Ruleset): boolean {
  const spread = ruleset.creationTraitSpread;
  if (spread === undefined) return false;
  const ids = ruleset.traits.map((trait) => trait.id);
  if (Object.keys(traits).length !== ids.length) return false;
  const values: number[] = [];
  for (const id of ids) {
    const value = traits[id];
    if (value === undefined) return false;
    values.push(value);
  }
  const sorted = (list: readonly number[]) => [...list].sort((a, b) => a - b);
  return sorted(values).join() === sorted(spread).join();
}

/** A linked record as a class names it. */
export const gameplayRefSchema = z.object({ id: z.uuid(), name: z.string() });
export type GameplayRef = z.infer<typeof gameplayRefSchema>;

/** The class's two domains, in the GM's order; either may be unset while it's being entered. */
export const classDomainsSchema = z.tuple([
  gameplayRefSchema.nullable(),
  gameplayRefSchema.nullable(),
]);

/** A subclass in a list. */
export const subclassSummarySchema = z.object({
  id: z.uuid(),
  classId: z.uuid(),
  name: z.string(),
  /** A trait id of the campaign's ruleset, or null when the subclass doesn't cast. */
  spellcastTrait: z.string().nullable(),
  updatedAt: timestamp,
});
export type SubclassSummary = z.infer<typeof subclassSummarySchema>;

/** A whole subclass. */
export const subclassRecordSchema = subclassSummarySchema.extend({
  className: z.string(),
  description: z.string(),
  /** A PC starts with these (the foundation card). */
  foundation: z.array(featureRowSchema),
  /** The first upgraded subclass card (F4.9). */
  specialization: z.array(featureRowSchema),
  /** The second upgraded subclass card. */
  mastery: z.array(featureRowSchema),
  createdAt: timestamp,
});
export type SubclassRecord = z.infer<typeof subclassRecordSchema>;

/** A class in a list. */
export const classSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  domains: classDomainsSchema,
  startingEvasion: z.int(),
  startingHp: z.int(),
  subclassCount: z.int().nonnegative(),
  updatedAt: timestamp,
});
export type ClassSummary = z.infer<typeof classSummarySchema>;

/** A whole class, with its subclasses by name. */
export const classRecordSchema = classSummarySchema.extend({
  description: z.string(),
  hopeFeature: hopeFeatureSchema,
  classFeatures: z.array(featureRowSchema),
  suggestedTraits: suggestedTraitsSchema,
  suggestedPrimaryWeapon: gameplayRefSchema.nullable(),
  suggestedSecondaryWeapon: gameplayRefSchema.nullable(),
  suggestedArmor: gameplayRefSchema.nullable(),
  /**
   * Suggestions whose gear no longer fits (edited since it was picked), e.g. "Longsword is no
   * longer a tier 1 primary weapon". The creation guide skips them.
   */
  suggestionWarnings: z.array(z.string()),
  subclasses: z.array(subclassSummarySchema),
  createdAt: timestamp,
});
export type ClassRecord = z.infer<typeof classRecordSchema>;

/** `GET /api/campaigns/:campaignId/classes`: any member. By name. */
export const classListResponseSchema = z.object({ classes: z.array(classSummarySchema) });
export type ClassListResponse = z.infer<typeof classListResponseSchema>;

/** `GET /api/campaigns/:campaignId/subclasses`: any member. By class name, then name. */
export const subclassListResponseSchema = z.object({
  subclasses: z.array(subclassSummarySchema),
});
export type SubclassListResponse = z.infer<typeof subclassListResponseSchema>;

/** The refusal for a class given the same domain twice. */
export const SAME_DOMAIN_TWICE = 'Pick two different domains';

/** Two domain ids, either unset; they must differ when both are set. */
export const classDomainIdsSchema = z
  .tuple([z.uuid().nullable(), z.uuid().nullable()])
  .refine(([first, second]) => first === null || first !== second, SAME_DOMAIN_TWICE);

const classFields = {
  name: classNameSchema,
  description: textField,
  domainIds: classDomainIdsSchema,
  startingEvasion: sheetNumberSchema,
  startingHp: sheetNumberSchema,
  hopeFeature: hopeFeatureSchema,
  classFeatures: featureListSchema,
  suggestedTraits: suggestedTraitsSchema,
  suggestedPrimaryWeaponId: z.uuid().nullable(),
  suggestedSecondaryWeaponId: z.uuid().nullable(),
  suggestedArmorId: z.uuid().nullable(),
};

/**
 * `POST /api/campaigns/:campaignId/classes`: the GM; refused while archived. A name; everything
 * else is set on the class's page.
 */
export const createClassRequestSchema = z.strictObject({ name: classNameSchema });
export type CreateClassRequest = z.infer<typeof createClassRequestSchema>;

/**
 * `PATCH /api/campaigns/:campaignId/classes/:classId`: the GM; refused while archived. Any subset
 * of the keys; each replaces its whole value. Suggested gear must be tier 1 and of its slot, with
 * no secondary beside a two-handed primary.
 */
export const updateClassRequestSchema = z
  .strictObject(classFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
export type UpdateClassRequest = z.infer<typeof updateClassRequestSchema>;

const subclassFields = {
  name: classNameSchema,
  description: textField,
  spellcastTrait: z.string().min(1, 'Pick a trait').nullable(),
  foundation: featureListSchema,
  specialization: featureListSchema,
  mastery: featureListSchema,
};

/** `POST /api/campaigns/:campaignId/subclasses`: the GM; refused while archived. */
export const createSubclassRequestSchema = z.strictObject({
  classId: z.uuid(),
  name: classNameSchema,
});
export type CreateSubclassRequest = z.infer<typeof createSubclassRequestSchema>;

/**
 * `PATCH /api/campaigns/:campaignId/subclasses/:subclassId`: the GM; refused while archived. A
 * subclass stays in the class it was made in.
 */
export const updateSubclassRequestSchema = z
  .strictObject(subclassFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
export type UpdateSubclassRequest = z.infer<typeof updateSubclassRequestSchema>;

/** The refusal for suggested gear that isn't tier 1 or isn't of its slot. */
export const SUGGESTION_NOT_FIT = {
  primary: 'The suggested primary weapon must be a tier 1 primary weapon',
  secondary: 'The suggested secondary weapon must be a tier 1 secondary weapon',
  armor: 'The suggested armor must be tier 1',
  twoHanded: 'A two-handed primary weapon leaves no hand for a secondary',
} as const;

/** The GM form's warning for suggested traits that aren't the creation spread. */
export const TRAITS_NOT_SPREAD =
  'Suggested traits are usually one +2, two +1, two 0 and one −1; the creation guide only fills them in then';
