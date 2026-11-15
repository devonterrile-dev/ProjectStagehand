/**
 * Live sessions (F3.3, governance §13 "Session lifecycle", D-50): starting and ending one, and
 * asking whether one is running. Everything that happens during a session goes through the live
 * room (`play/socket.ts`). Every route here is in the isolation table in `campaigns.int.test.ts`.
 *
 * GET  …/play-session       the running session, or null. Any member.
 * POST …/play-session       start one (201), or answer the one already running (200). GM only;
 *                           refused while the campaign is archived.
 * POST …/play-session/end   end it. GM only; allowed while archived, since it only closes.
 * (… is /api/campaigns/:campaignId)
 */
import { playSessionResponseSchema, type PlaySessionResponse } from '@stagehand/shared';
import type { FastifyInstance } from 'fastify';

import type { Auth } from '../auth/auth';
import { campaignOf, memberOnly } from '../campaigns/guard';
import { endSession, getActiveSession, startSession } from '../campaigns/play-sessions';
import { assertGm, assertWritable } from '../campaigns/scope';
import type { Database } from '../db/client';
import type { PlayLive } from '../play/socket';

export function registerPlaySessionRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database; live: PlayLive },
): void {
  const preHandler = memberOnly(deps.auth, deps.db);

  app.get(
    '/api/campaigns/:campaignId/play-session',
    { preHandler },
    async (request): Promise<PlaySessionResponse> =>
      playSessionResponseSchema.parse({
        session: await getActiveSession(deps.db, campaignOf(request)),
      }),
  );

  app.post('/api/campaigns/:campaignId/play-session', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);

    const { session, started } = await startSession(deps.db, scope);
    if (started) deps.live.sessionStarted(scope.campaignId);
    return reply.code(started ? 201 : 200).send(playSessionResponseSchema.parse({ session }));
  });

  app.post(
    '/api/campaigns/:campaignId/play-session/end',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);

      await endSession(deps.db, scope);
      deps.live.sessionEnded(scope.campaignId);
      return reply.code(204).send();
    },
  );
}
