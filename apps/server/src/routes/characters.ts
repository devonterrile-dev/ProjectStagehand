import { createCharacterRequestSchema, type CharacterListResponse } from '@stagehand/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import {
  createCharacter,
  deleteCharacter,
  getCharacterSheetForGm,
  getOwnCharacterSheet,
  listCharacters,
  updateCharacterSheet,
} from '../campaigns/characters';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { assertGm, assertWritable } from '../campaigns/scope';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';

/**
 * PCs and their sheets (F1.2, F1.4). The GM lists, creates, reads, edits and deletes them.
 * A player can read only their own PC's sheet, through the player allow-list (D-23).
 * Every route here is campaign-scoped: see the isolation table in `campaigns.int.test.ts`.
 */
export function registerCharacterRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database },
): void {
  const preHandler = memberOnly(deps.auth, deps.db);
  const characterId = (request: FastifyRequest) =>
    uuidParam(request, 'characterId', 'Character not found');

  app.get(
    '/api/campaigns/:campaignId/characters',
    { preHandler },
    async (request): Promise<CharacterListResponse> => {
      const scope = campaignOf(request);
      assertGm(scope);
      return { characters: await listCharacters(deps.db, scope) };
    },
  );

  app.post('/api/campaigns/:campaignId/characters', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);

    const parsed = createCharacterRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const character = await createCharacter(
      deps.db,
      scope,
      parsed.data.name,
      parsed.data.assignToUserId,
    );
    return reply.code(201).send(character);
  });

  // The GM gets the whole sheet; a player only their own PC, without the private parts.
  app.get('/api/campaigns/:campaignId/characters/:characterId', { preHandler }, (request) => {
    const scope = campaignOf(request);
    const id = characterId(request);
    return scope.role === 'gm'
      ? getCharacterSheetForGm(deps.db, scope, id)
      : getOwnCharacterSheet(deps.db, scope, id);
  });

  app.patch(
    '/api/campaigns/:campaignId/characters/:characterId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);

      const result = await updateCharacterSheet(deps.db, scope, characterId(request), request.body);
      if ('error' in result) return sendValidationError(reply, result.error);
      return result.sheet;
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/characters/:characterId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);

      await deleteCharacter(deps.db, scope, characterId(request));
      return reply.code(204).send();
    },
  );
}
