/**
 * The character creation guide (F4.8, governance §9 "Character creation", D-66): what a player
 * picks to build a level-1 character, the campaign's starting gear setting, and the rules both
 * the guide and the server check. The guide checks as the player goes; the server checks again
 * on Finish, and only then is anything saved.
 */
import { z } from 'zod';

import { SPECIES_PAIR } from './character-sheets';
import { characterNameSchema } from './characters';
import { followsCreationSpread } from './classes';
import type { DomainCardSummary } from './domains';
import type { ArmorRecord, WeaponRecord } from './gear';
import { textField } from './record-fields';
import { richTextSchema } from './rich-text';
import type { Ruleset } from './ruleset';
import { signed } from './rolls';
import { goldSchema, rowNameSchema, sheetListSchema, type Gold } from './sheet-parts';

/** A new PC's name until its player names it in the guide. */
export const STARTING_CHARACTER_NAME = 'Starting Character';

/** How a campaign's new characters get their gear (§8 "Starting gear"). */
export const STARTING_GEAR_MODES = ['default', 'set', 'none'] as const;
export const startingGearModeSchema = z.enum(STARTING_GEAR_MODES);
export type StartingGearMode = z.infer<typeof startingGearModeSchema>;

/** An item the starting gear hands out: an inventory row with no record link. */
export const kitItemSchema = z.strictObject({
  name: rowNameSchema('An item'),
  detail: textField,
});
export type KitItem = z.infer<typeof kitItemSchema>;

/** The GM's starting kit, every new character's gear when the mode is Set (19.18). */
export const startingKitSchema = z.strictObject({
  primaryWeaponId: z.uuid().nullable(),
  secondaryWeaponId: z.uuid().nullable(),
  armorId: z.uuid().nullable(),
  items: sheetListSchema(kitItemSchema),
  gold: goldSchema,
});
export type StartingKit = z.infer<typeof startingKitSchema>;

/** `GET` and `PUT …/starting-gear`: the mode, and the kit (kept while another mode is on). */
export const startingGearSchema = z.strictObject({
  mode: startingGearModeSchema,
  kit: startingKitSchema,
});
export type StartingGear = z.infer<typeof startingGearSchema>;

export const EMPTY_KIT: StartingKit = Object.freeze({
  primaryWeaponId: null,
  secondaryWeaponId: null,
  armorId: null,
  items: [],
  gold: { handfuls: 0, bags: 0, chests: 0 },
});

/** What the Default mode hands out besides the picked weapons, armor and potion. */
export const DEFAULT_KIT_ITEMS: readonly KitItem[] = Object.freeze([
  { name: 'Torch', detail: '' },
  { name: '50 feet of rope', detail: '' },
  { name: 'Basic supplies', detail: '' },
]);
export const DEFAULT_KIT_GOLD: Gold = Object.freeze({ handfuls: 1, bags: 0, chests: 0 });

export const POTIONS = ['health', 'stamina'] as const;
export type Potion = (typeof POTIONS)[number];
/** The potion a Default-mode player picks, as the inventory row it becomes. */
export const POTION_ITEMS: Readonly<Record<Potion, KitItem>> = Object.freeze({
  health: { name: 'Minor Health Potion', detail: 'Clear 1d4 HP' },
  stamina: { name: 'Minor Stamina Potion', detail: 'Clear 1d4 Stress' },
});

/** The Default mode's picks. */
export const defaultGearPicksSchema = z.strictObject({
  primaryWeaponId: z.uuid().nullable(),
  secondaryWeaponId: z.uuid().nullable(),
  armorId: z.uuid().nullable(),
  potion: z.enum(POTIONS, 'Pick a potion'),
});
export type DefaultGearPicks = z.infer<typeof defaultGearPicksSchema>;

/**
 * `POST …/characters/:characterId/build`: everything the guide picked, sent once on Finish.
 * `gear` is the Default mode's picks; null in the Set and None modes, which pick nothing.
 */
export const buildCharacterRequestSchema = z.strictObject({
  name: characterNameSchema,
  publicDescription: richTextSchema,
  classId: z.uuid('Pick a class'),
  subclassId: z.uuid('Pick a subclass'),
  speciesIds: z
    .tuple([z.uuid('Pick a species'), z.uuid().nullable()])
    .refine(([first, second]) => first !== second, SPECIES_PAIR),
  traits: z.record(z.string(), z.int()),
  gear: defaultGearPicksSchema.nullable(),
  cardIds: z.array(z.uuid()).max(20),
});
export type BuildCharacterRequest = z.infer<typeof buildCharacterRequestSchema>;

