import {
  signed,
  traitLabel,
  type Burden,
  type DamageKind,
  type DomainCardType,
  type GearBonuses,
  type Ruleset,
  type WeaponRange,
  type WeaponSlot,
} from '@stagehand/shared';

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
