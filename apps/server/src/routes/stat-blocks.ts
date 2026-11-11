import {
  createStatBlockRequestSchema,
  updateStatBlockRequestSchema,
  type StatBlockListResponse,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { assertGm, assertWritable } from '../campaigns/scope';
import {
  createStatBlock,
  deleteStatBlock,
  getStatBlock,
  listStatBlocks,
  updateStatBlock,
} from '../campaigns/stat-blocks';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';

/**
 * Stat blocks (F1.4): list, create, read, partial update and delete. GM only. NPC records
 * link one through the record PATCH (`statBlockId`). Every route here is campaign-scoped:
 * see the isolation table in `campaigns.int.test.ts`.
 */
export function registerStatBlockRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database },
): void {
  const preHandler = memberOnly(deps.auth, deps.db);
  const statBlockId = (request: FastifyRequest) =>
    uuidParam(request, 'statBlockId', 'Stat block not found');

  app.get(
    '/api/campaigns/:campaignId/stat-blocks',
    { preHandler },
    async (request): Promise<StatBlockListResponse> => {
      const scope = campaignOf(request);
      assertGm(scope);
      return { statBlocks: await listStatBlocks(deps.db, scope) };
    },
  );

  app.post('/api/campaigns/:campaignId/stat-blocks', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);

    const parsed = createStatBlockRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    return reply.code(201).send(await createStatBlock(deps.db, scope, parsed.data));
  });

  app.get('/api/campaigns/:campaignId/stat-blocks/:statBlockId', { preHandler }, (request) => {
    const scope = campaignOf(request);
    assertGm(scope);
    return getStatBlock(deps.db, scope, statBlockId(request));
  });

  app.patch(
    '/api/campaigns/:campaignId/stat-blocks/:statBlockId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = statBlockId(request);

      const parsed = updateStatBlockRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      return updateStatBlock(deps.db, scope, id, parsed.data);
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/stat-blocks/:statBlockId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);

      await deleteStatBlock(deps.db, scope, statBlockId(request));
      return reply.code(204).send();
    },
  );
}
