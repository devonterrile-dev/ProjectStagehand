/**
 * Links between records (F1.5, D-24). Every link is a `record_links` row of one of three
 * kinds:
 *
 * - `field`: fills one of the §8 link fields of `RECORD_FIELD_SPECS` (an NPC's home spot, a
 *   faction's leaders…). The spec says which record types it accepts and whether it holds
 *   one record or many.
 * - `other`: an extra link from any record to any other, with an optional relationship
 *   label typed by the GM ("rival of"). One per pair of records.
 * - `mention`: mirrors an @-mention in the record's rich text. The server re-syncs these on
 *   every save; they can't be written directly.
 *
 * Backlinks are the same rows read from the other end.
 */
import { z } from 'zod';

import {
  RECORD_FIELD_SPECS,
  RECORD_TYPE_LABELS,
  recordTypeSchema,
  type FieldSpec,
  type LinkFieldSpec,
  type RecordType,
} from './record-fields';
import { mentionIdsOf, type RichText } from './rich-text';

export const RECORD_LINK_KINDS = ['field', 'other', 'mention'] as const;
export const recordLinkKindSchema = z.enum(RECORD_LINK_KINDS);
export type RecordLinkKind = z.infer<typeof recordLinkKindSchema>;

/** Longest relationship label on an `other` link. The database enforces the same limit. */
export const LINK_LABEL_MAX = 60;
/** Most records one `many` link field can hold. */
export const LINKS_PER_FIELD_MAX = 100;
/** Most `other` links one record can have. */
export const OTHER_LINKS_MAX = 50;

/** The link fields of a type, in display order. */
export function linkFieldsOf(type: RecordType): [string, LinkFieldSpec][] {
  const specs: Record<string, FieldSpec> = RECORD_FIELD_SPECS[type];
  return Object.entries(specs).filter(
    (entry): entry is [string, LinkFieldSpec] => entry[1].kind === 'links',
  );
}

/** The spec of one link field, or undefined if the type has no such link field. */
export function linkFieldSpec(type: RecordType, key: string): LinkFieldSpec | undefined {
  const spec = (RECORD_FIELD_SPECS[type] as Record<string, FieldSpec | undefined>)[key];
  return spec?.kind === 'links' ? spec : undefined;
}

/** "Spots", "NPCs or Factions", "NPCs, Areas, Spots or Items". */
export function linkTargetsLabel(targets: readonly RecordType[]): string {
  const plurals = targets.map((type) =>
    type === 'session_notes' ? RECORD_TYPE_LABELS[type] : `${RECORD_TYPE_LABELS[type]}s`,
  );
  const last = plurals.pop() ?? '';
  return plurals.length === 0 ? last : `${plurals.join(', ')} or ${last}`;
}

/** Every link field of the type, each empty. */
export function emptyLinksFor(type: RecordType): Record<string, RecordRef[]> {
  return Object.fromEntries(linkFieldsOf(type).map(([key]) => [key, []]));
}

/** A pointer to a record of the same campaign, as links and backlinks show it. */
export const recordRefSchema = z.object({
  id: z.uuid(),
  type: recordTypeSchema,
  name: z.string(),
});
export type RecordRef = z.infer<typeof recordRefSchema>;

const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;

/** A relationship label: trimmed, 1–60 characters. Send null for none. */
export const linkLabelSchema = z
  .string()
  .trim()
  .min(1, 'Leave the relationship blank instead')
  .max(LINK_LABEL_MAX, `Relationships must be ${String(LINK_LABEL_MAX)} characters or fewer`);

function linkIdsSchema(spec: LinkFieldSpec) {
  const max = spec.cardinality === 'one' ? 1 : LINKS_PER_FIELD_MAX;
  return z
    .array(z.uuid('Links must be record ids'))
    .max(
      max,
      spec.cardinality === 'one'
        ? `${spec.label} holds one record`
        : `${spec.label} holds at most ${String(max)} records`,
    )
    .refine(uniqueIds, 'Each record can only be linked once');
}

