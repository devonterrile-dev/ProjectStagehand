import {
  createInviteRequestSchema,
  inviteCodeSchema,
  type AcceptInviteResponse,
  type InviteListResponse,
  type InvitePreview,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import { requireSession, sessionOf } from '../auth/routes';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import {
  acceptInvite,
  createInvite,
  listActiveInvites,
  previewInvite,
  revokeInvite,
} from '../campaigns/invites';
import { assertGm, assertWritable } from '../campaigns/scope';
import type { Database } from '../db/client';
import { httpError, sendValidationError } from '../http/errors';

const INVALID_INVITE = 'This invite link has expired or been revoked';

/** The `:code` param, or a 404 that looks like any other dead link. */
function inviteCode(request: FastifyRequest): string {
  const parsed = inviteCodeSchema.safeParse((request.params as { code?: unknown }).code);
  if (!parsed.success) throw httpError(404, INVALID_INVITE);
  return parsed.data;
}

/**
 * Invite links (F1.2): the GM's links for a campaign (campaign-scoped, in the isolation
 * table), and joining through a link (`/api/invites/:code`, any signed-in user).
 */
export function registerInviteRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database },
): void {
  const preHandler = memberOnly(deps.auth, deps.db);
  const signedIn = requireSession(deps.auth);

  app.get(
    '/api/campaigns/:campaignId/invites',
    { preHandler },
    async (request): Promise<InviteListResponse> => {
      const scope = campaignOf(request);
      assertGm(scope);
      return { invites: await listActiveInvites(deps.db, scope) };
    },
  );

  app.post('/api/campaigns/:campaignId/invites', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);

    const parsed = createInviteRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    return reply.code(201).send(await createInvite(deps.db, scope, parsed.data.expiresIn));
  });

  // Works while archived: revoking only takes access away (D-21).
  app.post(
    '/api/campaigns/:campaignId/invites/:inviteId/revoke',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      await revokeInvite(deps.db, scope, uuidParam(request, 'inviteId', 'Invite not found'));
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/invites/:code',
    { preHandler: signedIn },
    async (request): Promise<InvitePreview> => {
      const preview = await previewInvite(deps.db, sessionOf(request).user.id, inviteCode(request));
      if (preview === null) throw httpError(404, INVALID_INVITE);
      return preview;
    },
  );

  app.post(
    '/api/invites/:code/accept',
    { preHandler: signedIn },
    async (request): Promise<AcceptInviteResponse> => {
      const campaignId = await acceptInvite(
        deps.db,
        sessionOf(request).user.id,
        inviteCode(request),
      );
      if (campaignId === null) throw httpError(404, INVALID_INVITE);
      return { campaignId };
    },
  );
}
