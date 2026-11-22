/**
 * The sheet built from gameplay records (F4.7, governance §8 "Character sheet", D-65). A sheet
 * links its class, subclass, species, equipped gear, spare weapons and domain cards; each link
 * replaces the typed part it stands for, and an unlinked part stays typed. `buildSheet` works
 * out what the sheet shows and the table uses from the stored values and the linked records:
 *
 * - Traits and evasion: the stored values plus the bonuses of equipped gear (19.25).
 * - Armor: with armor linked, its score is the armor slots and its thresholds are base + level,
 *   with no minor threshold (19.16); a sheet the creation guide built with no armor is unarmored
 *   (thresholds level and twice the level, F4.8); otherwise the typed values. Gear bonuses apply
 *   on top.
 * - Weapons: a linked weapon's record values, its damage dice the PC's proficiency.
 * - Feature cards: the class (Hope feature and class features), the subclass cards held, the
 *   species (one, or the first feature of one and the second of another, D-64), the gear, and
 *   the domain cards by place.
 * - Warnings, never refusals: a card outside the class's domains or above the PC's level, and
 *   gear above the PC's tier.
 *
 * Pure: the server loads the records, and both the GM's and the player's views carry the result.
 */
import { z } from 'zod';

import { featureRowSchema, hopeFeatureSchema, type FeatureRow, type HopeFeature } from './classes';
import { domainCardSchema, type DomainCard } from './domains';
import {
  armorRecordSchema,
  burdenSchema,
  formatDamage,
  weaponRangeLabel,
  weaponRecordSchema,
  type ArmorRecord,
  type GearBonuses,
  type WeaponRecord,
} from './gear';
import { tierOf } from './rules';
import type { Ruleset } from './ruleset';
import type { Weapon } from './sheet-parts';

/** Where a held domain card is: in play, or put away (§9 "Domain card loadout"). */
export const CARD_PLACES = ['loadout', 'vault'] as const;
export const cardPlaceSchema = z.enum(CARD_PLACES);
export type CardPlace = z.infer<typeof cardPlaceSchema>;

/** How many subclass cards a PC holds: none, the foundation, then specialization, then mastery. */
export const SUBCLASS_CARDS_MAX = 3;

/** The links a sheet holds, as ids (null when that part is typed or unset). */
export const sheetLinksSchema = z.object({
  classId: z.uuid().nullable(),
  subclassId: z.uuid().nullable(),
  subclassCards: z.int().min(0).max(SUBCLASS_CARDS_MAX),
  /** The second is for a mixed ancestry. */
  speciesIds: z.tuple([z.uuid().nullable(), z.uuid().nullable()]),
  primaryWeaponId: z.uuid().nullable(),
  secondaryWeaponId: z.uuid().nullable(),
  armorId: z.uuid().nullable(),
  /** Linked spare weapons, in order; the same weapon may be carried twice. */
  spareWeaponIds: z.array(z.uuid()),
  /** A second class (F4.10): its class features, one of its domains and one of its subclasses. */
  multiclassClassId: z.uuid().nullable(),
  multiclassDomainId: z.uuid().nullable(),
  multiclassSubclassId: z.uuid().nullable(),
  multiclassSubclassCards: z.int().min(0).max(SUBCLASS_CARDS_MAX),
});
export type SheetLinks = z.infer<typeof sheetLinksSchema>;

/** A sheet with nothing linked. */
export function noSheetLinks(): SheetLinks {
  return {
    classId: null,
    subclassId: null,
    subclassCards: 1,
    speciesIds: [null, null],
    primaryWeaponId: null,
    secondaryWeaponId: null,
    armorId: null,
    spareWeaponIds: [],
    multiclassClassId: null,
    multiclassDomainId: null,
    multiclassSubclassId: null,
    multiclassSubclassCards: 1,
  };
}

