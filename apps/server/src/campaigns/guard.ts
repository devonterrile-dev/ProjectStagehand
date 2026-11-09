import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Auth } from '../auth/auth';
import { requireSession, sessionOf } from '../auth/routes';
import type { Database } from '../db/client';
import { httpError } from '../http/errors';

import { loadCampaignScope, type CampaignScope } from './scope';

declare module 'fastify' {
  interface FastifyRequest {
    /** The caller's membership of `:campaignId`. Set by `requireCampaignMember`; null elsewhere. */
    campaign: CampaignScope | null;
  }
}

const paramsSchema = z.object({ campaignId: z.uuid() });

/**
 * preHandler for every `/api/campaigns/:campaignId…` route; runs after `requireSession`.
 * A malformed id, a missing campaign and someone else's campaign all answer the same 404,
 * so a non-member can't tell whether a campaign exists.
 */
export function requireCampaignMember(db: Database) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const params = paramsSchema.safeParse(request.params);
    const scope = params.success
      ? await loadCampaignScope(db, sessionOf(request).user.id, params.data.campaignId)
      : null;

    if (scope === null) {
      return reply.code(404).send({ error: 'Not Found', message: 'Campaign not found' });
    }
    request.campaign = scope;
  };
}

/** The scope `requireCampaignMember` attached; throws if a route forgot the preHandler. */
export function campaignOf(request: FastifyRequest): CampaignScope {
  if (request.campaign === null) {
    throw new Error('route is missing the requireCampaignMember preHandler');
  }
  return request.campaign;
}

/**
 * The preHandlers every `/api/campaigns/:campaignId…` route uses: signed in, then a member.
 * Such routes must also be listed in the isolation table in `campaigns.int.test.ts`.
 */
export function memberOnly(auth: Auth, db: Database) {
  return [requireSession(auth), requireCampaignMember(db)];
}

/**
 * A uuid route parameter besides `:campaignId` (e.g. `:userId`). A malformed one is answered
 * like a missing row, 404 with `notFound`.
 */
export function uuidParam(request: FastifyRequest, name: string, notFound: string): string {
  const value = (request.params as Record<string, unknown>)[name];
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw httpError(404, notFound);
  return parsed.data;
}
