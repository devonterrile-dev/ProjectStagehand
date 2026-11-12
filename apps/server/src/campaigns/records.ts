/**
 * Narrative records (F1.3, governance §8). Part of the campaign data-access layer: every
 * query is scoped to `scope.campaignId`, so a record id from another campaign is never
 * found, and a Spot's Area must be an `area` record in the same campaign.
 *
 * A record comes with its outgoing links (F1.5, D-24), and every write that touches its
 * text re-syncs its mention links in the same transaction (`record-links.ts`).
 *
 * GM only for now: nothing here filters to the public layer. That arrives with the reveal
 * flow (F3.5).
 */
import {
  applyFieldsPatch,
  emptyRichText,
  mentionIdsOfRecord,
  hasTermPrefix,
  RECORD_SEARCH_TEXT_FIELDS,
  recordListItemSchema,
  recordSchema,
  richTextToPlainText,
  searchTerms,
  snippetAround,
  type CampaignRecord,
  type CreateRecordRequest,
  type RecordListItem,
  type RecordListQuery,
  type RecordMatch,
  type RecordSource,
  type RecordType,
  type RichText,
  type UpdateRecordRequest,
} from '@stagehand/shared';
import { and, arrayContains, asc, count, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { alias, type PgUpdateSetSource } from 'drizzle-orm/pg-core';

import type { Database } from '../db/client';
import { records } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import {
  outgoingLinksOf,
  setFieldLinks,
  setOtherLinks,
  syncMentions,
  unlinkInventoryItem,
} from './record-links';
import type { CampaignScope } from './scope';
import { requireStatBlock } from './stat-blocks';

export type RecordRow = typeof records.$inferSelect;

/**
 * Where a new record comes from, when it isn't typed in by the GM: an accepted AI import
 * proposal carries the id it was promised, so the import's other proposals can already point
 * at it (F1.8, §10 step 6).
 */
export interface RecordOrigin {
  id: string;
  source: RecordSource;
  aiImportId: string;
}

/** The API shape of a row, with its outgoing links read alongside. */
async function toRecord(db: DbOrTx, scope: CampaignScope, row: RecordRow): Promise<CampaignRecord> {
  const { links, otherLinks } = await outgoingLinksOf(db, scope, row);
  return recordSchema.parse({
    id: row.id,
    type: row.type,
    name: row.name,
    publicDescription: row.publicDescription,
    gmNotes: row.gmNotes,
    fields: row.fields,
    tags: row.tags,
    parentId: row.parentId,
    statBlockId: row.statBlockId,
    revealedAt: row.revealedAt?.toISOString() ?? null,
    source: row.source,
    links,
    otherLinks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Re-syncs the record's mention links from its stored text. */
async function syncMentionsOf(tx: DbOrTx, scope: CampaignScope, row: RecordRow): Promise<void> {
  await syncMentions(tx, scope, row.id, mentionIdsOfRecord(row.type, row));
}

/** `id = recordId and campaign_id = scope.campaignId`. */
function scoped(scope: CampaignScope, recordId: string) {
  return and(eq(records.id, recordId), eq(records.campaignId, scope.campaignId));
}

/** 404 unless `areaId` is an `area` record in this campaign. */
async function requireArea(tx: DbOrTx, scope: CampaignScope, areaId: string): Promise<void> {
  const [row] = await tx
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.id, areaId),
        eq(records.campaignId, scope.campaignId),
        eq(records.type, 'area'),
      ),
    );
  if (row === undefined) throw httpError(404, 'Area not found');
}

/** Escapes `%`, `_` and `\` for a LIKE pattern (backslash is Postgres's default escape). */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * The campaign's records as list items, narrowed by every filter given (see
 * `recordListQuerySchema`). Without `q` they are sorted by name. With `q` (D-25), a record
 * matches when its name contains the whole text, or when every search term starts a word of
 * its name, tags, public description or GM notes (`records.search_vector`). Matches are
 * sorted exact name, then name prefix, then name substring, then text rank, then name; each
 * carries an excerpt of the text that matched when the name and tags don't explain it.
 */