/** A weapon as the sheet shows it, linked or typed. */
export const builtWeaponSchema = z.object({
  /** The weapon record, or null for a typed weapon. */
  weaponId: z.uuid().nullable(),
  name: z.string(),
  /** A trait id of the campaign's ruleset, or null when a typed weapon has none. */
  trait: z.string().nullable(),
  range: z.string(),
  /** "2d10+3": the dice are the PC's proficiency for a linked weapon. */
  damage: z.string(),
  damageType: z.string(),
  burden: burdenSchema.nullable(),
  /** "Massive: −1 to Evasion", or the typed feature. */
  feature: z.string(),
});
export type BuiltWeapon = z.infer<typeof builtWeaponSchema>;

/** The numbers and parts the sheet shows, worked out from its stored values and links. */
export const builtSheetSchema = z.object({
  className: z.string(),
  /** Stored traits plus equipped gear's trait bonuses: what rolls use. */
  traits: z.record(z.string(), z.int()),
  evasion: z.int(),
  armorScore: z.int(),
  armorSlotsMax: z.int(),
  /** The minor threshold is null once armor is linked (19.16). */
  thresholds: z.object({ minor: z.int().nullable(), major: z.int(), severe: z.int() }),
  armorName: z.string().nullable(),
  weapons: z.object({
    primary: builtWeaponSchema.nullable(),
    secondary: builtWeaponSchema.nullable(),
    /** Typed spares first, then linked ones. */
    spares: z.array(builtWeaponSchema),
  }),
  /** Which parts come from records. */
  linked: z.object({
    class: z.boolean(),
    armor: z.boolean(),
    primary: z.boolean(),
    secondary: z.boolean(),
  }),
  /** Gear above the PC's tier, and anything else worth a look. Never refusals. */
  warnings: z.array(z.string()),
});
export type BuiltSheet = z.infer<typeof builtSheetSchema>;

/** A domain card a PC holds. */
export const heldCardSchema = domainCardSchema.extend({
  place: cardPlaceSchema,
  /** The PC's level when it was added. */
  takenAtLevel: z.int(),
  /** Outside the class's domains or above the PC's level, in words; null when it's fine. */
  warning: z.string().nullable(),
});
export type HeldCard = z.infer<typeof heldCardSchema>;

/** A subclass card, with the cards held (the rest are null). */
const subclassCardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  className: z.string(),
  spellcastTrait: z.string().nullable(),
  foundation: z.array(featureRowSchema).nullable(),
  specialization: z.array(featureRowSchema).nullable(),
  mastery: z.array(featureRowSchema).nullable(),
});
export type SubclassCard = z.infer<typeof subclassCardSchema>;

/** The PC's feature cards: what lies beside the sheet page at the table. */
export const sheetCardsSchema = z.object({
  class: z
    .object({
      id: z.uuid(),
      name: z.string(),
      hopeFeature: hopeFeatureSchema,
      classFeatures: z.array(featureRowSchema),
    })
    .nullable(),
  subclass: subclassCardSchema.nullable(),
  /** The second class (F4.10): its class features, the domain taken, and the subclass held. */
  multiclass: z
    .object({
      classId: z.uuid(),
      className: z.string(),
      classFeatures: z.array(featureRowSchema),
      domainName: z.string().nullable(),
      subclass: subclassCardSchema.nullable(),
    })
    .nullable(),
  /** One species with all its features, or two with one feature each (a mixed ancestry). */
  species: z.array(
    z.object({ id: z.uuid(), name: z.string(), features: z.array(featureRowSchema) }),
  ),
  gear: z.object({
    primary: weaponRecordSchema.nullable(),
    secondary: weaponRecordSchema.nullable(),
    armor: armorRecordSchema.nullable(),
  }),
  loadout: z.array(heldCardSchema),
  vault: z.array(heldCardSchema),
});
export type SheetCards = z.infer<typeof sheetCardsSchema>;

/** A subclass as `buildSheet` reads it. */
export interface SubclassRecordForSheet {
  id: string;
  name: string;
  className: string;
  spellcastTrait: string | null;
  foundation: FeatureRow[];
  specialization: FeatureRow[];
  mastery: FeatureRow[];
}

