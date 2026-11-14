/**
 * Narrative records (F1.3, governance §8): one entity for all eight types, with `fields`
 * typed per type. GM only until the reveal flow (F3.5) adds the player view.
 */
import { z } from 'zod';

import {
  areaFieldsSchema,
  factionFieldsSchema,
  fieldsPatchSchemaFor,
  itemFieldsSchema,
  loreFieldsSchema,
  npcFieldsSchema,
  recordTypeSchema,
  sessionNotesFieldsSchema,
  propFieldsSchema,
  spotFieldsSchema,
  storyBeatFieldsSchema,
  type RecordType,
} from './record-fields';
import {
  linksPatchSchemaFor,
  linksSchemaFor,
  otherLinkSchema,
  otherLinksSchema,
} from './record-links';
import { SEARCH_QUERY_MAX } from './record-search';
import { recordRichTextSchema } from './rich-text';

/** Longest record name allowed. The database enforces the same limit. */
export const RECORD_NAME_MAX = 120;

/** A record's name: trimmed, 1–120 characters. The one required field. */
export const recordNameSchema = z
  .string()
  .trim()
  .min(1, 'Record name cannot be empty')
  .max(RECORD_NAME_MAX, `Record name must be ${String(RECORD_NAME_MAX)} characters or fewer`);

export const TAG_MAX = 40;
export const TAGS_MAX = 20;

export const tagSchema = z
  .string()
  .trim()
  .min(1, 'Tags cannot be empty')
  .max(TAG_MAX, `Tags must be ${String(TAG_MAX)} characters or fewer`);

/** Free tags for filtering: at most 20, each unique. */
export const tagsSchema = z
  .array(tagSchema)
  .max(TAGS_MAX, `At most ${String(TAGS_MAX)} tags`)
  .refine((tags) => new Set(tags).size === tags.length, 'Tags must be unique');

/** Where a record came from: typed in by the GM, or accepted from an AI import (F1.8). */
export const RECORD_SOURCES = ['manual', 'ai_import'] as const;
export const recordSourceSchema = z.enum(RECORD_SOURCES);
export type RecordSource = z.infer<typeof recordSourceSchema>;

const timestamp = z.iso.datetime({ offset: true });

