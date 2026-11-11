/**
 * Stat blocks for monsters and NPCs (F1.4, governance §8). Part of the campaign data-access
 * layer: every query is scoped to `scope.campaignId`. GM only.
 */
import {
  statBlockSchema,
  statBlockSummarySchema,
  type CreateStatBlockRequest,
  type StatBlock,
  type StatBlockSummary,
  type UpdateStatBlockRequest,
} from '@stagehand/shared';
import { and, asc, count, eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { records, statBlocks } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

type StatBlockRow = typeof statBlocks.$inferSelect;

const NOT_FOUND = 'Stat block not found';

/** `id = statBlockId and campaign_id = scope.campaignId`. */
function scoped(scope: CampaignScope, statBlockId: string) {
  return and(eq(statBlocks.id, statBlockId), eq(statBlocks.campaignId, scope.campaignId));
}

/** The NPC records of this campaign that link `statBlockId`. */
function linkedNpcs(scope: CampaignScope, statBlockId: string) {
  return and(eq(records.statBlockId, statBlockId), eq(records.campaignId, scope.campaignId));
}

async function toStatBlock(
  db: DbOrTx,
  scope: CampaignScope,
  row: StatBlockRow,
): Promise<StatBlock> {
  const usedBy = await db
    .select({ id: records.id, name: records.name })
    .from(records)
    .where(linkedNpcs(scope, row.id))
    .orderBy(asc(sql`lower(${records.name})`), asc(records.createdAt));

  return statBlockSchema.parse({
    id: row.id,
    name: row.name,
    tier: row.tier,
    role: row.role,
    publicDescription: row.publicDescription,
    difficulty: row.difficulty,
    attackModifier: row.attackModifier,
    standardAttack: row.standardAttack,
    experiences: row.experiences,
    motives: row.motives,
    features: row.features,
    majorThreshold: row.majorThreshold,
    severeThreshold: row.severeThreshold,
    hpMax: row.hpMax,
    stressMax: row.stressMax,
    usedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** 404 unless `statBlockId` is a stat block in this campaign. Used when an NPC links one. */
export async function requireStatBlock(
  db: DbOrTx,
  scope: CampaignScope,
  statBlockId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: statBlocks.id })
    .from(statBlocks)
    .where(scoped(scope, statBlockId));
  if (row === undefined) throw httpError(404, NOT_FOUND);
}

/** Every stat block in the campaign, by name, with how many NPCs link it. */
export async function listStatBlocks(
  db: Database,
  scope: CampaignScope,
): Promise<StatBlockSummary[]> {
  const rows = await db
    .select({
      id: statBlocks.id,
      name: statBlocks.name,
      tier: statBlocks.tier,
      role: statBlocks.role,
      usedByCount: count(records.id),
      updatedAt: statBlocks.updatedAt,
    })
    .from(statBlocks)
    .leftJoin(
      records,
      and(eq(records.statBlockId, statBlocks.id), eq(records.campaignId, statBlocks.campaignId)),
    )
    .where(eq(statBlocks.campaignId, scope.campaignId))
    .groupBy(statBlocks.id)
    .orderBy(asc(sql`lower(${statBlocks.name})`), asc(statBlocks.createdAt));

  return rows.map((row) =>
    statBlockSummarySchema.parse({ ...row, updatedAt: row.updatedAt.toISOString() }),
  );
}

export async function getStatBlock(
  db: Database,
  scope: CampaignScope,
  statBlockId: string,
): Promise<StatBlock> {
  const [row] = await db.select().from(statBlocks).where(scoped(scope, statBlockId));
  if (row === undefined) throw httpError(404, NOT_FOUND);
  return toStatBlock(db, scope, row);
}

/** Creates a stat block with defaults. Callers check `assertGm` and `assertWritable`. */
export async function createStatBlock(
  db: Database,
  scope: CampaignScope,
  request: CreateStatBlockRequest,
): Promise<StatBlock> {
  const [row] = await db
    .insert(statBlocks)
    .values({ campaignId: scope.campaignId, ...request })
    .returning();
  if (row === undefined) throw new Error('stat block insert returned no row');
  return toStatBlock(db, scope, row);
}

/**
 * Applies a partial update: each key sent replaces its whole value (D-23). Last write
 * wins. Callers check `assertGm` and `assertWritable`.
 */
export async function updateStatBlock(
  db: Database,
  scope: CampaignScope,
  statBlockId: string,
  patch: UpdateStatBlockRequest,
): Promise<StatBlock> {
  const [row] = await db
    .update(statBlocks)
    .set(patch)
    .where(scoped(scope, statBlockId))
    .returning();
  if (row === undefined) throw httpError(404, NOT_FOUND);
  return toStatBlock(db, scope, row);
}

/**
 * Deletes a stat block for good. NPCs that linked it keep everything else and just lose
 * the link (D-23). Callers check `assertGm` and `assertWritable`.
 */
export async function deleteStatBlock(
  db: Database,
  scope: CampaignScope,
  statBlockId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: statBlocks.id })
      .from(statBlocks)
      .where(scoped(scope, statBlockId))
      .for('update');
    if (current === undefined) throw httpError(404, NOT_FOUND);

    await tx.update(records).set({ statBlockId: null }).where(linkedNpcs(scope, statBlockId));
    await tx.delete(statBlocks).where(scoped(scope, statBlockId));
  });
}
