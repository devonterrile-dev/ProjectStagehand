/**
 * Invite links (F1.2, governance §7, D-21). GM-side functions are scoped to
 * `scope.campaignId`, like the rest of the campaign data-access layer.
 *
 * The one exception is joining: `previewInvite` and `acceptInvite` look an invite up by its
 * code, before the user is a member. The code is the credential: 128 random bits, and only
 * active invites to active campaigns are ever found.
 */
import { randomBytes } from 'node:crypto';

import {
  inviteSchema,
  type Invite,
  type InviteExpiry,
  type InvitePreview,
} from '@stagehand/shared';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { campaignMembers, campaigns, invites, users } from '../db/schema';
import { httpError } from '../http/errors';
import { shownName } from '../users/profile';

import type { CampaignScope } from './scope';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_MS: Record<InviteExpiry, number | null> = {
  never: null,
  '1d': DAY_MS,
  '7d': 7 * DAY_MS,
};

/** A new invite code: 16 random bytes as base64url (22 characters). */
export function newInviteCode(): string {
  return randomBytes(16).toString('base64url');
}

/** Not revoked and not past its expiry. */
const isActive = and(
  isNull(invites.revokedAt),
  or(isNull(invites.expiresAt), gt(invites.expiresAt, sql`now()`)),
);

function toInvite(row: typeof invites.$inferSelect): Invite {
  return inviteSchema.parse({
    id: row.id,
    code: row.code,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

/** The campaign's active invite links, newest first. */
export async function listActiveInvites(db: Database, scope: CampaignScope): Promise<Invite[]> {
  const rows = await db
    .select()
    .from(invites)
    .where(and(eq(invites.campaignId, scope.campaignId), isActive))
    .orderBy(desc(invites.createdAt));
  return rows.map(toInvite);
}

/** Creates an invite link. Callers check `assertGm` and `assertWritable`. */
export async function createInvite(
  db: Database,
  scope: CampaignScope,
  expiresIn: InviteExpiry,
): Promise<Invite> {
  const ms = EXPIRY_MS[expiresIn];
  const [row] = await db
    .insert(invites)
    .values({
      campaignId: scope.campaignId,
      code: newInviteCode(),
      createdByUserId: scope.userId,
      expiresAt: ms === null ? null : new Date(Date.now() + ms),
    })
    .returning();
  if (row === undefined) throw new Error('invite insert returned no row');
  return toInvite(row);
}

/** Revokes an invite link. Idempotent; allowed on archived campaigns. Callers check `assertGm`. */
export async function revokeInvite(
  db: Database,
  scope: CampaignScope,
  inviteId: string,
): Promise<void> {
  const [row] = await db
    .update(invites)
    .set({ revokedAt: sql`coalesce(${invites.revokedAt}, now())` })
    .where(and(eq(invites.id, inviteId), eq(invites.campaignId, scope.campaignId)))
    .returning({ id: invites.id });
  if (row === undefined) throw httpError(404, 'Invite not found');
}

/** An active invite to an active (not archived) campaign, with the campaign and its GM. */
async function findJoinableInvite(db: Database, code: string) {
  const [row] = await db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      gmName: users.name,
      gmDisplayName: users.displayName,
    })
    .from(invites)
    .innerJoin(campaigns, eq(campaigns.id, invites.campaignId))
    .innerJoin(users, eq(users.id, campaigns.gmUserId))
    .where(and(eq(invites.code, code), isActive, isNull(campaigns.archivedAt)));
  return row ?? null;
}

/** What `userId` sees before joining, or null if the code isn't a joinable invite. */
export async function previewInvite(
  db: Database,
  userId: string,
  code: string,
): Promise<InvitePreview | null> {
  const invite = await findJoinableInvite(db, code);
  if (invite === null) return null;

  const [membership] = await db
    .select({ role: campaignMembers.role })
    .from(campaignMembers)
    .where(
      and(eq(campaignMembers.campaignId, invite.campaignId), eq(campaignMembers.userId, userId)),
    );

  return {
    campaignId: invite.campaignId,
    campaignName: invite.campaignName,
    gmDisplayName: shownName({ name: invite.gmName, displayName: invite.gmDisplayName }),
    alreadyMember: membership !== undefined,
  };
}

/**
 * Joins the invite's campaign as a player. Existing members (including the GM) are left as
 * they are. Returns the campaign id, or null if the code isn't a joinable invite.
 */
export async function acceptInvite(
  db: Database,
  userId: string,
  code: string,
): Promise<string | null> {
  const invite = await findJoinableInvite(db, code);
  if (invite === null) return null;

  await db
    .insert(campaignMembers)
    .values({ campaignId: invite.campaignId, userId, role: 'player' })
    .onConflictDoNothing();
  return invite.campaignId;
}
