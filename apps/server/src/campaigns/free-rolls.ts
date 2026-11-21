/**
 * Free rolls from the dice tray (F4.2, governance §9 "Free rolls", D-60). Part of the campaign
 * data-access layer: every query is scoped to `scope.campaignId`.
 *
 * Anyone at the table rolls any number of one kind of die; only the GM may roll privately
 * (19.20). The dice come from the caller (`RollAny`), so nothing here is random. Every free roll
 * is logged; it changes nothing else, so the stage isn't sent again.
 */
import { freeRollSchema, type FreeRoll, type FreeRollRequest } from '@stagehand/shared';
import { z } from 'zod';

import type { Database } from '../db/client';
import { httpError } from '../http/errors';

import { presenceMemberOf } from './members';
import type { CampaignScope } from './scope';
import { lockRunning, logEvent } from './session-core';

/** Rolls one die with `sides` faces: 1 to `sides`. */
export type RollAny = (sides: number) => number;

/** What a `free_roll` line of the log holds. */
export const freeRollEventSchema = z.object({
  rollerName: z.string(),
  die: freeRollSchema.shape.die,
  results: freeRollSchema.shape.results,
  total: z.int(),
  private: z.boolean(),
});
export type FreeRollEvent = z.infer<typeof freeRollEventSchema>;

export const NO_PRIVATE = 'Only the GM can roll privately';

/** Who the table is told rolled: "The GM", a player's PC, or the player when they have none. */
async function rollerNameOf(db: Database, scope: CampaignScope): Promise<string> {
  if (scope.role === 'gm') return 'The GM';
  const member = await presenceMemberOf(db, scope);
  return member.characterName ?? member.displayName;
}

/** Rolls the dice of a free roll in the running session, and logs it. */
export async function makeFreeRoll(
  db: Database,
  scope: CampaignScope,
  request: FreeRollRequest,
  rollAny: RollAny,
): Promise<FreeRoll> {
  if (request.private && scope.role !== 'gm') throw httpError(403, NO_PRIVATE);
  const rollerName = await rollerNameOf(db, scope);
  return db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    const results = Array.from({ length: request.count }, () => rollAny(request.die));
    if (results.some((face) => !Number.isInteger(face) || face < 1 || face > request.die)) {
      throw new Error('a free roll die was off its faces');
    }
    const event: FreeRollEvent = {
      rollerName,
      die: request.die,
      results,
      total: results.reduce((sum, face) => sum + face, 0),
      private: request.private,
    };
    const { id } = await logEvent(tx, scope, session, 'free_roll', {
      actorUserId: scope.userId,
      data: event,
    });
    return freeRollSchema.parse({
      id,
      userId: scope.userId,
      ...event,
      at: new Date().toISOString(),
    });
  });
}
