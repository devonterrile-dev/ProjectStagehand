import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { sessionOf } from '../auth/routes';
import type { Database } from '../db/client';

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