export async function listRecords(
  db: Database,
  scope: CampaignScope,
  filter: RecordListQuery = {},
): Promise<RecordListItem[]> {
  const parent = alias(records, 'parent');
  const q = filter.q;
  const terms = q === undefined ? [] : searchTerms(q);
  const tsquery =
    terms.length === 0
      ? null
      : sql`to_tsquery('simple', ${terms.map((t) => `'${t}':*`).join(' & ')})`;
  const nameLower = sql`lower(${records.name})`;

  let order: SQL[] = [asc(nameLower), asc(records.createdAt)];
  let searchCondition: SQL | undefined;
  if (q !== undefined) {
    const lowered = q.toLowerCase();
    const contains = sql`${records.name} ilike ${`%${likeLiteral(q)}%`}`;
    searchCondition = or(
      contains,
      tsquery === null ? undefined : sql`${records.searchVector} @@ ${tsquery}`,
    );
    order = [
      sql`case
        when ${nameLower} = ${lowered} then 0
        when ${records.name} ilike ${`${likeLiteral(q)}%`} then 1
        when ${contains} then 2
        else 3 end`,
      ...(tsquery === null ? [] : [desc(sql`ts_rank_cd(${records.searchVector}, ${tsquery})`)]),
      ...order,
    ];
  }

  const searchText = (column: typeof records.publicDescription | typeof records.gmNotes) =>
    q === undefined ? sql<RichText | null>`null` : sql<RichText | null>`${column}`;
  const query = db
    .select({
      id: records.id,
      type: records.type,
      name: records.name,
      tags: records.tags,
      parentId: records.parentId,
      parentName: parent.name,
      revealedAt: records.revealedAt,
      createdAt: records.createdAt,
      updatedAt: records.updatedAt,
      // Only a search needs the text, for the excerpt.
      publicDescription: searchText(records.publicDescription),
      gmNotes: searchText(records.gmNotes),
    })
    .from(records)
    .leftJoin(parent, eq(parent.id, records.parentId))
    .where(
      and(
        eq(records.campaignId, scope.campaignId),
        filter.type === undefined ? undefined : eq(records.type, filter.type),
        filter.tag === undefined || filter.tag.length === 0
          ? undefined
          : arrayContains(records.tags, filter.tag),
        filter.areaId === undefined ? undefined : eq(records.parentId, filter.areaId),
        searchCondition,
      ),
    )
    .orderBy(...order)
    .$dynamic();
  const rows = await (filter.limit === undefined ? query : query.limit(filter.limit));

  return rows.map(({ publicDescription, gmNotes, ...row }) =>
    recordListItemSchema.parse({
      ...row,
      revealedAt: row.revealedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      match: q === undefined ? null : matchOf(q, terms, row, { publicDescription, gmNotes }),
    }),
  );
}

/**
 * Where a search hit a record's text, for the excerpt in the list. Null when the name (or
 * its tags) already explains the hit: the name contains the whole query, or every term
 * starts a word of the name or a tag.
 */
function matchOf(
  q: string,
  terms: readonly string[],
  row: { name: string; tags: string[] },
  text: Record<RecordMatch['field'], RichText | null>,
): RecordMatch | null {
  if (row.name.toLowerCase().includes(q.toLowerCase())) return null;
  const label = [row.name, ...row.tags].join(' ');
  if (terms.every((term) => hasTermPrefix(label, [term]))) return null;
  for (const field of RECORD_SEARCH_TEXT_FIELDS) {
    const doc = text[field];
    if (doc === null) continue;
    const snippet = snippetAround(richTextToPlainText(doc), terms);
    if (snippet !== null) return { field, snippet };
  }
  return null;
}

/** One record with every field and its outgoing links. */
export async function getRecord(
  db: Database,
  scope: CampaignScope,
  recordId: string,
): Promise<CampaignRecord> {
  const [row] = await db.select().from(records).where(scoped(scope, recordId));
  if (row === undefined) throw httpError(404, 'Record not found');
  return toRecord(db, scope, row);
}

/** Just the record's type, for picking its PATCH schema. 404 if it isn't in this campaign. */
export async function recordTypeOf(
  db: Database,
  scope: CampaignScope,
  recordId: string,
): Promise<RecordType> {
  const [row] = await db
    .select({ type: records.type })
    .from(records)
    .where(scoped(scope, recordId));
  if (row === undefined) throw httpError(404, 'Record not found');
  return row.type;
}

/**
 * Creates a record typed in by the GM. A Spot's `parentId` must be an Area in this
 * campaign (the request schema makes sure only Spots carry one). Links given with it are
 * checked as in `updateRecord`. Callers check `assertGm` and `assertWritable`.
 */
export async function createRecord(
  db: Database,
  scope: CampaignScope,
  input: CreateRecordRequest,
): Promise<CampaignRecord> {
  return db.transaction(async (tx) => {
    const row = await insertRecordRow(tx, scope, input);
    await linkNewRecord(tx, scope, row, input);
    return toRecord(tx, scope, row);
  });
}

/**
 * The first half of creating a record: the row itself; `links` and `otherLinks` are left for
 * `linkNewRecord`, so an AI import can insert every record it creates before linking any of
 * them to each other. Runs in the caller's transaction.
 */
export async function insertRecordRow(
  tx: DbOrTx,
  scope: CampaignScope,
  input: CreateRecordRequest,
  origin?: RecordOrigin,
): Promise<RecordRow> {
  const parentId = input.type === 'spot' ? input.parentId : null;
  if (parentId !== null) await requireArea(tx, scope, parentId);

  const [row] = await tx
    .insert(records)
    .values({
      ...(origin === undefined
        ? {}
        : { id: origin.id, source: origin.source, aiImportId: origin.aiImportId }),
      campaignId: scope.campaignId,
      type: input.type,
      name: input.name,
      publicDescription: input.publicDescription ?? emptyRichText(),
      gmNotes: input.gmNotes ?? emptyRichText(),
      fields: input.fields ?? {},
      tags: input.tags ?? [],
      parentId,
    })
    .returning();
  if (row === undefined) throw new Error('record insert returned no row');
  return row;
}

