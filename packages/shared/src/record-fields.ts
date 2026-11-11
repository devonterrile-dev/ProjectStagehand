/**
 * The eight narrative record types and their private `fields` (governance §8). Every record
 * of a type has the same fields in the same order ("same shape every time"), so the GM
 * always knows where to look. Each type has:
 *
 * - a Zod shape, which the API validates `fields` against and which types the client;
 * - a display spec (`RECORD_FIELD_SPECS`) in §8's order, which the form renderer and the
 *   AI-import prompts read. Link fields are listed there too, with the record types they
 *   accept and whether they hold one or many; they are `record_links` rows (D-24), not part
 *   of `fields`.
 *
 * Adding a type means adding both here (and a fixture in the server tests), not a migration.
 */
import { z } from 'zod';

import { recordRichTextSchema as richTextSchema } from './rich-text';

export const RECORD_TYPES = [
  'npc',
  'area',
  'spot',
  'faction',
  'lore',
  'story_beat',
  'item',
  'session_notes',
] as const;
export const recordTypeSchema = z.enum(RECORD_TYPES);
export type RecordType = z.infer<typeof recordTypeSchema>;

export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  npc: 'NPC',
  area: 'Area',
  spot: 'Spot',
  faction: 'Faction',
  lore: 'Lore',
  story_beat: 'Story beat',
  item: 'Item',
  session_notes: 'Session notes',
};

/** Longest plain-text field. Rich text has its own limits. */
export const TEXT_FIELD_MAX = 2000;
export const textField = z
  .string()
  .trim()
  .max(TEXT_FIELD_MAX, `Must be ${String(TEXT_FIELD_MAX)} characters or fewer`);

export const npcStatusSchema = z.enum(['alive', 'dead', 'missing', 'unknown']);
export type NpcStatus = z.infer<typeof npcStatusSchema>;
export const storyBeatStatusSchema = z.enum(['planned', 'active', 'done', 'skipped']);
export type StoryBeatStatus = z.infer<typeof storyBeatStatusSchema>;

/** A Spot's points of interest become clickable prompts on stage (F3.1). */
export const POINTS_OF_INTEREST_MAX = 50;
const pointOfInterestSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'A point of interest needs a name')
    .max(120, 'A point of interest name must be 120 characters or fewer'),
  detail: textField,
});
export type PointOfInterest = z.infer<typeof pointOfInterestSchema>;

// Shapes list every field as required; `.partial()` below makes them all optional
// ("all are optional except name"), and `patchOf` makes them nullable for PATCH.

const NPC_SHAPE = {
  appearance: textField,
  personality: richTextSchema,
  voiceAndMannerisms: textField,
  wants: richTextSchema,
  knowledge: richTextSchema,
  secrets: richTextSchema,
  roleInStory: richTextSchema,
  status: npcStatusSchema,
};
const AREA_SHAPE = {
  kindOfPlace: textField,
  overview: richTextSchema,
  atmosphere: richTextSchema,
  notableFeatures: richTextSchema,
  hooks: richTextSchema,
  secrets: richTextSchema,
};
const SPOT_SHAPE = {
  readAloud: richTextSchema,
  pointsOfInterest: z
    .array(pointOfInterestSchema)
    .max(POINTS_OF_INTEREST_MAX, `At most ${String(POINTS_OF_INTEREST_MAX)} points of interest`),
  hiddenDetails: richTextSchema,
  backdropNotes: textField,
};
const FACTION_SHAPE = {
  goals: richTextSchema,
  resources: richTextSchema,
  publicReputation: richTextSchema,
  secrets: richTextSchema,
};
const LORE_SHAPE = {
  category: textField,
  summary: richTextSchema,
  fullDetails: richTextSchema,
  trueVsBelieved: richTextSchema,
};
const STORY_BEAT_SHAPE = {
  arcName: textField,
  order: z.int().min(0, 'Order cannot be negative'),
  summary: richTextSchema,
  trigger: richTextSchema,
  possibleOutcomes: richTextSchema,
  status: storyBeatStatusSchema,
};
const ITEM_SHAPE = {
  kind: textField,
  appearance: textField,
  effect: richTextSchema,
  value: textField,
  history: richTextSchema,
};
const SESSION_NOTES_SHAPE = {
  sessionNumber: z.int().min(1, 'Session numbers start at 1'),
  date: z.iso.date('Use a date like 2026-11-09'),
  gmRecap: richTextSchema,
  keyEvents: richTextSchema,
  openThreads: richTextSchema,
  prepForNextTime: richTextSchema,
};

