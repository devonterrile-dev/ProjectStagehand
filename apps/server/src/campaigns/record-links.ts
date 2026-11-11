/**
 * Links between records (F1.5, D-24). Part of the campaign data-access layer: every query
 * is scoped to `scope.campaignId`, so a record id from another campaign is never found and
 * never linked.
 *
 * - Field links fill the §8 link fields. Each field accepts only its spec's record types,
 *   and `one` fields hold a single record (the request schema caps the count).
 * - Other links point at any record, with an optional relationship label.
 * - Mention links mirror the @-mentions in a record's text. Unknown ids are dropped, not
 *   refused, so deleting a record never makes the notes that mention it unsaveable.
 *
 * The write functions run inside the caller's transaction, after the source record has
 * been locked; callers check `assertGm` and `assertWritable`.
 */
import {
  emptyLinksFor,
  linkFieldSpec,
  linkTargetsLabel,
  type BacklinksResponse,
  type InventoryItem,
  type OtherLink,
  type OtherLinksInput,
  type RecordRef,
  type RecordType,
} from '@stagehand/shared';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';

import { characters, recordLinks, records } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

const LINKED_NOT_FOUND = 'Linked record not found';

/** The type of each id that is a record of this campaign; other ids are left out. */
async function recordTypesIn(
  tx: DbOrTx,
  scope: CampaignScope,
  ids: readonly string[],
): Promise<Map<string, RecordType>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: records.id, type: records.type })
    .from(records)
    .where(and(eq(records.campaignId, scope.campaignId), inArray(records.id, [...ids])));
  return new Map(rows.map((row) => [row.id, row.type]));
}

/** `from_record_id = fromId`, in this campaign, of one kind. */
function outgoing(scope: CampaignScope, fromId: string, kind: 'field' | 'other' | 'mention') {
  return and(
    eq(recordLinks.campaignId, scope.campaignId),
    eq(recordLinks.fromRecordId, fromId),
    eq(recordLinks.kind, kind),
  );
}

/** Rows of one kind (and field) that point anywhere but `keep`. */
function allBut(keep: readonly string[]) {
  return keep.length === 0 ? undefined : notInArray(recordLinks.toRecordId, [...keep]);
}

/**
 * Sets the link fields named in `links`, each to exactly the ids given (an empty list clears
 * it). Fields left out are untouched. A self link or a record of the wrong type is 400; an id
 * that isn't a record of this campaign is 404, and nothing is written.
 */
export async function setFieldLinks(
  tx: DbOrTx,
  scope: CampaignScope,
  from: { id: string; type: RecordType },
  links: Record<string, string[] | undefined>,
): Promise<void> {
  const fields = Object.entries(links).filter(
    (entry): entry is [string, string[]] => entry[1] !== undefined,
  );
  if (fields.length === 0) return;

  const types = await recordTypesIn(tx, scope, [...new Set(fields.flatMap(([, ids]) => ids))]);
  for (const [key, ids] of fields) {
    const spec = linkFieldSpec(from.type, key);
    if (spec === undefined) throw httpError(400, `Unknown link field ${key}`);
    for (const id of ids) {
      if (id === from.id) throw httpError(400, "A record can't link to itself");
      const type = types.get(id);
      if (type === undefined) throw httpError(404, LINKED_NOT_FOUND);
      if (!spec.targets.includes(type)) {
        throw httpError(400, `${spec.label} can only link ${linkTargetsLabel(spec.targets)}`);
      }
    }
  }

  for (const [key, ids] of fields) {
    await tx
      .delete(recordLinks)
      .where(and(outgoing(scope, from.id, 'field'), eq(recordLinks.fieldKey, key), allBut(ids)));
    if (ids.length === 0) continue;
    await tx
      .insert(recordLinks)
      .values(
        ids.map((toRecordId) => ({
          campaignId: scope.campaignId,
          fromRecordId: from.id,
          toRecordId,
          kind: 'field' as const,
          fieldKey: key,
        })),
      )
      .onConflictDoNothing();
  }
}

/**
 * Replaces the record's other links with `list`: new ones are added, labels updated, and
 * any left out removed. Any record type may be linked, but not the record itself.
 */
export async function setOtherLinks(
  tx: DbOrTx,
  scope: CampaignScope,
  fromId: string,
  list: OtherLinksInput,
): Promise<void> {
  const ids = list.map((link) => link.recordId);
  const types = await recordTypesIn(tx, scope, ids);
  for (const id of ids) {
    if (id === fromId) throw httpError(400, "A record can't link to itself");
    if (!types.has(id)) throw httpError(404, LINKED_NOT_FOUND);
  }

  await tx.delete(recordLinks).where(and(outgoing(scope, fromId, 'other'), allBut(ids)));
  if (list.length === 0) return;
  await tx
    .insert(recordLinks)
    .values(
      list.map((link) => ({
        campaignId: scope.campaignId,
        fromRecordId: fromId,
        toRecordId: link.recordId,
        kind: 'other' as const,
        label: link.label,
      })),
    )
    .onConflictDoUpdate({
      target: [recordLinks.fromRecordId, recordLinks.toRecordId],
      targetWhere: sql`${recordLinks.kind} = 'other'`,
      set: { label: sql`excluded.label` },
    });
}

/**
 * Makes the record's mention links match `ids`, the records its text mentions now. Ids that
 * aren't records of this campaign (deleted, from elsewhere, made up) and the record's own
 * id are dropped without an error (D-24).
 */
