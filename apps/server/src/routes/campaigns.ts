import {
  createCampaignRequestSchema,
  renameCampaignRequestSchema,
  type Campaign,
  type CampaignListResponse,
} from '@stagehand/shared';
import type { FastifyInstance } from 'fastify';

import { type Auth } from '../auth/auth';
import { requireSession, sessionOf } from '../auth/routes';
import { campaignOf, memberOnly as campaignMemberOnly } from '../campaigns/guard';
import {
  assertGm,
  assertWritable,
  createCampaign,
  listCampaignsForUser,
  renameCampaign,
  setArchived,
  toCampaign,
} from '../campaigns/scope';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';

/**
 * Campaigns (F1.1): list, create, read, rename, archive and unarchive.
 *
 * Every `/api/campaigns/:campaignId…` route (here and in other route files) must use
 * `memberOnly` from `campaigns/guard.ts` and be listed in the isolation table in
 * `campaigns.int.test.ts` (a guard test fails otherwise). This file registers the
 * `request.campaign` decoration, so it must be registered before the other campaign routes.
 */
export function registerCampaignRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database },
): void {
  app.decorateRequest('campaign', null);

  const signedIn = requireSession(deps.auth);
  const memberOnly = campaignMemberOnly(deps.auth, deps.db);

  app.get(
    '/api/campaigns',
    { preHandler: signedIn },
    async (request): Promise<CampaignListResponse> => ({
      campaigns: await listCampaignsForUser(deps.db, sessionOf(request).user.id),
    }),
  );

  app.post('/api/campaigns', { preHandler: signedIn }, async (request, reply) => {
    const parsed = createCampaignRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const campaign = await createCampaign(deps.db, sessionOf(request).user.id, parsed.data.name);
    return reply.code(201).send(campaign);
  });

  app.get('/api/campaigns/:campaignId', { preHandler: memberOnly }, (request): Campaign => {
    const scope = campaignOf(request);
    return toCampaign(scope.campaign, scope.role);
  });

  app.patch('/api/campaigns/:campaignId', { preHandler: memberOnly }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);

    const parsed = renameCampaignRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    return renameCampaign(deps.db, scope, parsed.data.name);
  });

  app.post(
    '/api/campaigns/:campaignId/archive',
    { preHandler: memberOnly },
    async (request): Promise<Campaign> => {
      const scope = campaignOf(request);
      assertGm(scope);
      return setArchived(deps.db, scope, true);
    },
  );

  // The only write allowed on an archived campaign (D-20).
  app.post(
    '/api/campaigns/:campaignId/unarchive',
    { preHandler: memberOnly },
    async (request): Promise<Campaign> => {
      const scope = campaignOf(request);
      assertGm(scope);
      return setArchived(deps.db, scope, false);
    },
  );
}
