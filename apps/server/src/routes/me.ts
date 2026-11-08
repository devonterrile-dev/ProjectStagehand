import { meResponseSchema, updateMeRequestSchema, type MeResponse } from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { type Auth } from '../auth/auth';
import { requireSession, type AuthSession } from '../auth/routes';
import type { Database } from '../db/client';
import { users } from '../db/schema';

interface ProfileFields {
  id: string;
  name: string;
  image?: string | null | undefined;
  discordUsername: string;
  displayName?: string | null | undefined;
}

/** The signed-in user's profile, as the web client sees it. */
export function toMe(user: ProfileFields): MeResponse {
  const custom = user.displayName ?? null;
  return meResponseSchema.parse({
    id: user.id,
    displayName: custom ?? user.name,
    hasCustomDisplayName: custom !== null,
    discordUsername: user.discordUsername,
    avatarUrl: user.image ?? null,
  });
}

/** The session `requireSession` attached; throws if a route forgot the preHandler. */
function sessionOf(request: FastifyRequest): AuthSession {
  if (request.auth === null) throw new Error('route is missing the requireSession preHandler');
  return request.auth;
}

/** GET /api/me and PATCH /api/me (display name). */
export function registerMeRoutes(app: FastifyInstance, deps: { auth: Auth; db: Database }): void {
  const preHandler = requireSession(deps.auth);

  app.get('/api/me', { preHandler }, (request) => toMe(sessionOf(request).user));

  app.patch('/api/me', { preHandler }, async (request, reply) => {
    const { user } = sessionOf(request);

    const parsed = updateMeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Bad Request',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const [updated] = await deps.db
      .update(users)
      .set({ displayName: parsed.data.displayName })
      .where(eq(users.id, user.id))
      .returning();

    if (updated === undefined) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    return toMe(updated);
  });
}
