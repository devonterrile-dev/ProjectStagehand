import {
  POTIONS,
  richTextSchema,
  type FeatureRow,
  type PlayerCharacterSheet,
  type Potion,
  type RichText,
} from '@stagehand/shared';

/**
 * The creation guide's picks while the player goes through it (F4.8). Nothing reaches the server
 * until Finish; the draft is kept in this browser only, so a reload doesn't lose it.
 */
export interface GuideDraft {
  step: number;
  classId: string | null;
  subclassId: string | null;
  /** The class whose suggestions (traits, gear) were filled in, so they aren't filled twice. */
  prefilledFor: string | null;
  speciesIds: [string | null, string | null];
  mixed: boolean;
  /** Trait id → modifier picked; null while that trait has none. */
  traits: Record<string, number | null>;
  primaryWeaponId: string | null;
  secondaryWeaponId: string | null;
  armorId: string | null;
  potion: Potion | null;
  cardIds: string[];
  name: string;
  description: RichText;
}

const isId = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length > 0);
const isPotion = (value: unknown): value is Potion | null =>
  value === null || POTIONS.some((one) => one === value);

/** A stored draft read back, or null when it isn't one (an old shape, or edited by hand). */
function readDraft(value: unknown): GuideDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const d = value as Record<string, unknown>;
  const ids = d['speciesIds'];
  const traits = d['traits'];
  const cardIds = d['cardIds'];
  const potion = d['potion'];
  const description = richTextSchema.safeParse(d['description']);
  if (
    typeof d['step'] !== 'number' ||
    !isId(d['classId']) ||
    !isId(d['subclassId']) ||
    !isId(d['prefilledFor']) ||
    !Array.isArray(ids) ||
    ids.length !== 2 ||
    !ids.every(isId) ||
    typeof d['mixed'] !== 'boolean' ||
    typeof traits !== 'object' ||
    traits === null ||
    !Object.values(traits).every((one) => one === null || typeof one === 'number') ||
    !isId(d['primaryWeaponId']) ||
    !isId(d['secondaryWeaponId']) ||
    !isId(d['armorId']) ||
    !isPotion(potion) ||
    !Array.isArray(cardIds) ||
    !cardIds.every((one) => typeof one === 'string') ||
    typeof d['name'] !== 'string' ||
    !description.success
  ) {
    return null;
  }
  return {
    step: d['step'],
    classId: d['classId'],
    subclassId: d['subclassId'],
    prefilledFor: d['prefilledFor'],
    speciesIds: [ids[0] as string | null, ids[1] as string | null],
    mixed: d['mixed'],
    traits: traits as Record<string, number | null>,
    primaryWeaponId: d['primaryWeaponId'],
    secondaryWeaponId: d['secondaryWeaponId'],
    armorId: d['armorId'],
    potion,
    cardIds,
    name: d['name'],
    description: description.data,
  };
}

const keyOf = (characterId: string) => `stagehand:creation-guide:${characterId}`;

/** A new draft, starting from the sheet's name and description. */
export function newDraft(
  sheet: Pick<PlayerCharacterSheet, 'name' | 'publicDescription'>,
): GuideDraft {
  return {
    step: 0,
    classId: null,
    subclassId: null,
    prefilledFor: null,
    speciesIds: [null, null],
    mixed: false,
    traits: {},
    primaryWeaponId: null,
    secondaryWeaponId: null,
    armorId: null,
    potion: null,
    cardIds: [],
    name: sheet.name,
    description: sheet.publicDescription,
  };
}

/** The draft this browser kept for the character; null when there is none or it can't be read. */
export function loadDraft(characterId: string): GuideDraft | null {
  try {
    const raw = window.localStorage.getItem(keyOf(characterId));
    if (raw === null) return null;
    return readDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDraft(characterId: string, draft: GuideDraft): void {
  try {
    window.localStorage.setItem(keyOf(characterId), JSON.stringify(draft));
  } catch {
    // Storage may be full or blocked; the guide works without it.
  }
}

export function clearDraft(characterId: string): void {
  try {
    window.localStorage.removeItem(keyOf(characterId));
  } catch {
    // Nothing to clear.
  }
}

/**
 * The features an ancestry gives: all of one species, or for a mixed ancestry the first feature of
 * one and the second of the other, each marked with its species (D-64).
 */
export function ancestryFeatures(
  first: { name: string; features: FeatureRow[] } | null | undefined,
  second: { name: string; features: FeatureRow[] } | null | undefined,
): FeatureRow[] {
  if (first == null) return [];
  if (second == null) return first.features;
  return [
    ...first.features
      .slice(0, 1)
      .map((feature) => ({ ...feature, name: `${feature.name} (${first.name})` })),
    ...second.features
      .slice(1, 2)
      .map((feature) => ({ ...feature, name: `${feature.name} (${second.name})` })),
  ];
}
