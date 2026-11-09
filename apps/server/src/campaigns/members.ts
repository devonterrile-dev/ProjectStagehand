/**
 * Campaign members and PC assignment (F1.2). Part of the campaign data-access layer: every
 * function is scoped to `scope.campaignId`, so ids from another campaign are never found.
 */
import { memberSchema, type Member } from '@stagehand/shared';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { campaignMembers, characters, users } from '../db/schema';
import { httpError } from '../http/errors';
import { shownName } from '../users/profile';

import { assertGm, type CampaignScope } from './scope';

/** A database handle or an open transaction: both run the same queries. */
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/** Everyone in the campaign: the GM first, then players by name. */
export async function listMembers(db: Database, scope: CampaignScope): Promise<Member[]> {
  const rows = await db
    .select({
      userId: campaignMembers.userId,
      role: campaignMembers.role,
      joinedAt: campaignMembers.createdAt,
      name: users.name,
      displayName: users.displayName,
      image: users.image,
      characterId: characters.id,
      characterName: characters.name,
    })
    .from(campaignMembers)
    .innerJoin(users, eq(users.id, campaignMembers.userId))
    .leftJoin(characters, eq(characters.id, campaignMembers.characterId))
    .where(eq(campaignMembers.campaignId, scope.campaignId));

  const members = rows.map((row) =>
    memberSchema.parse({
      userId: row.userId,
      displayName: shownName(row),
      avatarUrl: row.image,
      role: row.role,
      character:
        row.characterId === null || row.characterName === null
          ? null
          : { id: row.characterId, name: row.characterName },
      joinedAt: row.joinedAt.toISOString(),
    }),
  );

  return members.sort(
    (a, b) =>
      Number(b.role === 'gm') - Number(a.role === 'gm') ||
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  );
}

/**
 * Removes a member. A player may remove themselves (leaving); the GM may remove any player.
 * The GM can't be removed. Their PC, if any, stays in the campaign, unassigned (D-21).
 * Allowed on archived campaigns: it only takes access away.
 */
export async function removeMember(
  db: Database,
  scope: CampaignScope,
  targetUserId: string,
): Promise<void> {
  if (targetUserId === scope.userId) {
    if (scope.role === 'gm') throw httpError(409, "The GM can't leave their own campaign");
  } else {
    assertGm(scope);
  }

  const target = await findMember(db, scope.campaignId, targetUserId);
  if (target.role === 'gm') throw httpError(409, "The GM can't be removed");

  await db
    .delete(campaignMembers)
    .where(
      and(
        eq(campaignMembers.campaignId, scope.campaignId),
        eq(campaignMembers.userId, targetUserId),
      ),
    );
}

/**
 * Gives a player a PC (or none, with null). A PC belongs to one player at a time, so a PC
 * that another player had moves to this one. Callers check `assertGm` and `assertWritable`.
 */
export async function assignCharacter(
  db: Database,
  scope: CampaignScope,
  targetUserId: string,
  characterId: string | null,
): Promise<void> {
  await db.transaction((tx) => assignCharacterIn(tx, scope, targetUserId, characterId));
}

/** `assignCharacter` inside an existing transaction (used when creating a PC). */
export async function assignCharacterIn(
  tx: DbOrTx,
  scope: CampaignScope,
  targetUserId: string,
  characterId: string | null,
): Promise<void> {
  const target = await findMember(tx, scope.campaignId, targetUserId);
  if (target.role !== 'player') throw httpError(409, 'Only players can have a PC');

  if (characterId !== null) {
    const [character] = await tx
      .select({ id: characters.id })
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.campaignId, scope.campaignId)));
    if (character === undefined) throw httpError(404, 'Character not found');

    // Free the PC from whoever had it, so it can move to the target.
    await tx
      .update(campaignMembers)
      .set({ characterId: null })
      .where(
        and(
          eq(campaignMembers.campaignId, scope.campaignId),
          eq(campaignMembers.characterId, characterId),
        ),
      );
  }

  await tx
    .update(campaignMembers)
    .set({ characterId })
    .where(
      and(
        eq(campaignMembers.campaignId, scope.campaignId),
        eq(campaignMembers.userId, targetUserId),
      ),
    );
}

async function findMember(db: DbOrTx, campaignId: string, userId: string) {
  const [member] = await db
    .select({ role: campaignMembers.role })
    .from(campaignMembers)
    .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId)));
  if (member === undefined) throw httpError(404, 'Member not found');
  return member;
}
