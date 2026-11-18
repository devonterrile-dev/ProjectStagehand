/**
 * Emotes (F3.7, governance §12 "Puppet motion", §13 `emote`, D-55): who may play one on which
 * puppet. Playing it is the live room's job; nothing is written, since emotes are not logged.
 * NPC takeover (F3.8, D-56) is checked here too: like an emote, it is never written.
 */
import { and, eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { campaignMembers, playSessionObjects, playSessions } from '../db/schema';
import { httpError } from '../http/errors';

import type { CampaignScope } from './scope';
import { NO_SESSION, running } from './session-core';

export const NO_PUPPET = 'Choose a puppet on the stage';
export const NOT_YOUR_PUPPET = 'That puppet isn’t yours';
export const RAISE_FIRST = 'Raise that puppet first';
export const NO_NPC = 'Choose an NPC puppet on the stage';

/** A live object on the running session's stage, or undefined; throws when nothing runs. */
async function liveObject(db: Database, scope: CampaignScope, objectId: string) {
  const [session] = await db
    .select({ id: playSessions.id })
    .from(playSessions)
    .where(running(scope));
  if (session === undefined) throw httpError(409, NO_SESSION);

  const [object] = await db
    .select({
      kind: playSessionObjects.kind,
      shown: playSessionObjects.shown,
      recordId: playSessionObjects.recordId,
      characterId: playSessionObjects.characterId,
    })
    .from(playSessionObjects)
    .where(
      and(eq(playSessionObjects.playSessionId, session.id), eq(playSessionObjects.id, objectId)),
    );
  return object;
}

/**
 * Checks that an emote may play on a live object: a puppet on the running session's stage,
 * raised, and, for a player, their own PC's. Throws the refusal otherwise.
 */
export async function checkEmote(
  db: Database,
  scope: CampaignScope,
  objectId: string,
): Promise<void> {
  const object = await liveObject(db, scope, objectId);
  if (object?.kind !== 'puppet') throw httpError(404, NO_PUPPET);

  if (scope.role === 'gm') {
    if (!object.shown) throw httpError(409, RAISE_FIRST);
    return;
  }

  // A player never has a lowered puppet on their stage: it is as if it weren't there.
  if (!object.shown) throw httpError(404, NO_PUPPET);
  const [member] = await db
    .select({ characterId: campaignMembers.characterId })
    .from(campaignMembers)
    .where(
      and(
        eq(campaignMembers.campaignId, scope.campaignId),
        eq(campaignMembers.userId, scope.userId),
      ),
    );
  if (object.characterId === null || member?.characterId !== object.characterId) {
    throw httpError(403, NOT_YOUR_PUPPET);
  }
}

/**
 * Checks that the GM may take over a live object's voice (F3.8): an NPC's puppet (not a PC's)
 * on the running session's stage, raised. Throws the refusal otherwise. The GM's role is the
 * live room's to check.
 */
export async function checkTakeover(
  db: Database,
  scope: CampaignScope,
  objectId: string,
): Promise<void> {
  const object = await liveObject(db, scope, objectId);
  if (object?.kind !== 'puppet' || object.recordId === null) throw httpError(404, NO_NPC);
  if (!object.shown) throw httpError(409, RAISE_FIRST);
}
