import {
  createSpeciesRequestSchema,
  updateSpeciesRequestSchema,
  type SpeciesListResponse,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { assertGm, assertWritable } from '../campaigns/scope';
import {
  createSpecies,
  deleteSpecies,
  getSpecies,
  listSpecies,
  updateSpecies,
} from '../campaigns/species';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';

/**
 * Species (F4.6, governance §8, D-64). Every member reads them; only the GM creates, changes or
 * deletes them, and not while the campaign is archived. Every route here is campaign-scoped: see
 * the isolation table in `campaigns.int.test.ts`.
 */
export function registerSpeciesRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database },
): void {
  const preHandler = memberOnly(deps.auth, deps.db);
  const speciesId = (request: FastifyRequest) =>
    uuidParam(request, 'speciesId', 'Species not found');

  app.get(
    '/api/campaigns/:campaignId/species',
    { preHandler },
    async (request): Promise<SpeciesListResponse> => ({
      species: await listSpecies(deps.db, campaignOf(request)),
    }),
  );

  app.post('/api/campaigns/:campaignId/species', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);
    const parsed = createSpeciesRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    return reply.code(201).send(await createSpecies(deps.db, scope, parsed.data));
  });

  app.get('/api/campaigns/:campaignId/species/:speciesId', { preHandler }, (request) =>
    getSpecies(deps.db, campaignOf(request), speciesId(request)),
  );

  app.patch(
    '/api/campaigns/:campaignId/species/:speciesId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = speciesId(request);
      const parsed = updateSpeciesRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      return updateSpecies(deps.db, scope, id, parsed.data);
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/species/:speciesId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      await deleteSpecies(deps.db, scope, speciesId(request));
      return reply.code(204).send();
    },
  );
}