/** The linked records `buildSheet` reads, loaded by the server. */
export interface SheetRecords {
  class: {
    id: string;
    name: string;
    domainIds: readonly (string | null)[];
    hopeFeature: HopeFeature;
    classFeatures: FeatureRow[];
  } | null;
  subclass: SubclassRecordForSheet | null;
  /** The second class, its domain taken and its subclass (F4.10); missing or null without. */
  multiclass?: {
    class: { id: string; name: string; classFeatures: FeatureRow[] };
    domain: { id: string; name: string } | null;
    subclass: SubclassRecordForSheet | null;
  } | null;
  species: readonly [
    { id: string; name: string; features: FeatureRow[] } | null,
    { id: string; name: string; features: FeatureRow[] } | null,
  ];
  primary: WeaponRecord | null;
  secondary: WeaponRecord | null;
  armor: ArmorRecord | null;
  spares: readonly WeaponRecord[];
  cards: readonly { card: DomainCard; place: CardPlace; takenAtLevel: number }[];
}

/** The stored values `buildSheet` reads. */
export interface StoredSheet {
  name: string;
  level: number;
  className: string;
  traits: Record<string, number>;
  evasion: number;
  armorScore: number;
  armorSlotsMax: number;
  minorThreshold: number;
  majorThreshold: number;
  severeThreshold: number;
  proficiency: number;
  weapons: { primary: Weapon | null; secondary: Weapon | null; inventory: Weapon[] };
  armor: { name: string } | null;
  /**
   * When the creation guide finished it (F4.8); null or missing for a sheet typed by hand. A
   * built sheet with no armor at all is unarmored: its thresholds follow its level.
   */
  builtAt?: string | Date | null;
}

/** What equipped gear adds, summed over the primary, secondary and armor. */
export function equippedBonuses(
  gear: readonly (Pick<WeaponRecord | ArmorRecord, 'bonuses'> | null)[],
): GearBonuses {
  const total: GearBonuses = {
    evasion: 0,
    armorScore: 0,
    majorThreshold: 0,
    severeThreshold: 0,
    traits: {},
  };
  for (const piece of gear) {
    if (piece === null) continue;
    const { bonuses } = piece;
    total.evasion += bonuses.evasion;
    total.armorScore += bonuses.armorScore;
    total.majorThreshold += bonuses.majorThreshold;
    total.severeThreshold += bonuses.severeThreshold;
    for (const [trait, bonus] of Object.entries(bonuses.traits)) {
      total.traits[trait] = (total.traits[trait] ?? 0) + bonus;
    }
  }
  return total;
}

/** Stored traits plus gear's trait bonuses, one entry per trait of the ruleset. */
export function effectiveTraits(
  stored: Record<string, number>,
  bonuses: GearBonuses,
  ruleset: Ruleset,
): Record<string, number> {
  return Object.fromEntries(
    ruleset.traits.map((trait) => [
      trait.id,
      (stored[trait.id] ?? 0) + (bonuses.traits[trait.id] ?? 0),
    ]),
  );
}

function featureLine(name: string, text: string): string {
  if (name === '') return text;
  return text === '' ? name : `${name}: ${text}`;
}

function linkedWeapon(weapon: WeaponRecord, proficiency: number): BuiltWeapon {
  return {
    weaponId: weapon.id,
    name: weapon.name,
    trait: weapon.trait,
    range: weaponRangeLabel(weapon.range),
    damage: formatDamage(weapon.damageDie, weapon.damageBonus, Math.max(1, proficiency)),
    damageType: weapon.kind,
    burden: weapon.burden,
    feature: featureLine(weapon.featureName, weapon.featureText),
  };
}

function typedWeapon(weapon: Weapon): BuiltWeapon {
  return {
    weaponId: null,
    name: weapon.name,
    trait: weapon.trait,
    range: weapon.range,
    damage: weapon.damageDice,
    damageType: weapon.damageType,
    burden: null,
    feature: weapon.feature,
  };
}

