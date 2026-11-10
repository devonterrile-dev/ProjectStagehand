/**
 * Narrative records (F1.3, governance §8). Part of the campaign data-access layer: every
 * query is scoped to `scope.campaignId`, so a record id from another campaign is never
 * found, and a Spot's Area must be an `area` record in the same campaign.
 *
 * GM only for now: nothing here filters to the public layer. That arrives with the reveal
 * flow (F3.5).
 */
import {
  applyFieldsPatch,
  emptyRichText,
  recordSchema,
  recordSummarySchema,
  type CampaignRecord,
  type CreateRecordRequest,
  type RecordSummary,
  type RecordType,
  type UpdateRecordRequest,
} from '@stagehand/shared';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { alias, type PgUpdateSetSource } from 'drizzle-orm/pg-core';

import type { Database } from '../db/client';
import { records } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

type RecordRow = typeof records.$inferSelect;

function toRecord(row: RecordRow): CampaignRecord {
  return recordSchema.parse({
    id: row.id,
    type: row.type,
    name: row.name,
    publicDescription: row.publicDescription,
    gmNotes: row.gmNotes,
    fields: row.fields,
    tags: row.tags,
    parentId: row.parentId,
    revealedAt: row.revealedAt?.toISOString() ?? null,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
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

/** Summaries of the campaign's records, optionally of one type, by name. */
export async function listRecords(
  db: Database,
  scope: CampaignScope,
  filter: { type?: RecordType } = {},
): Promise<RecordSummary[]> {
  const parent = alias(records, 'parent');
  const rows = await db
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
    })
    .from(records)
    .leftJoin(parent, eq(parent.id, records.parentId))
    .where(
      and(
        eq(records.campaignId, scope.campaignId),
        filter.type === undefined ? undefined : eq(records.type, filter.type),
      ),
    )
    .orderBy(asc(sql`lower(${records.name})`), asc(records.createdAt));

  return rows.map((row) =>
    recordSummarySchema.parse({
      ...row,
      revealedAt: row.revealedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

/** One record with every field. */
export async function getRecord(
  db: Database,
  scope: CampaignScope,
  recordId: string,
): Promise<CampaignRecord> {
  const [row] = await db.select().from(records).where(scoped(scope, recordId));
  if (row === undefined) throw httpError(404, 'Record not found');
  return toRecord(row);
}

/**
 * Creates a record typed in by the GM. A Spot's `parentId` must be an Area in this
 * campaign (the request schema makes sure only Spots carry one). Callers check `assertGm`
 * and `assertWritable`.
 */
export async function createRecord(
  db: Database,
  scope: CampaignScope,
  input: CreateRecordRequest,
): Promise<CampaignRecord> {
  return db.transaction(async (tx) => {
    const parentId = input.type === 'spot' ? input.parentId : null;
    if (parentId !== null) await requireArea(tx, scope, parentId);

    const [row] = await tx
      .insert(records)
      .values({
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
    return toRecord(row);
  });
}

/**
 * Applies a partial update. `patch.fields` must already have passed
 * `updateRecordRequestSchemaFor(record.type)`; it is merged into the stored fields, where
 * null clears a field (D-22). Only Spots have a parent, and it must stay an Area in this
 * campaign. Last write wins. Callers check `assertGm` and `assertWritable`.
 */
export async function updateRecord(
  db: Database,
  scope: CampaignScope,
  recordId: string,
  patch: UpdateRecordRequest,
): Promise<CampaignRecord> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(records).where(scoped(scope, recordId)).for('update');
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
    if (Object.keys(values).length === 0) return toRecord(current);

    const [row] = await tx.update(records).set(values).where(scoped(scope, recordId)).returning();
    if (row === undefined) throw httpError(404, 'Record not found');
    return toRecord(row);
  });
}

/**
 * Deletes a record for good. An Area that still has Spots is refused with 409, so nothing
 * disappears by accident. Callers check `assertGm` and `assertWritable`.
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

    await tx.delete(records).where(scoped(scope, recordId));
  });
}
