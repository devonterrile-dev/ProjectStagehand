/**
 * Player characters (F1.2: names only; F1.4 adds the sheet). Part of the campaign
 * data-access layer: every query is scoped to `scope.campaignId`.
 */
import { characterSchema, type Character } from '@stagehand/shared';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { campaignMembers, characters } from '../db/schema';

import { assignCharacterIn } from './members';
import type { CampaignScope } from './scope';

/** Every PC in the campaign, by name, with the player who has it. */
export async function listCharacters(db: Database, scope: CampaignScope): Promise<Character[]> {
  const rows = await db
    .select({
      id: characters.id,
      name: characters.name,
      assignedToUserId: campaignMembers.userId,
    })
    .from(characters)
    .leftJoin(
      campaignMembers,
      and(
        eq(campaignMembers.characterId, characters.id),
        eq(campaignMembers.campaignId, characters.campaignId),
      ),
    )
    .where(eq(characters.campaignId, scope.campaignId))
    .orderBy(asc(sql`lower(${characters.name})`), asc(characters.createdAt));

  return rows.map((row) => characterSchema.parse(row));
}

/**
 * Creates a PC, and gives it to `assignToUserId` (a player in this campaign) if set.
 * Callers check `assertGm` and `assertWritable`.
 */
export async function createCharacter(
  db: Database,
  scope: CampaignScope,
  name: string,
  assignToUserId?: string,
): Promise<Character> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(characters)
      .values({ campaignId: scope.campaignId, name })
      .returning({ id: characters.id, name: characters.name });
    if (row === undefined) throw new Error('character insert returned no row');

    if (assignToUserId !== undefined) {
      await assignCharacterIn(tx, scope, assignToUserId, row.id);
    }
    return characterSchema.parse({ ...row, assignedToUserId: assignToUserId ?? null });
  });
}