/** Works out the sheet's shown numbers, its weapons and its feature cards. */
export function buildSheet(
  stored: StoredSheet,
  links: Pick<SheetLinks, 'subclassCards'> & Partial<Pick<SheetLinks, 'multiclassSubclassCards'>>,
  records: SheetRecords,
  ruleset: Ruleset,
): { built: BuiltSheet; cards: SheetCards } {
  const { primary, secondary, armor } = records;
  const bonuses = equippedBonuses([primary, secondary, armor]);
  // A sheet the guide built with no armor, linked or typed, is unarmored (F4.8, D-66): no armor
  // score of its own, and its thresholds are its level and twice its level.
  const unarmored = armor === null && stored.armor === null && stored.builtAt != null;
  const baseScore = armor !== null ? armor.baseScore : unarmored ? 0 : stored.armorScore;
  const armorScore = baseScore + bonuses.armorScore;
  const thresholds =
    armor !== null
      ? {
          minor: null,
          major: armor.baseMajorThreshold + stored.level + bonuses.majorThreshold,
          severe: armor.baseSevereThreshold + stored.level + bonuses.severeThreshold,
        }
      : unarmored
        ? {
            minor: null,
            major: stored.level + bonuses.majorThreshold,
            severe: 2 * stored.level + bonuses.severeThreshold,
          }
        : {
            minor: stored.minorThreshold,
            major: stored.majorThreshold + bonuses.majorThreshold,
            severe: stored.severeThreshold + bonuses.severeThreshold,
          };

  const warnings: string[] = [];
  const tier = tierOf(stored.level, ruleset);
  if (tier !== null) {
    for (const piece of [primary, secondary, armor, ...records.spares]) {
      if (piece !== null && piece.tier > tier) {
        warnings.push(
          `${piece.name} is tier ${String(piece.tier)}, above ${stored.name}'s tier (${String(tier)})`,
        );
      }
    }
  }

  const built: BuiltSheet = {
    className:
      records.class === null
        ? stored.className
        : records.multiclass == null
          ? records.class.name
          : `${records.class.name} / ${records.multiclass.class.name}`,
    traits: effectiveTraits(stored.traits, bonuses, ruleset),
    evasion: stored.evasion + bonuses.evasion,
    armorScore,
    armorSlotsMax: armor !== null ? armorScore : unarmored ? 0 : stored.armorSlotsMax,
    thresholds,
    armorName: armor?.name ?? stored.armor?.name ?? null,
    weapons: {
      primary:
        primary === null
          ? stored.weapons.primary === null
            ? null
            : typedWeapon(stored.weapons.primary)
          : linkedWeapon(primary, stored.proficiency),
      secondary:
        secondary === null
          ? stored.weapons.secondary === null
            ? null
            : typedWeapon(stored.weapons.secondary)
          : linkedWeapon(secondary, stored.proficiency),
      spares: [
        ...stored.weapons.inventory.map(typedWeapon),
        ...records.spares.map((weapon) => linkedWeapon(weapon, stored.proficiency)),
      ],
    },
    linked: {
      class: records.class !== null,
      armor: armor !== null,
      primary: primary !== null,
      secondary: secondary !== null,
    },
    warnings,
  };

  const held = (place: CardPlace) =>
    records.cards
      .filter((entry) => entry.place === place)
      .map(({ card, takenAtLevel }) => ({
        ...card,
        place,
        takenAtLevel,
        warning: cardWarning(card, stored, records.class, records.multiclass?.domain ?? null),
      }))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  /** A subclass with the cards held: none, the foundation, then specialization, then mastery. */
  const subclassCard = (sub: SubclassRecordForSheet, held: number) => ({
    id: sub.id,
    name: sub.name,
    className: sub.className,
    spellcastTrait: sub.spellcastTrait,
    foundation: held >= 1 ? sub.foundation : null,
    specialization: held >= 2 ? sub.specialization : null,
    mastery: held >= 3 ? sub.mastery : null,
  });
  const sub = records.subclass;
  const multi = records.multiclass ?? null;
  const [first, second] = records.species;
  const species =
    first !== null && second !== null
      ? [
          { id: first.id, name: first.name, features: first.features.slice(0, 1) },
          { id: second.id, name: second.name, features: second.features.slice(1, 2) },
        ]
      : [first ?? second].filter((one) => one !== null);

  const cards: SheetCards = {
    class:
      records.class === null
        ? null
        : {
            id: records.class.id,
            name: records.class.name,
            hopeFeature: records.class.hopeFeature,
            classFeatures: records.class.classFeatures,
          },
    subclass: sub === null ? null : subclassCard(sub, links.subclassCards),
    multiclass:
      multi === null
        ? null
        : {
            classId: multi.class.id,
            className: multi.class.name,
            classFeatures: multi.class.classFeatures,
            domainName: multi.domain?.name ?? null,
            subclass:
              multi.subclass === null
                ? null
                : subclassCard(multi.subclass, links.multiclassSubclassCards ?? 1),
          },
    species,
    gear: { primary, secondary, armor },
    loadout: held('loadout'),
    vault: held('vault'),
  };
  return { built, cards };
}

