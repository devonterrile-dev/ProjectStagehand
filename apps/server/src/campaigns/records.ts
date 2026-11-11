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
import {
  outgoingLinksOf,
  setFieldLinks,
  setOtherLinks,
  syncMentions,
  unlinkInventoryItem,
} from './record-links';
import type { CampaignScope } from './scope';
import { requireStatBlock } from './stat-blocks';

type RecordRow = typeof records.$inferSelect;

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

    if (input.links !== undefined) await setFieldLinks(tx, scope, row, input.links);
    if (input.otherLinks !== undefined) await setOtherLinks(tx, scope, row.id, input.otherLinks);
    await syncMentionsOf(tx, scope, row);
    return toRecord(tx, scope, row);
  });
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
      if (!linksChanged) return toRecord(tx, scope, current);
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
    return toRecord(tx, scope, row);
  });
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
