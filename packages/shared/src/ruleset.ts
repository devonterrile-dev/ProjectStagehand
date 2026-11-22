/**
 * The homebrew ruleset's values (governance §9, D-13, D-16). They live here as config, not
 * scattered through code, so a campaign can later run a customized ruleset. A campaign
 * picks its version with `campaigns.ruleset_version`.
 *
 * Published versions are immutable: stored sheets are validated against their campaign's
 * version on every read, so changing a version's traits or limits would break stored data.
 * To change the rules, add a new version (and a data migration for campaigns that move).
 *
 * Phase 4 grows version 2 as it goes (D-59): a later feature may add a new field to v2 (the
 * level-up options in F4.9, multiclassing in F4.10), but never change a value already in it.
 */

export interface RulesetTrait {
  /** Stable key used in stored sheets. Never rename it within a version. */
  readonly id: string;
  readonly label: string;
}

/** A tier and the levels in it, inclusive (§9 "Levels and tiers"). */
export interface RulesetTier {
  readonly tier: number;
  readonly minLevel: number;
  readonly maxLevel: number;
}

/** The level-up options (§9 "Leveling up", F4.9). */
export const LEVEL_UP_OPTION_IDS = [
  'traits',
  'hp',
  'stress',
  'hopeBonus',
  'domainCard',
  'evasion',
  'subclass',
  'proficiency',
  'multiclass',
] as const;
export type LevelUpOptionId = (typeof LEVEL_UP_OPTION_IDS)[number];

/** One level-up option, as each tier's list offers it. */
export interface LevelUpOptionRule {
  readonly id: LevelUpOptionId;
  readonly label: string;
  /** The tiers whose lists have it. */
  readonly tiers: readonly number[];
  /** How many times each of those lists offers it. */
  readonly count: number;
  /** Two marks: one pick at each of two level-ups in the same tier, applied on the second. */
  readonly marks: 1 | 2;
  /** False for an option that can't be picked yet (multiclassing arrives with F4.10). */
  readonly pickable: boolean;
}

export interface Ruleset {
  readonly version: number;
  /** The six traits in display order; each PC has a modifier for every one. */
  readonly traits: readonly RulesetTrait[];
  /** Range of a trait modifier, inclusive. */
  readonly traitModifier: { readonly min: number; readonly max: number };
  /** Most Hope a PC can hold. */
  readonly hopeMax: number;
  /**
   * Added to a roll when the player spends 1 Hope (19.1). From v2 the PC's own Hope bonus,
   * raised by level-ups, is added on top.
   */
  readonly hopeSpendBonus: number;
  /** Hope paid for a teamwork roll. */
  readonly teamworkCost: number;
  /** The GM's Fear when a session starts. */
  readonly fearStart: number;
  /** Most Fear the GM can hold. */
  readonly fearCap: number;

  // From version 2 (F4.1, D-58). Version 1 has none of these.

  /** The levels a PC can have, inclusive. */
  readonly levels?: { readonly min: number; readonly max: number };
  /** The tiers in order, covering every level once. */
  readonly tiers?: readonly RulesetTier[];
  /** Proficiency at level 1, and what entering each new tier adds. */
  readonly proficiency?: { readonly start: number; readonly perTier: number };
  /** The trait modifiers handed out at creation, one per trait, in any order. */
  readonly creationTraitSpread?: readonly number[];
  /** What a new PC starts with: current Hope, and Stress slots with none marked (19.17). */
  readonly start?: { readonly hope: number; readonly stressSlots: number };
  /** Level-1 cards picked at creation, and most cards in the loadout. */
  readonly domainCards?: { readonly atCreation: number; readonly loadoutMax: number };
  /** Options picked at each level-up (F4.9). */
  readonly levelUpPicks?: number;
  /** The level-up options and each tier list's counts (F4.9, §9). */
  readonly levelUpOptions?: readonly LevelUpOptionRule[];
}