/** No linked records: what an unlinked sheet is built from. */
export const NO_SHEET_RECORDS: SheetRecords = Object.freeze({
  class: null,
  subclass: null,
  species: [null, null] as const,
  primary: null,
  secondary: null,
  armor: null,
  spares: [],
  cards: [],
});

/** The `links`, `built` and `cards` of a sheet that links nothing: its typed values as they are. */
export function unlinkedSheetParts(
  stored: StoredSheet,
  ruleset: Ruleset,
): { links: SheetLinks; built: BuiltSheet; cards: SheetCards } {
  const links = noSheetLinks();
  return { links, ...buildSheet(stored, links, NO_SHEET_RECORDS, ruleset) };
}

/** Why a held card breaks the rules, in words; null when it doesn't. */
function cardWarning(
  card: DomainCard,
  stored: Pick<StoredSheet, 'level' | 'name'>,
  linkedClass: SheetRecords['class'],
  multiclassDomain: { id: string; name: string } | null,
): string | null {
  const ownDomain = linkedClass === null || linkedClass.domainIds.includes(card.domainId);
  if (!ownDomain && multiclassDomain?.id === card.domainId) {
    // A multiclass domain's cards go up to half the level, rounded up (F4.10).
    const limit = multiclassCardLevel(stored.level);
    return card.level > limit
      ? `${card.domainName} is ${stored.name}'s multiclass domain: level ${String(limit)} or lower`
      : null;
  }
  if (linkedClass !== null && !ownDomain) {
    return `${card.domainName} isn't one of ${linkedClass.name}'s domains`;
  }
  if (card.level > stored.level) {
    return `Level ${String(card.level)}, above ${stored.name}'s level (${String(stored.level)})`;
  }
  return null;
}

/** The highest level of card a PC at `level` may take from a multiclass domain (F4.10). */
export function multiclassCardLevel(level: number): number {
  return Math.ceil(level / 2);
}

/** The loadout's limit, from the ruleset (five in v2). */
export function loadoutMaxOf(ruleset: Ruleset): number {
  return ruleset.domainCards?.loadoutMax ?? 5;
}

/** `POST …/characters/:characterId/domain-cards`: the GM adds a card the PC doesn't hold. */
export const addHeldCardRequestSchema = z.strictObject({
  cardId: z.uuid(),
  /** Defaults to the loadout, or the vault when the loadout is full. */
  place: cardPlaceSchema.optional(),
});
export type AddHeldCardRequest = z.infer<typeof addHeldCardRequestSchema>;

/**
 * `POST …/characters/:characterId/domain-cards/:cardId/move`: the PC's player or the GM. Into
 * the vault is free; into the loadout is free while the session's Rest is on, and otherwise
 * marks Stress equal to the card's recall cost (refused without enough slots, 19.24). A full
 * loadout needs `swapOut`, a loadout card that goes to the vault instead.
 */
export const moveHeldCardRequestSchema = z.strictObject({
  to: cardPlaceSchema,
  swapOut: z.uuid().optional(),
});
export type MoveHeldCardRequest = z.infer<typeof moveHeldCardRequestSchema>;

/** The refusal for a full loadout without a card to swap out. */
export const LOADOUT_FULL = 'The loadout is full: pick a card to put in the vault';

/** The refusal for a recall without enough Stress slots left (19.24). */
export function notEnoughStress(cost: number, left: number): string {
  return `Bringing it back marks ${String(cost)} Stress; only ${String(left)} left`;
}
