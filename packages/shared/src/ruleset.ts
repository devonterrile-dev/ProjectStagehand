/**
 * The homebrew ruleset's values (governance §9, D-13, D-16). They live here as config, not
 * scattered through code, so a campaign can later run a customized ruleset. A campaign
 * picks its version with `campaigns.ruleset_version`.
 *
 * Published versions are immutable: stored sheets are validated against their campaign's
 * version on every read, so changing a version's traits or limits would break stored data.
 * To change the rules, add a new version (and a data migration for campaigns that move).
 */

export interface RulesetTrait {
  /** Stable key used in stored sheets. Never rename it within a version. */
  readonly id: string;
  readonly label: string;
}

export interface Ruleset {
  readonly version: number;
  /** The six traits in display order; each PC has a modifier for every one. */
  readonly traits: readonly RulesetTrait[];
  /** Range of a trait modifier, inclusive. */
  readonly traitModifier: { readonly min: number; readonly max: number };
  /** Most Hope a PC can hold. */
  readonly hopeMax: number;
  /** Added to a roll when the player spends Hope (open question 19.1 for its cost). */
  readonly hopeSpendBonus: number;
  /** Hope paid for a teamwork roll. */
  readonly teamworkCost: number;
  /** The GM's Fear when a session starts. */
  readonly fearStart: number;
  /** Most Fear the GM can hold. */
  readonly fearCap: number;
}

const RULESET_V1: Ruleset = Object.freeze({
  version: 1,
  traits: Object.freeze([
    { id: 'agility', label: 'Agility' },
    { id: 'strength', label: 'Strength' },
    { id: 'finesse', label: 'Finesse' },
    { id: 'instinct', label: 'Instinct' },
    { id: 'presence', label: 'Presence' },
    { id: 'knowledge', label: 'Knowledge' },
  ]),
  traitModifier: Object.freeze({ min: -1, max: 2 }),
  hopeMax: 6,
  hopeSpendBonus: 3,
  teamworkCost: 3,
  fearStart: 3,
  fearCap: 12,
});

/** Every published ruleset, by version. */
export const RULESETS: Readonly<Record<number, Ruleset>> = Object.freeze({ 1: RULESET_V1 });

/** The version a new campaign gets (the `campaigns.ruleset_version` default). */
export const DEFAULT_RULESET_VERSION = 1;

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
