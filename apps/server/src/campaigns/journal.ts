/**
 * The player journal's records (F3.5, governance §7): what any member may read of a revealed
 * record, and nothing more. Part of the campaign data-access layer.
 *
 * Every response is written out field by field from the public layer (name, public description,
 * the image in use), so a private column can't reach a player because it happened to be on a
 * row. A record that isn't revealed is answered as if it didn't exist, and a mention in its text
 * keeps its link only when the record it points at is revealed too (§7 rule 4).
 */
import {
  journalRecordSchema,
  journalRecordSummarySchema,
  mentionIdsOf,
  searchTerms,
  withMentionsOnly,
  type JournalRecord,
  type JournalRecordListQuery,
  type JournalRecordSummary,
  type StageImage,
} from '@stagehand/shared';
import { and, asc, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { records } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import { likeLiteral } from './records';
import type { CampaignScope } from './scope';
import { stageImagesOf } from './visuals';

export const RECORD_NOT_FOUND = 'Record not found';

/** This campaign's revealed records. */
function revealedIn(scope: CampaignScope, table: typeof records = records) {
  return and(eq(table.campaignId, scope.campaignId), isNotNull(table.revealedAt));
}

/**
 * The campaign's revealed records, by name, or with `q` by how well they match: the whole text
 * in the name, or every term starting a word of the name or public description.
 */
export async function listJournalRecords(
  db: DbOrTx,
  scope: CampaignScope,
  filter: JournalRecordListQuery = {},
): Promise<JournalRecordSummary[]> {
  const parent = alias(records, 'parent');
  const { q } = filter;
  const terms = q === undefined ? [] : searchTerms(q);
  const tsquery =
    terms.length === 0
      ? null
      : sql`to_tsquery('simple', ${terms.map((t) => `'${t}':*`).join(' & ')})`;
  const nameLower = sql`lower(${records.name})`;

  let order: SQL[] = [asc(nameLower), asc(records.createdAt)];
  let searchCondition: SQL | undefined;
  if (q !== undefined) {
    const contains = sql`${records.name} ilike ${`%${likeLiteral(q)}%`}`;
    searchCondition = or(
      contains,
      tsquery === null ? undefined : sql`${records.publicSearchVector} @@ ${tsquery}`,
    );
    order = [
      sql`case
        when ${nameLower} = ${q.toLowerCase()} then 0
        when ${records.name} ilike ${`${likeLiteral(q)}%`} then 1
        when ${contains} then 2
        else 3 end`,
      ...(tsquery === null
        ? []
        : [desc(sql`ts_rank_cd(${records.publicSearchVector}, ${tsquery})`)]),
      ...order,
    ];
  }

  const rows = await db
    .select({
      id: records.id,
      type: records.type,
      name: records.name,
      revealedAt: records.revealedAt,
      // A Spot's Area is named only when players have that Area too.
      parentName: sql<
        string | null
      >`case when ${parent.revealedAt} is not null then ${parent.name} end`,
    })
    .from(records)
    .leftJoin(
      parent,
      and(eq(parent.id, records.parentId), eq(parent.campaignId, records.campaignId)),
    )
    .where(
      and(
        revealedIn(scope),
        filter.type === undefined ? undefined : eq(records.type, filter.type),
        searchCondition,
      ),
    )
    .orderBy(...order);

  return rows.map((row) =>
    journalRecordSummarySchema.parse({
      id: row.id,
      type: row.type,
      name: row.name,
      parentName: row.parentName,
      revealedAt: row.revealedAt?.toISOString(),
    }),
  );
}

/** One revealed record's public layer. 404 when it isn't revealed, or isn't this campaign's. */
export async function getJournalRecord(
  db: DbOrTx,
  scope: CampaignScope,
  recordId: string,
): Promise<JournalRecord> {
  const parent = alias(records, 'parent');
  const [row] = await db
    .select({
      id: records.id,
      type: records.type,
      name: records.name,
      publicDescription: records.publicDescription,
      visualAssetId: records.visualAssetId,
      revealedAt: records.revealedAt,
      parentName: sql<
        string | null
      >`case when ${parent.revealedAt} is not null then ${parent.name} end`,
    })
    .from(records)
    .leftJoin(
      parent,
      and(eq(parent.id, records.parentId), eq(parent.campaignId, records.campaignId)),
    )
    .where(and(revealedIn(scope), eq(records.id, recordId)));
  if (row === undefined) throw httpError(404, RECORD_NOT_FOUND);

  const mentioned = mentionIdsOf(row.publicDescription);
  const shown =
    mentioned.length === 0
      ? []
      : await db
          .select({ id: records.id })
          .from(records)
          .where(and(revealedIn(scope), inArray(records.id, mentioned)));
  const images =
    row.visualAssetId === null
      ? new Map<string, StageImage>()
      : await stageImagesOf(db, scope, [row.visualAssetId]);

  return journalRecordSchema.parse({
    id: row.id,
    type: row.type,
    name: row.name,
    publicDescription: withMentionsOnly(
      row.publicDescription,
      new Set(shown.map((record) => record.id)),
    ),
    image: row.visualAssetId === null ? null : (images.get(row.visualAssetId) ?? null),
    parentName: row.parentName,
    revealedAt: row.revealedAt?.toISOString(),
  });
}

/** 404 unless the record is revealed in this campaign: notes go only on what players have. */
export async function requireRevealedRecord(
  db: DbOrTx,
  scope: CampaignScope,
  recordId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: records.id })
    .from(records)
    .where(and(revealedIn(scope), eq(records.id, recordId)));
  if (row === undefined) throw httpError(404, RECORD_NOT_FOUND);
}

/** Whether the asset is the image in use of one of the campaign's revealed records. */
export async function isRevealedRecordImage(
  db: DbOrTx,
  scope: CampaignScope,
  assetId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: records.id })
    .from(records)
    .where(and(revealedIn(scope), eq(records.visualAssetId, assetId)))
    .limit(1);
  return row !== undefined;
}
