/**
 * Campaign data-access layer (governance §7, §14). The only module that queries the
 * campaign tables, so isolation lives in one place:
 *
 * - Lists only return campaigns the user is a member of.
 * - Reading or changing one campaign starts from `loadCampaignScope`, which returns null
 *   for non-members. Write functions take that scope, not a bare id, so an unscoped write
 *   can't be expressed.
 * - `assertGm` / `assertWritable` are the role and archive checks every write route makes.
 */
import { campaignSchema, type Campaign, type CampaignRole } from '@stagehand/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import type { Database } from '../db/client';
import { campaignMembers, campaigns } from '../db/schema';
import { httpError } from '../http/errors';

type CampaignRow = typeof campaigns.$inferSelect;

/** One user's verified membership of one campaign. */
export interface CampaignScope {
  readonly userId: string;
  readonly campaignId: string;
  readonly role: CampaignRole;
  readonly campaign: CampaignRow;
}

/** A campaign as `userId` sees it, in the shared response shape. */
export function toCampaign(row: CampaignRow, role: CampaignRole): Campaign {
  return campaignSchema.parse({
    id: row.id,
    name: row.name,
    role,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Every campaign the user belongs to (as GM or player), active and archived, by name. */
export async function listCampaignsForUser(db: Database, userId: string): Promise<Campaign[]> {
  const rows = await db
    .select({ campaign: campaigns, role: campaignMembers.role })
    .from(campaignMembers)
    .innerJoin(campaigns, eq(campaigns.id, campaignMembers.campaignId))
    .where(eq(campaignMembers.userId, userId))
    .orderBy(asc(sql`lower(${campaigns.name})`), asc(campaigns.createdAt));

  return rows.map((row) => toCampaign(row.campaign, row.role));
}

/** Creates a campaign with `userId` as its GM: the campaign row and GM membership together. */
export async function createCampaign(
  db: Database,
  userId: string,
  name: string,
): Promise<Campaign> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(campaigns).values({ name, gmUserId: userId }).returning();
    if (row === undefined) throw new Error('campaign insert returned no row');
    await tx.insert(campaignMembers).values({ campaignId: row.id, userId, role: 'gm' });
    return toCampaign(row, 'gm');
  });
}

/** The user's membership of the campaign, or null if they aren't a member (or it doesn't exist). */
export async function loadCampaignScope(
  db: Database,
  userId: string,
  campaignId: string,
): Promise<CampaignScope | null> {
  const [row] = await db
    .select({ campaign: campaigns, role: campaignMembers.role })
    .from(campaignMembers)
    .innerJoin(campaigns, eq(campaigns.id, campaignMembers.campaignId))
    .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId)));

  if (row === undefined) return null;
  return { userId, campaignId, role: row.role, campaign: row.campaign };
}

/** 403 unless the scope's user is the campaign's GM. */
export function assertGm(scope: CampaignScope): void {
  if (scope.role !== 'gm') throw httpError(403, 'Only the GM can do that');
}

/** 409 if the campaign is archived: archived campaigns are read-only (D-20). */
export function assertWritable(scope: CampaignScope): void {
  if (scope.campaign.archivedAt !== null) throw httpError(409, 'Campaign is archived');
}

/** Renames the campaign. Callers check `assertGm` and `assertWritable` first. */
export async function renameCampaign(
  db: Database,
  scope: CampaignScope,
  name: string,
): Promise<Campaign> {
  return updateScoped(db, scope, { name });
}

/**
 * Archives or unarchives the campaign. Idempotent: archiving twice keeps the first
 * `archivedAt`. Callers check `assertGm` first.
 */
export async function setArchived(
  db: Database,
  scope: CampaignScope,
  archived: boolean,
): Promise<Campaign> {
  return updateScoped(db, scope, {
    archivedAt: archived ? sql`coalesce(${campaigns.archivedAt}, now())` : null,
  });
}

async function updateScoped(
  db: Database,
  scope: CampaignScope,
  values: PgUpdateSetSource<typeof campaigns>,
): Promise<Campaign> {
  const [row] = await db
    .update(campaigns)
    .set(values)
    .where(eq(campaigns.id, scope.campaignId))
    .returning();
  if (row === undefined) throw httpError(404, 'Campaign not found');
  return toCampaign(row, scope.role);
}