/** The second half: the new record's link fields, other links and mention links. */
export async function linkNewRecord(
  tx: DbOrTx,
  scope: CampaignScope,
  row: RecordRow,
  input: Pick<CreateRecordRequest, 'links' | 'otherLinks'>,
): Promise<void> {
  if (input.links !== undefined) await setFieldLinks(tx, scope, row, input.links);
  if (input.otherLinks !== undefined) await setOtherLinks(tx, scope, row.id, input.otherLinks);
  await syncMentionsOf(tx, scope, row);
}

/**
 * Applies a partial update. `patch.fields` must already have passed
 * `updateRecordRequestSchemaFor(record.type)`; it is merged into the stored fields, where
 * null clears a field (D-22). Only Spots have a parent, and it must stay an Area in this
 * campaign; only NPCs link a stat block, one of this campaign's (F1.4). `links` replaces
 * each link field it names and `otherLinks` the whole list of other links (D-24); a change
 * to the text re-syncs the mention links. Last write wins. Callers check `assertGm` and
 * `assertWritable`.
 *
 * The row is locked FOR NO KEY UPDATE, not FOR UPDATE: inserting a link takes a KEY SHARE
 * lock on its target, so two records linking each other at once would otherwise deadlock.
 */
export async function updateRecord(
  db: Database,
  scope: CampaignScope,
  recordId: string,
  patch: UpdateRecordRequest,
): Promise<CampaignRecord> {
  return db.transaction(async (tx) => {
    const row = await updateRecordRow(tx, scope, recordId, patch);
    return toRecord(tx, scope, row);
  });
}

/** `updateRecord` inside the caller's transaction, returning the stored row. */
export async function updateRecordRow(
  tx: DbOrTx,
  scope: CampaignScope,
  recordId: string,
  patch: UpdateRecordRequest,
): Promise<RecordRow> {
  {
    const [current] = await tx
      .select()
      .from(records)
      .where(scoped(scope, recordId))
      .for('no key update');
    if (current === undefined) throw httpError(404, 'Record not found');

    const values: PgUpdateSetSource<typeof records> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.publicDescription !== undefined) values.publicDescription = patch.publicDescription;
    if (patch.gmNotes !== undefined) values.gmNotes = patch.gmNotes;
    if (patch.tags !== undefined) values.tags = patch.tags;
    if (patch.fields !== undefined) {
      values.fields = applyFieldsPatch(current.type, current.fields, patch.fields);
    }
    if (patch.parentId !== undefined) {
      if (current.type !== 'spot') {
        if (patch.parentId !== null) throw httpError(400, 'Only spots have a parent');
      } else if (patch.parentId === null) {
        throw httpError(400, 'A spot needs an area');
      } else {
        await requireArea(tx, scope, patch.parentId);
        values.parentId = patch.parentId;
      }
    }
    if (patch.statBlockId !== undefined) {
      if (patch.statBlockId !== null) {
        if (current.type !== 'npc') throw httpError(400, 'Only NPCs have a stat block');
        await requireStatBlock(tx, scope, patch.statBlockId);
      }
      values.statBlockId = patch.statBlockId;
    }
    const linksChanged = patch.links !== undefined || patch.otherLinks !== undefined;
    if (Object.keys(values).length === 0) {
      if (!linksChanged) return current;
      // A change to links alone still counts as an edit of the record.
      values.updatedAt = new Date();
    }

    const [row] = await tx.update(records).set(values).where(scoped(scope, recordId)).returning();
    if (row === undefined) throw httpError(404, 'Record not found');

    if (patch.links !== undefined) await setFieldLinks(tx, scope, row, patch.links);
    if (patch.otherLinks !== undefined) await setOtherLinks(tx, scope, row.id, patch.otherLinks);
    const textChanged =
      patch.publicDescription !== undefined ||
      patch.gmNotes !== undefined ||
      patch.fields !== undefined;
    if (textChanged) await syncMentionsOf(tx, scope, row);
    return row;
  }
}

/**
 * Deletes a record for good. An Area that still has Spots is refused with 409, so nothing
 * disappears by accident. Every link to and from it goes too (the foreign keys cascade),
 * and an Item is cleared from PC inventories. Mentions of it stay in other records' text
 * and show as plain text (D-24). Callers check `assertGm` and `assertWritable`.
 */
export async function deleteRecord(
  db: Database,
  scope: CampaignScope,
  recordId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ type: records.type })
      .from(records)
      .where(scoped(scope, recordId))
      .for('update');
    if (current === undefined) throw httpError(404, 'Record not found');

    if (current.type === 'area') {
      const [spots] = await tx
        .select({ n: count() })
        .from(records)
        .where(and(eq(records.parentId, recordId), eq(records.campaignId, scope.campaignId)));
      if ((spots?.n ?? 0) > 0) {
        throw httpError(409, 'This area still has spots. Move or delete them first.');
      }
    }
    if (current.type === 'item') await unlinkInventoryItem(tx, scope, recordId);

    await tx.delete(records).where(scoped(scope, recordId));
  });
}