export const npcFieldsSchema = z.strictObject(NPC_SHAPE).partial();
export type NpcFields = z.infer<typeof npcFieldsSchema>;
export const areaFieldsSchema = z.strictObject(AREA_SHAPE).partial();
export type AreaFields = z.infer<typeof areaFieldsSchema>;
export const spotFieldsSchema = z.strictObject(SPOT_SHAPE).partial();
export type SpotFields = z.infer<typeof spotFieldsSchema>;
export const factionFieldsSchema = z.strictObject(FACTION_SHAPE).partial();
export type FactionFields = z.infer<typeof factionFieldsSchema>;
export const loreFieldsSchema = z.strictObject(LORE_SHAPE).partial();
export type LoreFields = z.infer<typeof loreFieldsSchema>;
export const storyBeatFieldsSchema = z.strictObject(STORY_BEAT_SHAPE).partial();
export type StoryBeatFields = z.infer<typeof storyBeatFieldsSchema>;
export const itemFieldsSchema = z.strictObject(ITEM_SHAPE).partial();
export type ItemFields = z.infer<typeof itemFieldsSchema>;
export const sessionNotesFieldsSchema = z.strictObject(SESSION_NOTES_SHAPE).partial();
export type SessionNotesFields = z.infer<typeof sessionNotesFieldsSchema>;

/** The `fields` schema of each type, keeping each type's own inferred shape. */
export const recordFieldsSchemas = {
  npc: npcFieldsSchema,
  area: areaFieldsSchema,
  spot: spotFieldsSchema,
  faction: factionFieldsSchema,
  lore: loreFieldsSchema,
  story_beat: storyBeatFieldsSchema,
  item: itemFieldsSchema,
  session_notes: sessionNotesFieldsSchema,
} satisfies Record<RecordType, z.ZodType>;

/** The full `fields` schema of a type: every field optional, unknown keys rejected. */
export function fieldsSchemaFor(type: RecordType): z.ZodType<Record<string, unknown>> {
  return recordFieldsSchemas[type];
}

type PatchShape<T extends Record<string, z.ZodType>> = {
  [K in keyof T]: z.ZodOptional<z.ZodNullable<T[K]>>;
};

/** The same shape with every field optional and nullable: a PATCH where null clears a field. */
function patchOf<T extends Record<string, z.ZodType>>(shape: T) {
  // Object.fromEntries can't carry the key-to-schema mapping, hence the cast.
  const patched = Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, schema.nullable().optional()]),
  ) as PatchShape<T>;
  return z.strictObject(patched);
}

const fieldsPatchSchemas: Record<RecordType, z.ZodType<Record<string, unknown>>> = {
  npc: patchOf(NPC_SHAPE),
  area: patchOf(AREA_SHAPE),
  spot: patchOf(SPOT_SHAPE),
  faction: patchOf(FACTION_SHAPE),
  lore: patchOf(LORE_SHAPE),
  story_beat: patchOf(STORY_BEAT_SHAPE),
  item: patchOf(ITEM_SHAPE),
  session_notes: patchOf(SESSION_NOTES_SHAPE),
};

/** The partial-update schema of a type: a subset of its fields, where null clears one. */
export function fieldsPatchSchemaFor(type: RecordType): z.ZodType<Record<string, unknown>> {
  return fieldsPatchSchemas[type];
}

/**
 * Merges a validated patch (`fieldsPatchSchemaFor`) into stored fields: present keys
 * overwrite, null removes, absent keys are untouched. The result is checked against the
 * full schema, so stored fields always satisfy it.
 */
export function applyFieldsPatch(
  type: RecordType,
  stored: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  return fieldsSchemaFor(type).parse(
    Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null)),
  );
}

export type FieldKind = 'text' | 'rich' | 'enum' | 'number' | 'date' | 'list' | 'links';

/** How a value field (one stored in `fields`) is shown. */
export interface ValueFieldSpec {
  kind: Exclude<FieldKind, 'links'>;
  label: string;
  /** The choices of an `enum` field. */
  options?: readonly string[];
}

export type LinkCardinality = 'one' | 'many';

/**
 * A link field: `record_links` rows, not part of `fields` (D-24). The server refuses a
 * record of any other type, and more than one link on a `one` field.
 */
export interface LinkFieldSpec {
  kind: 'links';
  label: string;
  targets: readonly RecordType[];
  cardinality: LinkCardinality;
}

/** How a field is shown, and for link fields, what it may link to. */
export type FieldSpec = ValueFieldSpec | LinkFieldSpec;

/**
 * Every type's fields in display order (governance §8), including the link fields that
 * `record_links` holds (D-24). Key order is the display order. `satisfies` keeps each spec
 * in step with its shape: a field missing here, or misspelled, is a compile error.
 */
