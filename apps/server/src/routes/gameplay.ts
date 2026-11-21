import {
  createDomainCardRequestSchema,
  createDomainRequestSchema,
  updateDomainCardRequestSchema,
  updateDomainRequestSchema,
  type DomainCardListResponse,
  type DomainListResponse,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Auth } from '../auth/auth';
import {
  cardsOf,
  createDomainCard,
  deleteDomainCard,
  getDomainCard,
  updateDomainCard,
} from '../campaigns/domain-cards';
import {
  createDomain,
  deleteDomain,
  getDomain,
  listDomains,
  updateDomain,
} from '../campaigns/domains';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { assertGm, assertWritable } from '../campaigns/scope';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';

const listQuerySchema = z.object({ domainId: z.uuid().optional() });

/**
 * Gameplay records (F4.3, governance §8, D-61): domains and domain cards. Every member reads
 * them; only the GM creates, changes or deletes them, and not while the campaign is archived.
 * Every route here is campaign-scoped: see the isolation table in `campaigns.int.test.ts`.
 */
export function registerGameplayRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database },
): void {
  const preHandler = memberOnly(deps.auth, deps.db);
  const domainId = (request: FastifyRequest) => uuidParam(request, 'domainId', 'Domain not found');
  const cardId = (request: FastifyRequest) => uuidParam(request, 'cardId', 'Domain card not found');

  app.get(
    '/api/campaigns/:campaignId/domains',
    { preHandler },
    async (request): Promise<DomainListResponse> => ({
      domains: await listDomains(deps.db, campaignOf(request)),
    }),
  );

  app.post('/api/campaigns/:campaignId/domains', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);
    const parsed = createDomainRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    return reply.code(201).send(await createDomain(deps.db, scope, parsed.data));
  });

  app.get('/api/campaigns/:campaignId/domains/:domainId', { preHandler }, (request) =>
    getDomain(deps.db, campaignOf(request), domainId(request)),
  );

  app.patch(
    '/api/campaigns/:campaignId/domains/:domainId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = domainId(request);
      const parsed = updateDomainRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      return updateDomain(deps.db, scope, id, parsed.data);
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/domains/:domainId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      await deleteDomain(deps.db, scope, domainId(request));
      return reply.code(204).send();
    },
  );

  app.get('/api/campaigns/:campaignId/domain-cards', { preHandler }, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error);
    const response: DomainCardListResponse = {
      cards: await cardsOf(deps.db, campaignOf(request), query.data.domainId),
    };
    return response;
  });

  app.post('/api/campaigns/:campaignId/domain-cards', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);
    const parsed = createDomainCardRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    return reply.code(201).send(await createDomainCard(deps.db, scope, parsed.data));
  });

  app.get('/api/campaigns/:campaignId/domain-cards/:cardId', { preHandler }, (request) =>
    getDomainCard(deps.db, campaignOf(request), cardId(request)),
  );

  app.patch(
    '/api/campaigns/:campaignId/domain-cards/:cardId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = cardId(request);
      const parsed = updateDomainCardRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      return updateDomainCard(deps.db, scope, id, parsed.data);
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/domain-cards/:cardId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      await deleteDomainCard(deps.db, scope, cardId(request));
      return reply.code(204).send();
    },
  );
}