/** `POST …/characters/:characterId/guide` (GM): send a PC through the guide, or take it back. */
export const setNeedsGuideRequestSchema = z.strictObject({ needsGuide: z.boolean() });
export type SetNeedsGuideRequest = z.infer<typeof setNeedsGuideRequestSchema>;

export const BUILD_MESSAGES = {
  alreadyBuilt: 'This character is already built',
  noRuleset: "This campaign's ruleset has no creation guide",
  subclassOfClass: 'Pick a subclass of your class',
  gearNeeded: 'Pick your starting weapons, armor and potion',
  noGearToPick: 'Your starting gear is set by the GM: there is nothing to pick',
  primaryNeeded: 'Pick a primary weapon',
  armorNeeded: 'Pick armor',
  primary: 'Your primary weapon must be a tier 1 primary weapon',
  secondary: 'Your secondary weapon must be a tier 1 secondary weapon',
  armor: 'Your armor must be tier 1',
  twoHanded: 'A two-handed primary weapon leaves no hand for a secondary',
} as const;

/** "Give your traits +2, +1, +1, 0, 0 and −1, one each": the ruleset's spread in words. */
export function traitSpreadMessage(ruleset: Ruleset): string {
  const values = [...(ruleset.creationTraitSpread ?? [])].sort((a, b) => b - a);
  const words = values.map((value) => (value === 0 ? '0' : signed(value)));
  const last = words.pop() ?? '';
  return `Give your traits ${words.join(', ')} and ${last}, one each`;
}

/** Null when the traits are the ruleset's creation spread, one value to each trait. */
export function traitsProblem(traits: Record<string, number>, ruleset: Ruleset): string | null {
  return followsCreationSpread(traits, ruleset) ? null : traitSpreadMessage(ruleset);
}

/**
 * What's wrong with the Default mode's weapons and armor, or null: a tier 1 primary and tier 1
 * armor are needed; a secondary is optional, tier 1, and not beside a two-handed primary.
 */
export function defaultGearProblem(gear: {
  primary: Pick<WeaponRecord, 'slot' | 'tier' | 'burden'> | null;
  secondary: Pick<WeaponRecord, 'slot' | 'tier'> | null;
  armor: Pick<ArmorRecord, 'tier'> | null;
}): string | null {
  const { primary, secondary, armor } = gear;
  if (primary === null) return BUILD_MESSAGES.primaryNeeded;
  if (primary.slot !== 'primary' || primary.tier !== 1) return BUILD_MESSAGES.primary;
  if (secondary !== null) {
    if (secondary.slot !== 'secondary' || secondary.tier !== 1) return BUILD_MESSAGES.secondary;
    if (primary.burden === 'two_handed') return BUILD_MESSAGES.twoHanded;
  }
  if (armor === null) return BUILD_MESSAGES.armorNeeded;
  if (armor.tier !== 1) return BUILD_MESSAGES.armor;
  return null;
}

/**
 * What's wrong with the domain cards picked, or null: exactly the ruleset's number at creation,
 * different, level 1, and from the class's domains. Strict, unlike the GM's sheet (D-66).
 */
export function creationCardProblem(
  cards: readonly Pick<DomainCardSummary, 'id' | 'name' | 'domainId' | 'level'>[],
  domainIds: readonly (string | null)[],
  ruleset: Ruleset,
): string | null {
  const count = ruleset.domainCards?.atCreation ?? 0;
  const distinct = new Set(cards.map((card) => card.id));
  if (cards.length !== count || distinct.size !== count) {
    return `Pick ${String(count)} different domain cards`;
  }
  for (const card of cards) {
    if (card.level !== 1) return `${card.name} is level ${String(card.level)}: pick level 1 cards`;
    if (!domainIds.includes(card.domainId)) return `${card.name} isn't from your class's domains`;
  }
  return null;
}

/** The items and gold the starting gear adds to a sheet, by mode. */
export function startingItems(
  mode: StartingGearMode,
  kit: Pick<StartingKit, 'items' | 'gold'>,
  potion: Potion | null,
): { items: KitItem[]; gold: Gold } {
  switch (mode) {
    case 'default':
      return {
        items: [...DEFAULT_KIT_ITEMS, ...(potion === null ? [] : [POTION_ITEMS[potion]])],
        gold: { ...DEFAULT_KIT_GOLD },
      };
    case 'set':
      return { items: [...kit.items], gold: { ...kit.gold } };
    case 'none':
      return { items: [], gold: { handfuls: 0, bags: 0, chests: 0 } };
  }
}