export async function syncMentions(
  tx: DbOrTx,
  scope: CampaignScope,
  fromId: string,
  ids: readonly string[],
): Promise<void> {
  const known = await recordTypesIn(
    tx,
    scope,
    ids.filter((id) => id !== fromId),
  );
  const keep = [...known.keys()];

  await tx.delete(recordLinks).where(and(outgoing(scope, fromId, 'mention'), allBut(keep)));
  if (keep.length === 0) return;
  await tx
    .insert(recordLinks)
    .values(
      keep.map((toRecordId) => ({
        campaignId: scope.campaignId,
        fromRecordId: fromId,
        toRecordId,
        kind: 'mention' as const,
      })),
    )
    .onConflictDoNothing();
}

/**
 * A record's field and other links, each list sorted by the target's name. Every link field
 * of the type is present, empty if nothing is linked.
 */
export async function outgoingLinksOf(
  db: DbOrTx,
  scope: CampaignScope,
  from: { id: string; type: RecordType },
): Promise<{ links: Record<string, RecordRef[]>; otherLinks: OtherLink[] }> {
  const rows = await db
    .select({
      kind: recordLinks.kind,
      fieldKey: recordLinks.fieldKey,
      label: recordLinks.label,
      id: records.id,
      type: records.type,
      name: records.name,
    })
    .from(recordLinks)
    .innerJoin(
      records,
      and(eq(records.id, recordLinks.toRecordId), eq(records.campaignId, recordLinks.campaignId)),
    )
    .where(
      and(
        eq(recordLinks.campaignId, scope.campaignId),
        eq(recordLinks.fromRecordId, from.id),
        inArray(recordLinks.kind, ['field', 'other']),
      ),
    )
    .orderBy(asc(sql`lower(${records.name})`), asc(records.createdAt));

  const links = emptyLinksFor(from.type);
  const otherLinks: OtherLink[] = [];
  for (const row of rows) {
    const record = { id: row.id, type: row.type, name: row.name };
    if (row.kind === 'other') otherLinks.push({ record, label: row.label });
    else if (row.fieldKey !== null) links[row.fieldKey]?.push(record);
  }
  return { links, otherLinks };
}

/** `inventory @> [{"recordId": itemId}]`: the PC carries a row linked to that Item. */
function carries(itemId: string) {
  return sql`${characters.inventory} @> jsonb_build_array(jsonb_build_object('recordId', ${itemId}::text))`;
}

/**
 * Everything that points at a record: field and other links, mentions, and for an Item the
 * PCs whose inventory links it. 404 unless it is a record of this campaign.
 */
export async function listBacklinks(
  db: DbOrTx,
  scope: CampaignScope,
  recordId: string,
): Promise<BacklinksResponse> {
  const [target] = await db
    .select({ type: records.type })
    .from(records)
    .where(and(eq(records.id, recordId), eq(records.campaignId, scope.campaignId)));
  if (target === undefined) throw httpError(404, 'Record not found');

  const rows = await db
    .select({
      kind: recordLinks.kind,
      fieldKey: recordLinks.fieldKey,
      label: recordLinks.label,
      id: records.id,
      type: records.type,
      name: records.name,
    })
    .from(recordLinks)
    .innerJoin(
      records,
      and(eq(records.id, recordLinks.fromRecordId), eq(records.campaignId, recordLinks.campaignId)),
    )
    .where(and(eq(recordLinks.campaignId, scope.campaignId), eq(recordLinks.toRecordId, recordId)))
    .orderBy(asc(sql`lower(${records.name})`), asc(records.createdAt), asc(recordLinks.fieldKey));

  const response: BacklinksResponse = { links: [], mentions: [], inventories: [] };
  for (const row of rows) {
    const record = { id: row.id, type: row.type, name: row.name };
    if (row.kind === 'mention') response.mentions.push(record);
    else response.links.push({ record, kind: row.kind, fieldKey: row.fieldKey, label: row.label });
  }

  if (target.type === 'item') {
    response.inventories = await db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(and(eq(characters.campaignId, scope.campaignId), carries(recordId)))
      .orderBy(asc(sql`lower(${characters.name})`), asc(characters.createdAt));
  }
  return response;
}

/** 404 unless every linked inventory row points at an Item record of this campaign. */
export async function requireInventoryItems(
  tx: DbOrTx,
  scope: CampaignScope,
  inventory: readonly InventoryItem[],
): Promise<void> {
  const ids = [
    ...new Set(inventory.flatMap((row) => (row.recordId === undefined ? [] : [row.recordId]))),
  ];
  const types = await recordTypesIn(tx, scope, ids);
  for (const id of ids) {
    if (types.get(id) !== 'item') throw httpError(404, 'Item not found');
  }
}

/**
 * Clears an Item from every PC inventory that links it, keeping the rows themselves (their
 * name and detail stay). Called when the Item is deleted.
 */
export async function unlinkInventoryItem(
  tx: DbOrTx,
  scope: CampaignScope,
  itemId: string,
): Promise<void> {
  const carriers = await tx
    .select({ id: characters.id, inventory: characters.inventory })
    .from(characters)
    .where(and(eq(characters.campaignId, scope.campaignId), carries(itemId)))
    .for('update');
  for (const carrier of carriers) {
    const inventory = carrier.inventory.map((row) => {
      return row.recordId === itemId ? { name: row.name, detail: row.detail } : row;
    });
    await tx
      .update(characters)
      .set({ inventory })
      .where(and(eq(characters.id, carrier.id), eq(characters.campaignId, scope.campaignId)));
  }
}
