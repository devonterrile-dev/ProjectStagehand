import {
  createClassRequestSchema,
  createSubclassRequestSchema,
  updateClassRequestSchema,
  updateSubclassRequestSchema,
  type ClassListResponse,
  type SubclassListResponse,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import {
  createClass,
  createSubclass,
  deleteClass,
  deleteSubclass,
  getClass,
  getSubclass,
  listClasses,
  listSubclasses,
  updateClass,
  updateSubclass,
} from '../campaigns/classes';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { assertGm, assertWritable } from '../campaigns/scope';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';

/**
 * Classes and subclasses (F4.5, governance §8, D-63). Every member reads them; only the GM
 * creates, changes or deletes them, and not while the campaign is archived. Every route here is
 * campaign-scoped: see the isolation table in `campaigns.int.test.ts`.
 */
export function registerClassRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database },
): void {
  const preHandler = memberOnly(deps.auth, deps.db);
  const classId = (request: FastifyRequest) => uuidParam(request, 'classId', 'Class not found');
  const subclassId = (request: FastifyRequest) =>
    uuidParam(request, 'subclassId', 'Subclass not found');

  app.get(
    '/api/campaigns/:campaignId/classes',
    { preHandler },
    async (request): Promise<ClassListResponse> => ({
      classes: await listClasses(deps.db, campaignOf(request)),
    }),
  );

  app.post('/api/campaigns/:campaignId/classes', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);
    const parsed = createClassRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    return reply.code(201).send(await createClass(deps.db, scope, parsed.data));
  });

  app.get('/api/campaigns/:campaignId/classes/:classId', { preHandler }, (request) =>
    getClass(deps.db, campaignOf(request), classId(request)),
  );

  app.patch(
    '/api/campaigns/:campaignId/classes/:classId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = classId(request);
      const parsed = updateClassRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      return updateClass(deps.db, scope, id, parsed.data);
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/classes/:classId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      await deleteClass(deps.db, scope, classId(request));
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/campaigns/:campaignId/subclasses',
    { preHandler },
    async (request): Promise<SubclassListResponse> => ({
      subclasses: await listSubclasses(deps.db, campaignOf(request)),
    }),
  );

  app.post('/api/campaigns/:campaignId/subclasses', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);
    const parsed = createSubclassRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    return reply.code(201).send(await createSubclass(deps.db, scope, parsed.data));
  });

  app.get('/api/campaigns/:campaignId/subclasses/:subclassId', { preHandler }, (request) =>
    getSubclass(deps.db, campaignOf(request), subclassId(request)),
  );

  app.patch(
    '/api/campaigns/:campaignId/subclasses/:subclassId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = subclassId(request);
      const parsed = updateSubclassRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      return updateSubclass(deps.db, scope, id, parsed.data);
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/subclasses/:subclassId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      await deleteSubclass(deps.db, scope, subclassId(request));
      return reply.code(204).send();
    },
  );
}
