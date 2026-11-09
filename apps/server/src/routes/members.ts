import {
  assignCharacterRequestSchema,
  createCharacterRequestSchema,
  type CharacterListResponse,
  type MemberListResponse,
} from '@stagehand/shared';
import type { FastifyInstance } from 'fastify';

import type { Auth } from '../auth/auth';
import { createCharacter, listCharacters } from '../campaigns/characters';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { assignCharacter, listMembers, removeMember } from '../campaigns/members';
import { assertGm, assertWritable } from '../campaigns/scope';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';

/**
 * Members and PCs (F1.2): the roster, removing or leaving, and creating and assigning PCs.
 * Every route here is campaign-scoped: see the isolation table in `campaigns.int.test.ts`.
 */
export function registerMemberRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database },
): void {
  const preHandler = memberOnly(deps.auth, deps.db);

  app.get(
    '/api/campaigns/:campaignId/members',
    { preHandler },
    async (request): Promise<MemberListResponse> => ({
      members: await listMembers(deps.db, campaignOf(request)),
    }),
  );

  // GM removes a player, or a player leaves (their own :userId). Works while archived.
  app.delete(
    '/api/campaigns/:campaignId/members/:userId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      const userId = uuidParam(request, 'userId', 'Member not found');
      await removeMember(deps.db, scope, userId);
      return reply.code(204).send();
    },
  );

  app.put(
    '/api/campaigns/:campaignId/members/:userId/character',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const userId = uuidParam(request, 'userId', 'Member not found');

      const parsed = assignCharacterRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      await assignCharacter(deps.db, scope, userId, parsed.data.characterId);
      return reply.code(204).send();
    },
  );

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
}
