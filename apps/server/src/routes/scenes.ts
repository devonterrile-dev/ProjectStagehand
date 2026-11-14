/**
 * Scenes (F3.2, governance §12 "Scene builder", D-49). GM only; writes are refused while the
 * campaign is archived. Every route here is in the isolation table in `campaigns.int.test.ts`.
 *
 * GET    …/scenes                    the campaign's scenes
 * POST   …/scenes                    a new, empty scene, optionally from a Spot
 * GET    …/scenes/:sceneId           one scene: its Spot, objects and suggestions
 * PATCH  …/scenes/:sceneId           rename it, or change its Spot
 * DELETE …/scenes/:sceneId
 * PUT    …/scenes/:sceneId/objects   its whole list of props and puppets
 * GET    …/stage-records             what the builder's tray offers
 * (… is /api/campaigns/:campaignId)
 */
import {
  createSceneRequestSchema,
  setSceneObjectsRequestSchema,
  updateSceneRequestSchema,
  type SceneListResponse,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import {
  createScene,
  deleteScene,
  getScene,
  listScenes,
  listStageRecords,
  setSceneObjects,
  updateScene,
} from '../campaigns/scenes';
import { assertGm, assertWritable } from '../campaigns/scope';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';

export function registerSceneRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database },
): void {
  const preHandler = memberOnly(deps.auth, deps.db);
  const sceneId = (request: FastifyRequest) => uuidParam(request, 'sceneId', 'Scene not found');

  app.get(
    '/api/campaigns/:campaignId/scenes',
    { preHandler },
    async (request): Promise<SceneListResponse> => {
      const scope = campaignOf(request);
      assertGm(scope);
      return { scenes: await listScenes(deps.db, scope) };
    },
  );

  app.post('/api/campaigns/:campaignId/scenes', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);

    const parsed = createSceneRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    return reply.code(201).send(await createScene(deps.db, scope, parsed.data));
  });

  app.get('/api/campaigns/:campaignId/scenes/:sceneId', { preHandler }, (request) => {
    const scope = campaignOf(request);
    assertGm(scope);
    return getScene(deps.db, scope, sceneId(request));
  });

  app.patch(
    '/api/campaigns/:campaignId/scenes/:sceneId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = sceneId(request);

      const parsed = updateSceneRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      return updateScene(deps.db, scope, id, parsed.data);
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/scenes/:sceneId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);

      await deleteScene(deps.db, scope, sceneId(request));
      return reply.code(204).send();
    },
  );

  app.put(
    '/api/campaigns/:campaignId/scenes/:sceneId/objects',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = sceneId(request);

      const parsed = setSceneObjectsRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      return setSceneObjects(deps.db, scope, id, parsed.data.objects);
    },
  );

  app.get('/api/campaigns/:campaignId/stage-records', { preHandler }, (request) => {
    const scope = campaignOf(request);
    assertGm(scope);
    return listStageRecords(deps.db, scope);
  });
}
