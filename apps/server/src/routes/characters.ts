import {
  addHeldCardRequestSchema,
  buildCharacterRequestSchema,
  characterTracksRequestSchema,
  createCharacterRequestSchema,
  moveHeldCardRequestSchema,
  setNeedsGuideRequestSchema,
  type CharacterListResponse,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import { buildCharacter, setNeedsGuide } from '../campaigns/character-build';
import { addHeldCard, moveHeldCard, removeHeldCard } from '../campaigns/character-cards';
import { setTracks } from '../campaigns/character-tracks';
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
import type { PlayLive } from '../play/socket';
import { sendValidationError } from '../http/errors';

/**
 * PCs and their sheets (F1.2, F1.4). The GM lists, creates, reads, edits and deletes them.
 * A player can read only their own PC's sheet, through the player allow-list (D-23).
 * An edit during a session reaches the table (F3.6): the GM's desk shows the party's Hope, and
 * the PC's player reads their sheet page again.
 * A PC's domain cards (F4.7): the GM adds and removes them; the PC's player or the GM moves them
 * between loadout and vault, and gets their view of the sheet back.
 * The creation guide (F4.8): the PC's own player, or the GM for them, builds a PC waiting for
 * it; the GM sends a PC through it, or takes it back.
 * Tracks (D-67): the PC's own player, or the GM, marks Hope, HP, Stress and armor slots.
 * Every route here is campaign-scoped: see the isolation table in `campaigns.int.test.ts`.
 */
export function registerCharacterRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database; live: PlayLive },
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

      const id = characterId(request);
      const result = await updateCharacterSheet(deps.db, scope, id, request.body);
      if ('error' in result) return sendValidationError(reply, result.error);
      deps.live.stageChanged(scope);
      deps.live.sheetChanged(scope.campaignId, id);
      return result.sheet;
    },
  );

  const cardId = (request: FastifyRequest) =>
    uuidParam(request, 'cardId', "That card isn't on this sheet");
  /** The caller's view of the sheet after a card change, and the table told. */
  const afterCards = async (request: FastifyRequest, id: string, logged: boolean) => {
    const scope = campaignOf(request);
    deps.live.sheetChanged(scope.campaignId, id);
    if (logged) deps.live.logChanged(scope.campaignId);
    return scope.role === 'gm'
      ? getCharacterSheetForGm(deps.db, scope, id)
      : getOwnCharacterSheet(deps.db, scope, id);
  };

  app.post(
    '/api/campaigns/:campaignId/characters/:characterId/domain-cards',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = characterId(request);
      const parsed = addHeldCardRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      await addHeldCard(deps.db, scope, id, parsed.data);
      return reply.code(201).send(await afterCards(request, id, false));
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/characters/:characterId/domain-cards/:cardId',
    { preHandler },
    async (request) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = characterId(request);
      await removeHeldCard(deps.db, scope, id, cardId(request));
      return afterCards(request, id, false);
    },
  );

  // The PC's own player or the GM: into the loadout may cost Stress (§9, 19.24).
  app.post(
    '/api/campaigns/:campaignId/characters/:characterId/domain-cards/:cardId/move',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertWritable(scope);
      const id = characterId(request);
      const card = cardId(request);
      const parsed = moveHeldCardRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      const change = await moveHeldCard(deps.db, scope, id, card, parsed.data);
      return afterCards(request, id, change.logged);
    },
  );

  // Hope, HP, Stress and marked armor slots (D-67): the PC's own player, or the GM.
  app.post(
    '/api/campaigns/:campaignId/characters/:characterId/tracks',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertWritable(scope);
      const id = characterId(request);
      const parsed = characterTracksRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      const { logged } = await setTracks(deps.db, scope, id, parsed.data);
      // The desk's party Hope follows the stage.
      deps.live.stageChanged(scope);
      return afterCards(request, id, logged);
    },
  );

  // The creation guide's Finish (F4.8): the PC's own player, or the GM.
  app.post(
    '/api/campaigns/:campaignId/characters/:characterId/build',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertWritable(scope);
      const id = characterId(request);
      const parsed = buildCharacterRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      await buildCharacter(deps.db, scope, id, parsed.data);
      deps.live.stageChanged(scope);
      return afterCards(request, id, false);
    },
  );

  // The GM sends a PC through the creation guide, or takes it back (F4.8).
  app.post(
    '/api/campaigns/:campaignId/characters/:characterId/guide',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = characterId(request);
      const parsed = setNeedsGuideRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      await setNeedsGuide(deps.db, scope, id, parsed.data.needsGuide);
      deps.live.sheetChanged(scope.campaignId, id);
      return getCharacterSheetForGm(deps.db, scope, id);
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