const option = (
  id: LevelUpOptionId,
  label: string,
  tiers: readonly number[],
  count: number,
  marks: 1 | 2 = 1,
  pickable = true,
): LevelUpOptionRule =>
  Object.freeze({ id, label, tiers: Object.freeze([...tiers]), count, marks, pickable });

const ALL_TIERS = [2, 3, 4] as const;
const FROM_TIER_3 = [3, 4] as const;

const TRAITS: readonly RulesetTrait[] = Object.freeze([
  Object.freeze({ id: 'agility', label: 'Agility' }),
  Object.freeze({ id: 'strength', label: 'Strength' }),
  Object.freeze({ id: 'finesse', label: 'Finesse' }),
  Object.freeze({ id: 'instinct', label: 'Instinct' }),
  Object.freeze({ id: 'presence', label: 'Presence' }),
  Object.freeze({ id: 'knowledge', label: 'Knowledge' }),
]);

const RULESET_V1: Ruleset = Object.freeze({
  version: 1,
  traits: TRAITS,
  traitModifier: Object.freeze({ min: -1, max: 2 }),
  hopeMax: 6,
  hopeSpendBonus: 3,
  teamworkCost: 3,
  fearStart: 3,
  fearCap: 12,
});

const RULESET_V2: Ruleset = Object.freeze({
  version: 2,
  traits: TRAITS,
  /** +2 at most at creation, then at most +1 per tier from level-ups (a raised trait is marked). */
  traitModifier: Object.freeze({ min: -1, max: 5 }),
  hopeMax: 6,
  hopeSpendBonus: 2,
  teamworkCost: 3,
  fearStart: 3,
  fearCap: 12,
  levels: Object.freeze({ min: 1, max: 10 }),
  tiers: Object.freeze([
    Object.freeze({ tier: 1, minLevel: 1, maxLevel: 1 }),
    Object.freeze({ tier: 2, minLevel: 2, maxLevel: 4 }),
    Object.freeze({ tier: 3, minLevel: 5, maxLevel: 7 }),
    Object.freeze({ tier: 4, minLevel: 8, maxLevel: 10 }),
  ]),
  proficiency: Object.freeze({ start: 1, perTier: 1 }),
  creationTraitSpread: Object.freeze([2, 1, 1, 0, 0, -1]),
  start: Object.freeze({ hope: 0, stressSlots: 6 }),
  domainCards: Object.freeze({ atCreation: 2, loadoutMax: 5 }),
  levelUpPicks: 2,
  levelUpOptions: Object.freeze([
    option('traits', '+1 to two unmarked traits, and mark them', ALL_TIERS, 3),
    option('hp', 'One more HP slot', ALL_TIERS, 2),
    option('stress', 'One more Stress slot', ALL_TIERS, 2),
    option('hopeBonus', '+1 to your Hope bonus', ALL_TIERS, 1),
    option('domainCard', 'An extra domain card of your level or lower', ALL_TIERS, 1),
    option('evasion', '+1 Evasion', ALL_TIERS, 1),
    option('subclass', 'Upgrade your subclass card (specialization, then mastery)', FROM_TIER_3, 1),
    option('proficiency', '+1 Proficiency (two marks)', FROM_TIER_3, 1, 2),
    option('multiclass', 'Multiclass: take a second class (two marks)', FROM_TIER_3, 1, 2),
  ]),
});

/** Every published ruleset, by version. */
export const RULESETS: Readonly<Record<number, Ruleset>> = Object.freeze({
  1: RULESET_V1,
  2: RULESET_V2,
});

/** The version a new campaign gets (the `campaigns.ruleset_version` default). */
export const DEFAULT_RULESET_VERSION = 2;

/** The ruleset of a version. Throws for a version that doesn't exist. */
export function rulesetFor(version: number): Ruleset {
  const ruleset = RULESETS[version];
  if (!ruleset) throw new Error(`Unknown ruleset version ${String(version)}`);
  return ruleset;
}

/** A ruleset's trait ids, in display order. */
export function traitIdsOf(ruleset: Ruleset): string[] {
  return ruleset.traits.map((trait) => trait.id);
}
