import {
  signed,
  traitLabel,
  type Burden,
  type DamageKind,
  type DomainCardType,
  type GameplayRef,
  type GearBonuses,
  type HopeFeature,
  type Ruleset,
  type SuggestedTraits,
  type WeaponRange,
  type WeaponSlot,
} from '@stagehand/shared';

/** A class's domains: "Blade & Bone", "Blade" with one unset, "None yet" with neither (F4.5). */
export function domainsLabel(domains: readonly (GameplayRef | null)[]): string {
  const names = domains.filter((domain) => domain !== null).map((domain) => domain.name);
  return names.length === 0 ? 'None yet' : names.join(' & ');
}

/** "Rally (3 Hope)", or "Hope feature (3 Hope)" while unnamed. */
export function hopeFeatureLabel(hope: HopeFeature): string {
  return `${hope.name === '' ? 'Hope feature' : hope.name} (${String(hope.cost)} Hope)`;
}

/** "Agility +2, Strength +1, …" in ruleset order; empty when there is no suggestion. */
export function suggestedTraitsLabel(traits: SuggestedTraits, ruleset: Ruleset): string {
  if (Object.keys(traits).length === 0) return '';
  return ruleset.traits
    .map((trait) => `${trait.label} ${signed(traits[trait.id] ?? 0)}`)
    .join(', ');
}

const TYPE_LABELS: Record<DomainCardType, string> = {
  ability: 'Ability',
  spell: 'Spell',
  grimoire: 'Grimoire',
};

/** "Ability", "Spell" or "Grimoire" (F4.3). */
export function cardTypeLabel(type: DomainCardType): string {
  return TYPE_LABELS[type];
}

const SLOT_LABELS: Record<WeaponSlot, string> = { primary: 'Primary', secondary: 'Secondary' };
const KIND_LABELS: Record<DamageKind, string> = { physical: 'Physical', magic: 'Magic' };
const RANGE_LABELS: Record<WeaponRange, string> = {
  melee: 'Melee',
  very_close: 'Very close',
  close: 'Close',
  far: 'Far',
  very_far: 'Very far',
};
const BURDEN_LABELS: Record<Burden, string> = {
  one_handed: 'One-handed',
  two_handed: 'Two-handed',
};

/** "Primary" or "Secondary" (F4.4). */
export function slotLabel(slot: WeaponSlot): string {
  return SLOT_LABELS[slot];
}

/** "Physical" or "Magic". */
export function damageKindLabel(kind: DamageKind): string {
  return KIND_LABELS[kind];
}

/** "Melee", "Very close", "Close", "Far" or "Very far". */
export function rangeLabel(range: WeaponRange): string {
  return RANGE_LABELS[range];
}

/** "One-handed" or "Two-handed". */
export function burdenLabel(burden: Burden): string {
  return BURDEN_LABELS[burden];
}

/**
 * What a piece of gear changes while equipped, in words: "−1 Evasion, +1 Armor score,
 * −1 Agility". A bonus to every trait reads "−1 to all traits". Empty when it changes nothing.
 */
export function bonusesLabel(bonuses: GearBonuses, ruleset: Ruleset): string {
  const parts: string[] = [];
  const add = (value: number, what: string) => {
    if (value !== 0) parts.push(`${signed(value)} ${what}`);
  };
  add(bonuses.evasion, 'Evasion');
  add(bonuses.armorScore, 'Armor score');
  add(bonuses.majorThreshold, 'Major threshold');
  add(bonuses.severeThreshold, 'Severe threshold');
  const values = ruleset.traits.map((trait) => bonuses.traits[trait.id] ?? 0);
  const first = values[0] ?? 0;
  if (first !== 0 && values.every((value) => value === first)) {
    parts.push(`${signed(first)} to all traits`);
  } else {
    for (const trait of ruleset.traits)
      add(bonuses.traits[trait.id] ?? 0, traitLabel(ruleset, trait.id));
  }
  return parts.join(', ');
}
