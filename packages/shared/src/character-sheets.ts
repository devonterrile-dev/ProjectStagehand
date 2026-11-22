/**
 * Character sheets (F1.4, governance §8 "Character sheet"). A sheet is a row of the
 * `characters` table: the in-play numbers are columns, the lists and sections are JSON
 * (D-23). Trait ids, the trait range and the Hope max come from the campaign's ruleset, so
 * the patch schema is built per ruleset.
 *
 * The GM sees the whole sheet. A player sees only their own PC, through the explicit
 * allow-list in `playerCharacterSheetSchema`, and can't edit it in Phase 1 (D-23, 19.7).
 *
 * From F4.7 (D-65) a sheet also links gameplay records (`links`); each link replaces the typed
 * part it stands for. `built` and `cards` are worked out from both by `buildSheet`.
 */
import { z } from 'zod';

import { characterNameSchema } from './characters';
import { richTextSchema } from './rich-text';
import { traitIdsOf, type Ruleset } from './ruleset';
import {
  builtSheetSchema,
  sheetCardsSchema,
  sheetLinksSchema,
  SUBCLASS_CARDS_MAX,
  type SheetLinks,
} from './sheet-build';
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
  /** The PC's own Hope bonus from level-ups, added to the ruleset's when Hope is spent (F4.1). */
  hopeBonus: z.int(),
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

  /** The gameplay records it links (F4.7). */
  links: sheetLinksSchema,
  /** What the sheet shows, worked out from its values and links. */
  built: builtSheetSchema,
  /** Its feature cards: class, subclass, species, gear and domain cards. */
  cards: sheetCardsSchema,

  /** Waiting for its player (or the GM) to build it with the creation guide (F4.8). */
  needsGuide: z.boolean(),
  /** When the creation guide last finished it; null for a sheet typed by hand. */
  builtAt: timestamp.nullable(),

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
  hopeBonus: true,
  proficiency: true,
  experiences: true,
  weapons: true,
  armor: true,
  inventory: true,
  gold: true,
  classFeature: true,
  combatOptions: true,
  links: true,
  built: true,
  cards: true,
  needsGuide: true,
  builtAt: true,
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

/**
 * The GM-editable part of a sheet. Each key replaces its whole value (D-23). The link keys
 * (F4.7) set the sheet's links; the server checks them against the campaign's records.
 */
export type CharacterSheetPatch = Partial<
  Omit<
    CharacterSheet,
    'id' | 'assignedToUserId' | 'createdAt' | 'updatedAt' | 'links' | 'built' | 'cards'
  > &
    SheetLinks
>;

/** The keys of a patch that set links rather than stored values. */
export const SHEET_LINK_KEYS = [
  'classId',
  'subclassId',
  'subclassCards',
  'speciesIds',
  'primaryWeaponId',
  'secondaryWeaponId',
  'armorId',
  'spareWeaponIds',
] as const satisfies readonly (keyof SheetLinks)[];

/**
 * The tracks a PC's own player marks in play (D-67): Hope, HP left, Stress marked and armor slots
 * marked. The GM may set them too.
 */
export const TRACK_KEYS = ['hope', 'hpCurrent', 'stressCurrent', 'armorSlotsMarked'] as const;
export type TrackKey = (typeof TRACK_KEYS)[number];

/**
 * `POST …/characters/:characterId/tracks`: any of the tracks, each a whole number of 0 or more.
 * The server checks each against its maximum on the sheet.
 */
export const characterTracksRequestSchema = z
  .strictObject({
    hope: z.int('Must be a whole number').min(0, 'Must be 0 or more').optional(),
    hpCurrent: z.int('Must be a whole number').min(0, 'Must be 0 or more').optional(),
    stressCurrent: z.int('Must be a whole number').min(0, 'Must be 0 or more').optional(),
    armorSlotsMarked: z.int('Must be a whole number').min(0, 'Must be 0 or more').optional(),
  })
  .refine((request) => Object.keys(request).length > 0, 'Nothing to update');
export type CharacterTracksRequest = z.infer<typeof characterTracksRequestSchema>;

/** The refusal for the same species twice, or a mixed ancestry with no first species. */
export const SPECIES_PAIR = 'Pick two different species, the first one first';

/** The stored values the cross-field rules compare against. */
export type CharacterSheetLimits = Pick<
  CharacterSheet,
  'hpMax' | 'hpCurrent' | 'stressMax' | 'stressCurrent' | 'armorSlotsMax' | 'armorSlotsMarked'
>;

function patchShapeFor(ruleset: Ruleset) {
  const traitIds = traitIdsOf(ruleset);
  const { min, max } = ruleset.traitModifier;
  const range = `Must be from ${String(min)} to +${String(max)}`;
  const levelMax = ruleset.levels?.max ?? SHEET_NUMBER_MAX;
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
      .max(levelMax, `Must be ${String(levelMax)} or less`),
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
    hopeBonus: sheetNumberSchema,
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

    // Links (F4.7): null unlinks, and the typed part shows again.
    classId: z.uuid().nullable(),
    subclassId: z.uuid().nullable(),
    subclassCards: z
      .int('Must be a whole number')
      .min(0, 'Must be 0 or more')
      .max(SUBCLASS_CARDS_MAX, `Must be ${String(SUBCLASS_CARDS_MAX)} or less`),
    speciesIds: z
      .tuple([z.uuid().nullable(), z.uuid().nullable()])
      .refine(
        ([first, second]) => second === null || (first !== null && first !== second),
        SPECIES_PAIR,
      ),
    primaryWeaponId: z.uuid().nullable(),
    secondaryWeaponId: z.uuid().nullable(),
    armorId: z.uuid().nullable(),
    spareWeaponIds: sheetListSchema(z.uuid()),
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
 * the keys; each replaces its whole value, so lists and sections are sent complete. Null
 * removes `armor` and `classFeature`, and unlinks a link key. Thresholds have no ordering rule
 * (D-23).
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