const recordBase = {
  id: z.uuid(),
  name: z.string(),
  /** Public layer: what players see once the record is revealed. */
  publicDescription: recordRichTextSchema,
  /** Private: free-form GM notes. */
  gmNotes: recordRichTextSchema,
  tags: z.array(z.string()),
  /** The Area a Spot belongs to (D-15). Null for every other type. */
  parentId: z.uuid().nullable(),
  /** The stat block an NPC fights with (F1.4). Null for every other type. */
  statBlockId: z.uuid().nullable(),
  /** Null = hidden from players. Set by the reveal flow (F3.5). */
  revealedAt: timestamp.nullable(),
  source: recordSourceSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function recordVariant<T extends RecordType, F extends z.ZodType>(type: T, fields: F) {
  return z.object({
    ...recordBase,
    type: z.literal(type),
    fields,
    /** The type's link fields (D-24): every key present, each list sorted by name. */
    links: linksSchemaFor(type),
    /** Extra links with an optional relationship label, sorted by name. */
    otherLinks: z.array(otherLinkSchema),
  });
}

/** A full record, as the GM sees it. `fields` is typed by `type`. */
export const recordSchema = z.discriminatedUnion('type', [
  recordVariant('npc', npcFieldsSchema),
  recordVariant('area', areaFieldsSchema),
  recordVariant('spot', spotFieldsSchema),
  recordVariant('prop', propFieldsSchema),
  recordVariant('faction', factionFieldsSchema),
  recordVariant('lore', loreFieldsSchema),
  recordVariant('story_beat', storyBeatFieldsSchema),
  recordVariant('item', itemFieldsSchema),
  recordVariant('session_notes', sessionNotesFieldsSchema),
]);
/** Named `CampaignRecord` because `Record` would shadow TypeScript's own `Record<K, V>`. */
export type CampaignRecord = z.infer<typeof recordSchema>;

/** A record in a list: no rich text and no `fields`. */
export const recordSummarySchema = z.object({
  id: z.uuid(),
  type: recordTypeSchema,
  name: z.string(),
  tags: z.array(z.string()),
  parentId: z.uuid().nullable(),
  /** The Area's name, for Spots. */
  parentName: z.string().nullable(),
  revealedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type RecordSummary = z.infer<typeof recordSummarySchema>;

/** The rich text fields a search looks through, besides the name and tags (D-25). */
export const RECORD_SEARCH_TEXT_FIELDS = ['publicDescription', 'gmNotes'] as const;

/** Where a search matched a record's text, with an excerpt around the first matching word. */
export const recordMatchSchema = z.object({
  field: z.enum(RECORD_SEARCH_TEXT_FIELDS),
  snippet: z.string(),
});
export type RecordMatch = z.infer<typeof recordMatchSchema>;

/**
 * A record in a list. `match` is set only by a search (`q`) whose words aren't all in the
 * name or tags, so the GM can see why the record was found.
 */
export const recordListItemSchema = recordSummarySchema.extend({
  match: recordMatchSchema.nullable(),
});
export type RecordListItem = z.infer<typeof recordListItemSchema>;

/**
 * `GET /api/campaigns/:campaignId/records`. GM only. Sorted by name, or with `q` by how well
 * each record matches (D-25).
 */
export const recordListResponseSchema = z.object({ records: z.array(recordListItemSchema) });
export type RecordListResponse = z.infer<typeof recordListResponseSchema>;

/** Most records one list call returns when it asks for a `limit`. */
export const RECORD_LIST_LIMIT_MAX = 100;

/**
 * The query string of the list route. Every filter narrows the list:
 * - `type`: one record type.
 * - `q`: search text (D-25). Every word must start a word in the record's name, tags,
 *   public description or GM notes, or the whole text must appear in the name. Blank = no search.
 * - `tag`: repeatable; the record must have every tag given.
 * - `areaId`: only the Spots in that Area.
 * - `limit`: at most this many records.
 */
export const recordListQuerySchema = z.object({
  type: recordTypeSchema.optional(),
  q: z
    .string()
    .trim()
    .max(SEARCH_QUERY_MAX, `Search must be ${String(SEARCH_QUERY_MAX)} characters or fewer`)
    .transform((q) => (q === '' ? undefined : q))
    .optional(),
  tag: z
    .union([
      tagSchema.transform((tag) => [tag]),
      z.array(tagSchema).max(TAGS_MAX, `At most ${String(TAGS_MAX)} tags`),
    ])
    .optional(),
  areaId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(RECORD_LIST_LIMIT_MAX).optional(),
});
export type RecordListQuery = z.infer<typeof recordListQuerySchema>;

const createBase = {
  name: recordNameSchema,
  publicDescription: recordRichTextSchema.optional(),
  gmNotes: recordRichTextSchema.optional(),
  tags: tagsSchema.optional(),
  otherLinks: otherLinksSchema.optional(),
};

function createVariant<T extends Exclude<RecordType, 'spot'>, F extends z.ZodType>(
  type: T,
  fields: F,
) {
  return z.strictObject({
    ...createBase,
    type: z.literal(type),
    fields: fields.optional(),
    links: linksPatchSchemaFor(type).optional(),
    parentId: z.null().optional(),
  });
}

/**
 * `POST /api/campaigns/:campaignId/records`. GM only; refused while archived. A Spot needs
 * its Area's id as `parentId`; no other type may have one. `links` and `otherLinks` are
 * optional, as in PATCH (the workshop UI adds links after creating; AI import sends them).
 */
export const createRecordRequestSchema = z.discriminatedUnion('type', [
  createVariant('npc', npcFieldsSchema),
  createVariant('area', areaFieldsSchema),
  z.strictObject({
    ...createBase,
    type: z.literal('spot'),
    fields: spotFieldsSchema.optional(),
    links: linksPatchSchemaFor('spot').optional(),
    parentId: z.uuid('A spot needs an area'),
  }),
  createVariant('prop', propFieldsSchema),
  createVariant('faction', factionFieldsSchema),
  createVariant('lore', loreFieldsSchema),
  createVariant('story_beat', storyBeatFieldsSchema),
  createVariant('item', itemFieldsSchema),
  createVariant('session_notes', sessionNotesFieldsSchema),
]);
export type CreateRecordRequest = z.infer<typeof createRecordRequestSchema>;

const updateBase = {
  name: recordNameSchema.optional(),
  publicDescription: recordRichTextSchema.optional(),
  gmNotes: recordRichTextSchema.optional(),
  tags: tagsSchema.optional(),
  /** The whole list of `other` links (D-24); entries left out are removed. */
  otherLinks: otherLinksSchema.optional(),
  /** Spots only: move to another Area. */
  parentId: z.uuid().nullable().optional(),
  /** NPCs only: link a stat block of the same campaign, or null to unlink. */
  statBlockId: z.uuid().nullable().optional(),
};
const hasKeys = (patch: object) => Object.keys(patch).length > 0;

/**
 * `PATCH /api/campaigns/:campaignId/records/:recordId`. GM only; refused while archived.
 * Any subset of the keys; `fields` is a partial of the record's type, merged on the server,
 * where null clears a field (D-22). `links` sends any of the type's link fields, each as its
 * whole list of record ids (D-24). The server validates `fields` and `links` with
 * `updateRecordRequestSchemaFor(record.type)`; `type` itself can't change.
 */
export const updateRecordRequestSchema = z
  .strictObject({
    ...updateBase,
    fields: z.record(z.string(), z.unknown()).optional(),
    links: z.record(z.string(), z.array(z.string()).optional()).optional(),
  })
  .refine(hasKeys, 'Nothing to update');
export type UpdateRecordRequest = z.infer<typeof updateRecordRequestSchema>;

function typedUpdateSchema(type: RecordType): z.ZodType<UpdateRecordRequest> {
  return z
    .strictObject({
      ...updateBase,
      fields: fieldsPatchSchemaFor(type).optional(),
      links: linksPatchSchemaFor(type).optional(),
    })
    .refine(hasKeys, 'Nothing to update');
}

const updateSchemas: Record<RecordType, z.ZodType<UpdateRecordRequest>> = {
  npc: typedUpdateSchema('npc'),
  area: typedUpdateSchema('area'),
  spot: typedUpdateSchema('spot'),
  prop: typedUpdateSchema('prop'),
  faction: typedUpdateSchema('faction'),
  lore: typedUpdateSchema('lore'),
  story_beat: typedUpdateSchema('story_beat'),
  item: typedUpdateSchema('item'),
  session_notes: typedUpdateSchema('session_notes'),
};

/** The PATCH schema with `fields` and `links` checked against one type. */
export function updateRecordRequestSchemaFor(type: RecordType): z.ZodType<UpdateRecordRequest> {
  return updateSchemas[type];
}
