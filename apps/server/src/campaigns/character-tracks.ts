/**
 * The tracks a PC's own player marks in play (D-67, governance §7 and §9): Hope, HP left, Stress
 * marked and armor slots marked. The app moves some of them itself (rolls, recalls), but play
 * always has more effects than it can automate, so the player keeps them. Part of the campaign
 * data-access layer: every query is scoped to `scope.campaignId`.
 *
 * The PC's own player or the GM sets them, each checked against its maximum on the sheet (the
 * armor slots against the slots the sheet shows, which linked armor sets). While a session runs,
 * each change is a line in the GM's log.
 */
import { rulesetFor, type CharacterTracksRequest, type TrackKey } from '@stagehand/shared';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { characters, playSessions } from '../db/schema';
import { httpError } from '../http/errors';

import { findSheet, toCharacterSheet } from './characters';
import { logEvent, running } from './session-core';
import type { CampaignScope } from './scope';

/** The track a log line names. */
export const TRACK_OF: Record<TrackKey, 'hope' | 'hp' | 'stress' | 'armor'> = {
  hope: 'hope',
  hpCurrent: 'hp',
  stressCurrent: 'stress',
  armorSlotsMarked: 'armor',
};

/** Sets the tracks sent. Returns whether a session line was written. */
export async function setTracks(
  db: Database,
  scope: CampaignScope,
  characterId: string,
  request: CharacterTracksRequest,
): Promise<{ logged: boolean }> {
  const ruleset = rulesetFor(scope.campaign.rulesetVersion);
  return db.transaction(async (tx) => {
    const { row, assignedToUserId } = await findSheet(tx, scope, characterId, true);
    if (scope.role !== 'gm' && assignedToUserId !== scope.userId) {
      throw httpError(404, 'Character not found');
    }
    const sheet = await toCharacterSheet(tx, scope, row, assignedToUserId);
    const max: Record<TrackKey, number> = {
      hope: ruleset.hopeMax,
      hpCurrent: row.hpMax,
      stressCurrent: row.stressMax,
      armorSlotsMarked: sheet.built.armorSlotsMax,
    };
    const label: Record<TrackKey, string> = {
      hope: 'Hope',
      hpCurrent: 'HP',
      stressCurrent: 'Stress',
      armorSlotsMarked: 'Marked armor slots',
    };
    const changes: { key: TrackKey; from: number; to: number }[] = [];
    for (const key of Object.keys(request) as TrackKey[]) {
      const to = request[key];
      if (to === undefined) continue;
      if (to > max[key]) {
        throw httpError(400, `${label[key]} can't be above ${String(max[key])}`);
      }
      if (to !== row[key]) changes.push({ key, from: row[key], to });
    }
    if (changes.length === 0) return { logged: false };

    await tx
      .update(characters)
      .set({
        ...Object.fromEntries(changes.map(({ key, to }) => [key, to])),
        updatedAt: new Date(),
      })
      .where(and(eq(characters.id, characterId), eq(characters.campaignId, scope.campaignId)));

    const [session] = await tx
      .select({ id: playSessions.id })
      .from(playSessions)
      .where(running(scope));
    if (session === undefined) return { logged: false };
    for (const { key, from, to } of changes) {
      await logEvent(tx, scope, session, 'track_adjust', {
        actorUserId: scope.userId,
        data: {
          characterId,
          characterName: row.name,
          track: TRACK_OF[key],
          from,
          to,
          max: max[key],
        },
      });
    }
    return { logged: true };
  });
}
