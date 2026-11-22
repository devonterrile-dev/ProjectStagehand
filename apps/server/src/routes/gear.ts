import {
  createArmorRequestSchema,
  createWeaponRequestSchema,
  startingGearSchema,
  updateArmorRequestSchema,
  updateWeaponRequestSchema,
  type ArmorListResponse,
  type StartingGear,
  type WeaponListResponse,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import {
  createArmor,
  createWeapon,
  deleteArmor,
  deleteWeapon,
  getArmor,
  getWeapon,
  listArmor,
  listWeapons,
  updateArmor,
  updateWeapon,
} from '../campaigns/gear';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { assertGm, assertWritable } from '../campaigns/scope';
import { getStartingGear, putStartingGear } from '../campaigns/starting-gear';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';

/**
 * Weapons and armor (F4.4, governance §8, D-62). Every member reads them; only the GM creates,
 * changes or deletes them, and not while the campaign is archived. The campaign's starting gear
 * (F4.8, D-66) too: every member reads it, for the creation guide; the GM sets it. Every route
 * here is campaign-scoped: see the isolation table in `campaigns.int.test.ts`.
 */
export function registerGearRoutes(app: FastifyInstance, deps: { auth: Auth; db: Database }): void {
  const preHandler = memberOnly(deps.auth, deps.db);
  const weaponId = (request: FastifyRequest) => uuidParam(request, 'weaponId', 'Weapon not found');
  const armorId = (request: FastifyRequest) => uuidParam(request, 'armorId', 'Armor not found');

  app.get(
    '/api/campaigns/:campaignId/weapons',
    { preHandler },
    async (request): Promise<WeaponListResponse> => ({
      weapons: await listWeapons(deps.db, campaignOf(request)),
    }),
  );

  app.post('/api/campaigns/:campaignId/weapons', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);
    const parsed = createWeaponRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    return reply.code(201).send(await createWeapon(deps.db, scope, parsed.data));
  });

  app.get('/api/campaigns/:campaignId/weapons/:weaponId', { preHandler }, (request) =>
    getWeapon(deps.db, campaignOf(request), weaponId(request)),
  );

  app.patch(
    '/api/campaigns/:campaignId/weapons/:weaponId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = weaponId(request);
      const parsed = updateWeaponRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      return updateWeapon(deps.db, scope, id, parsed.data);
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/weapons/:weaponId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      await deleteWeapon(deps.db, scope, weaponId(request));
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/campaigns/:campaignId/armor',
    { preHandler },
    async (request): Promise<ArmorListResponse> => ({
      armor: await listArmor(deps.db, campaignOf(request)),
    }),
  );

  app.post('/api/campaigns/:campaignId/armor', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);
    const parsed = createArmorRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    return reply.code(201).send(await createArmor(deps.db, scope, parsed.data));
  });

  app.get('/api/campaigns/:campaignId/armor/:armorId', { preHandler }, (request) =>
    getArmor(deps.db, campaignOf(request), armorId(request)),
  );

  app.patch('/api/campaigns/:campaignId/armor/:armorId', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);
    const id = armorId(request);
    const parsed = updateArmorRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    return updateArmor(deps.db, scope, id, parsed.data);
  });

  app.delete(
    '/api/campaigns/:campaignId/armor/:armorId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      await deleteArmor(deps.db, scope, armorId(request));
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/campaigns/:campaignId/starting-gear',
    { preHandler },
    (request): Promise<StartingGear> => getStartingGear(deps.db, campaignOf(request)),
  );

  app.put('/api/campaigns/:campaignId/starting-gear', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);
    const parsed = startingGearSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    return putStartingGear(deps.db, scope, parsed.data);
  });
}
