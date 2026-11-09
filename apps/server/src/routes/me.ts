import { meResponseSchema, updateMeRequestSchema, type MeResponse } from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { type Auth } from '../auth/auth';
import { requireSession, sessionOf } from '../auth/routes';
import type { Database } from '../db/client';
import { users } from '../db/schema';
import { sendValidationError } from '../http/errors';

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

/** GET /api/me and PATCH /api/me (display name). */
export function registerMeRoutes(app: FastifyInstance, deps: { auth: Auth; db: Database }): void {
  const preHandler = requireSession(deps.auth);

  app.get('/api/me', { preHandler }, (request) => toMe(sessionOf(request).user));

  app.patch('/api/me', { preHandler }, async (request, reply) => {
    const { user } = sessionOf(request);

    const parsed = updateMeRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

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