export const RECORD_FIELD_SPECS = {
  npc: {
    appearance: { kind: 'text', label: 'Appearance' },
    personality: { kind: 'rich', label: 'Personality' },
    voiceAndMannerisms: { kind: 'text', label: 'Voice and mannerisms' },
    wants: { kind: 'rich', label: 'Wants and motivations' },
    knowledge: { kind: 'rich', label: 'What they know' },
    secrets: { kind: 'rich', label: 'Secrets' },
    roleInStory: { kind: 'rich', label: 'Role in the story' },
    status: { kind: 'enum', label: 'Status', options: npcStatusSchema.options },
    homeSpot: { kind: 'links', label: 'Home spot', targets: ['spot'], cardinality: 'one' },
    factions: { kind: 'links', label: 'Factions', targets: ['faction'], cardinality: 'many' },
  } satisfies Record<keyof NpcFields | 'homeSpot' | 'factions', FieldSpec>,
  area: {
    kindOfPlace: { kind: 'text', label: 'Kind of place' },
    overview: { kind: 'rich', label: 'Overview' },
    atmosphere: { kind: 'rich', label: 'Atmosphere' },
    notableFeatures: { kind: 'rich', label: 'Notable features' },
    factionsPresent: {
      kind: 'links',
      label: 'Factions present',
      targets: ['faction'],
      cardinality: 'many',
    },
    hooks: { kind: 'rich', label: 'Hooks' },
    secrets: { kind: 'rich', label: 'Secrets' },
  } satisfies Record<keyof AreaFields | 'factionsPresent', FieldSpec>,
  spot: {
    readAloud: { kind: 'rich', label: 'Description to read out' },
    pointsOfInterest: { kind: 'list', label: 'Points of interest' },
    npcsHere: {
      kind: 'links',
      label: 'NPCs usually here',
      targets: ['npc'],
      cardinality: 'many',
    },
    itemsHere: { kind: 'links', label: 'Items here', targets: ['item'], cardinality: 'many' },
    hiddenDetails: { kind: 'rich', label: 'Hidden details' },
    backdropNotes: { kind: 'text', label: 'Backdrop notes' },
  } satisfies Record<keyof SpotFields | 'npcsHere' | 'itemsHere', FieldSpec>,
  faction: {
    goals: { kind: 'rich', label: 'Goals' },
    leaders: { kind: 'links', label: 'Leaders', targets: ['npc'], cardinality: 'many' },
    members: { kind: 'links', label: 'Members', targets: ['npc'], cardinality: 'many' },
    resources: { kind: 'rich', label: 'Resources' },
    alliesAndEnemies: {
      kind: 'links',
      label: 'Allies and enemies',
      targets: ['faction'],
      cardinality: 'many',
    },
    publicReputation: { kind: 'rich', label: 'Public reputation' },
    secrets: { kind: 'rich', label: 'Secrets' },
  } satisfies Record<keyof FactionFields | 'leaders' | 'members' | 'alliesAndEnemies', FieldSpec>,
  lore: {
    category: { kind: 'text', label: 'Category' },
    summary: { kind: 'rich', label: 'Summary' },
    fullDetails: { kind: 'rich', label: 'Full details' },
    whoKnowsIt: {
      kind: 'links',
      label: 'Who knows it',
      targets: ['npc', 'faction'],
      cardinality: 'many',
    },
    trueVsBelieved: { kind: 'rich', label: 'What is true vs. what people believe' },
  } satisfies Record<keyof LoreFields | 'whoKnowsIt', FieldSpec>,
  story_beat: {
    arcName: { kind: 'text', label: 'Arc name' },
    order: { kind: 'number', label: 'Order' },
    summary: { kind: 'rich', label: 'Summary' },
    trigger: { kind: 'rich', label: 'Trigger or conditions' },
    involved: {
      kind: 'links',
      label: 'NPCs, places and items involved',
      targets: ['npc', 'area', 'spot', 'item'],
      cardinality: 'many',
    },
    possibleOutcomes: { kind: 'rich', label: 'Possible outcomes' },
    status: { kind: 'enum', label: 'Status', options: storyBeatStatusSchema.options },
  } satisfies Record<keyof StoryBeatFields | 'involved', FieldSpec>,
  item: {
    kind: { kind: 'text', label: 'Kind' },
    appearance: { kind: 'text', label: 'Appearance' },
    effect: { kind: 'rich', label: 'What it does in play' },
    value: { kind: 'text', label: 'Value' },
    currentHolder: {
      kind: 'links',
      label: 'Current holder or location',
      targets: ['npc', 'spot', 'area'],
      cardinality: 'one',
    },
    history: { kind: 'rich', label: 'History' },
  } satisfies Record<keyof ItemFields | 'currentHolder', FieldSpec>,
  session_notes: {
    sessionNumber: { kind: 'number', label: 'Session number' },
    date: { kind: 'date', label: 'Date' },
    gmRecap: { kind: 'rich', label: 'GM recap' },
    keyEvents: { kind: 'rich', label: 'Key events' },
    npcsMet: { kind: 'links', label: 'NPCs met', targets: ['npc'], cardinality: 'many' },
    openThreads: { kind: 'rich', label: 'Open threads' },
    prepForNextTime: { kind: 'rich', label: 'Prep for next time' },
  } satisfies Record<keyof SessionNotesFields | 'npcsMet', FieldSpec>,
} satisfies Record<RecordType, Record<string, FieldSpec>>;
