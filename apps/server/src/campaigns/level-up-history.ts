/**
 * A PC's level-ups as the sheet and the level-up rules read them (F4.9, D-68): the level each
 * reached and its picks, in order. Its own module so `characters.ts` and `level-ups.ts` both
 * read it without importing each other.
 */
import { levelUpPickSchema, type LevelUpEntry } from '@stagehand/shared';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { characterLevelUps } from '../db/schema';

import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

const picksSchema = z.array(levelUpPickSchema);

export async function levelUpHistory(
  db: DbOrTx,
  scope: CampaignScope,
  characterId: string,
): Promise<LevelUpEntry[]> {
  const rows = await db
    .select({ level: characterLevelUps.level, picks: characterLevelUps.picks })
    .from(characterLevelUps)
    .where(
      and(
        eq(characterLevelUps.characterId, characterId),
        eq(characterLevelUps.campaignId, scope.campaignId),
      ),
    )
    .orderBy(asc(characterLevelUps.level), asc(characterLevelUps.createdAt));
  return rows.map((row) => ({ level: row.level, picks: picksSchema.parse(row.picks) }));
}