/** One value per record type, built once. */
function perType<T>(make: (type: RecordType) => T): Record<RecordType, T> {
  const out = {} as Record<RecordType, T>;
  for (const type of recordTypeSchema.options) out[type] = make(type);
  return out;
}

const linksPatchSchemas = perType((type): z.ZodType<Record<string, string[] | undefined>> =>
  z.strictObject(
    Object.fromEntries(
      linkFieldsOf(type).map(([key, spec]) => [key, linkIdsSchema(spec).optional()]),
    ),
  ),
);

/**
 * The `links` of a record PATCH: any of the type's link fields, each sent as its whole list
 * of record ids (an empty list clears it). Types and existence are checked on the server.
 */
export function linksPatchSchemaFor(
  type: RecordType,
): z.ZodType<Record<string, string[] | undefined>> {
  return linksPatchSchemas[type];
}

/** The `otherLinks` of a record PATCH: the whole list, at most one entry per record. */
export const otherLinksSchema = z
  .array(
    z.strictObject({
      recordId: z.uuid('Links must be record ids'),
      label: linkLabelSchema.nullable(),
    }),
  )
  .max(OTHER_LINKS_MAX, `At most ${String(OTHER_LINKS_MAX)} other links`)
  .refine(
    (links) => uniqueIds(links.map((link) => link.recordId)),
    'Each record can only be linked once',
  );
export type OtherLinksInput = z.infer<typeof otherLinksSchema>;

const linksSchemas = perType((type): z.ZodType<Record<string, RecordRef[]>> =>
  z.strictObject(
    Object.fromEntries(linkFieldsOf(type).map(([key]) => [key, z.array(recordRefSchema)])),
  ),
);

/** A record's link fields as the API returns them: every key present, sorted by name. */
export function linksSchemaFor(type: RecordType): z.ZodType<Record<string, RecordRef[]>> {
  return linksSchemas[type];
}

/** One of a record's `other` links. */
export const otherLinkSchema = z.object({
  record: recordRefSchema,
  label: z.string().nullable(),
});
export type OtherLink = z.infer<typeof otherLinkSchema>;

/** A field or other link pointing at the record, seen from its source. */
export const backlinkSchema = z.object({
  record: recordRefSchema,
  kind: z.enum(['field', 'other']),
  /** The source's link field, for `field` links. */
  fieldKey: z.string().nullable(),
  /** The relationship label, for `other` links. */
  label: z.string().nullable(),
});
export type Backlink = z.infer<typeof backlinkSchema>;

/**
 * `GET /api/campaigns/:campaignId/records/:recordId/backlinks`. GM only. Everything that
 * points at the record, each list sorted by name: links, records whose text mentions it,
 * and (for Items) the PCs that carry it.
 */
export const backlinksResponseSchema = z.object({
  links: z.array(backlinkSchema),
  mentions: z.array(recordRefSchema),
  inventories: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type BacklinksResponse = z.infer<typeof backlinksResponseSchema>;

/**
 * The ids a record's text mentions, once each: its public description, GM notes and rich
 * fields. Values that aren't rich text (or are missing) are skipped.
 */
export function mentionIdsOfRecord(
  type: RecordType,
  record: {
    publicDescription?: RichText | null;
    gmNotes?: RichText | null;
    fields?: Record<string, unknown> | null;
  },
): string[] {
  const docs: (RichText | null | undefined)[] = [record.publicDescription, record.gmNotes];
  const specs: Record<string, FieldSpec> = RECORD_FIELD_SPECS[type];
  for (const [key, spec] of Object.entries(specs)) {
    if (spec.kind === 'rich') docs.push(record.fields?.[key] as RichText | null | undefined);
  }
  const ids = new Set<string>();
  for (const doc of docs) {
    if (doc) for (const id of mentionIdsOf(doc)) ids.add(id);
  }
  return [...ids];
}
