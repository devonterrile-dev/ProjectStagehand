/**
 * Campaigns API (F1.1), against a real Postgres. Includes the campaign-isolation checks
 * governance §14 requires on every campaign route.
 */
import type { Campaign } from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import type { DbHandle } from '../db/client';
import { campaignMembers, campaigns, users } from '../db/schema';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface CampaignRoute {
  method: Method;
  path: string;
  gmOnly: boolean;
  payload?: Record<string, unknown>;
}

/**
 * Every route under `/api/campaigns/:campaignId`. The guard test below fails if a route
 * exists that isn't listed here, so new routes can't skip the isolation checks.
 * `:userId` is filled with the GM's id and other inner ids with a random uuid; the checks
 * here run before those are looked up. Inner-id isolation is tested in `invites.int.test.ts`.
 */
const CAMPAIGN_ROUTES: CampaignRoute[] = [
  { method: 'GET', path: '/api/campaigns/:campaignId', gmOnly: false },
  {
    method: 'PATCH',
    path: '/api/campaigns/:campaignId',
    gmOnly: true,
    payload: { name: 'Hijacked' },
  },
  { method: 'POST', path: '/api/campaigns/:campaignId/archive', gmOnly: true },
  { method: 'POST', path: '/api/campaigns/:campaignId/unarchive', gmOnly: true },
  { method: 'GET', path: '/api/campaigns/:campaignId/members', gmOnly: false },
  // The GM's :userId: a player may only remove themselves.
  { method: 'DELETE', path: '/api/campaigns/:campaignId/members/:userId', gmOnly: true },
  {
    method: 'PUT',
    path: '/api/campaigns/:campaignId/members/:userId/character',
    gmOnly: true,
    payload: { characterId: null },
  },
  { method: 'GET', path: '/api/campaigns/:campaignId/characters', gmOnly: true },
  {
    method: 'POST',
    path: '/api/campaigns/:campaignId/characters',
    gmOnly: true,
    payload: { name: 'Hijacked' },
  },
  { method: 'GET', path: '/api/campaigns/:campaignId/invites', gmOnly: true },
  {
    method: 'POST',
    path: '/api/campaigns/:campaignId/invites',
    gmOnly: true,
    payload: { expiresIn: 'never' },
  },
  { method: 'POST', path: '/api/campaigns/:campaignId/invites/:inviteId/revoke', gmOnly: true },
];

/** `METHOD /full/path` for every route in Fastify's printed route tree (HEAD omitted). */
function registeredRoutes(app: FastifyInstance): string[] {
  const routes: string[] = [];
  const stack: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^([│├└─\s]*)(\S.*?) \(([^)]+)\)$/.exec(line);
    if (match === null) continue;
    const [, indent = '', segment = '', methods = ''] = match;
    const depth = indent.length / 4 - 1;
    stack.length = depth;
    stack.push(segment);
    for (const method of methods.split(', ')) {
      if (method !== 'HEAD') routes.push(`${method} ${stack.join('')}`);
    }
  }
  return routes;
}

/** Postgres error code from a failed query (Drizzle wraps the driver error in `cause`). */
function pgCode(error: unknown): unknown {
  const withCause = error as { code?: unknown; cause?: { code?: unknown } };
  return withCause.cause?.code ?? withCause.code;
}

describe('Campaigns API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: string;
  let outsider: string;
  let player: string;
  let playerId: string;
  let gmId: string;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    gm = await signIn(app, discordUser({ id: '2001', global_name: 'Gamemaster' }));
    outsider = await signIn(app, discordUser({ id: '2002', global_name: 'Outsider' }));
    player = await signIn(app, discordUser({ id: '2003', global_name: 'Player' }));
    const [row] = await handle.db.select().from(users).where(eq(users.discordId, '2003'));
    playerId = row?.id ?? '';
    const [gmRow] = await handle.db.select().from(users).where(eq(users.discordId, '2001'));
    gmId = gmRow?.id ?? '';
  });

  afterAll(async () => {
    await app.close();
  });

  function call(
    method: Method,
    url: string,
    cookie: string,
    payload?: Record<string, unknown>,
    headers: Record<string, string> = SAME_ORIGIN,
  ) {
    return app.inject({
      method,
      url,
      headers: { ...headers, cookie },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function create(cookie: string, name: string): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', cookie, { name });
    expect(response.statusCode).toBe(201);
    return response.json<Campaign>();
  }

  async function list(cookie: string): Promise<Campaign[]> {
    const response = await call('GET', '/api/campaigns', cookie);
    expect(response.statusCode).toBe(200);
    return response.json<{ campaigns: Campaign[] }>().campaigns;
  }

  async function stored(id: string) {
    const [row] = await handle.db.select().from(campaigns).where(eq(campaigns.id, id));
    return row;
  }

  describe('create, rename, archive', () => {
    it('creates a campaign with the caller as GM', async () => {
      const campaign = await create(gm, '  Shattered Coast  ');

      expect(campaign).toMatchObject({ name: 'Shattered Coast', role: 'gm', archivedAt: null });
      const members = await handle.db
        .select()
        .from(campaignMembers)
        .where(eq(campaignMembers.campaignId, campaign.id));
      expect(members).toEqual([expect.objectContaining({ role: 'gm' })]);
      expect((await stored(campaign.id))?.gmUserId).toBe(members[0]?.userId);
    });

    it('lets one GM own many campaigns, listed by name', async () => {
      const zeta = await create(gm, 'zeta Vale');
      const alpha = await create(gm, 'Alpha Isles');

      const names = (await list(gm)).map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(['Alpha Isles', 'zeta Vale']));
      expect(names.indexOf(alpha.name)).toBeLessThan(names.indexOf(zeta.name));
    });

    it('renames, archives (read-only), and unarchives', async () => {
      const { id } = await create(gm, 'Iron Vale');
      const url = `/api/campaigns/${id}`;

      const renamed = await call('PATCH', url, gm, { name: 'The Iron Vale' });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toMatchObject({ name: 'The Iron Vale' });

      const archived = await call('POST', `${url}/archive`, gm);
      expect(archived.statusCode).toBe(200);
      const { archivedAt } = archived.json<Campaign>();
      expect(archivedAt).not.toBeNull();

      // Archiving again keeps the original timestamp.
      expect((await call('POST', `${url}/archive`, gm)).json()).toMatchObject({ archivedAt });

      // Archived campaigns are read-only (D-20): renaming is refused.
      const blocked = await call('PATCH', url, gm, { name: 'Sneaky Rename' });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toMatchObject({ message: 'Campaign is archived' });
      expect((await stored(id))?.name).toBe('The Iron Vale');

      expect((await list(gm)).find((c) => c.id === id)?.archivedAt).toBe(archivedAt);

      const unarchived = await call('POST', `${url}/unarchive`, gm);
      expect(unarchived.statusCode).toBe(200);
      expect(unarchived.json()).toMatchObject({ archivedAt: null });
      expect((await call('PATCH', url, gm, { name: 'Iron Vale' })).statusCode).toBe(200);
    });

    it('rejects empty, too-long and unknown fields with 400', async () => {
      const { id } = await create(gm, 'Validation Target');

      for (const payload of [
        { name: '   ' },
        { name: 'x'.repeat(81) },
        { name: 'ok', role: 'gm' },
      ]) {
        const created = await call('POST', '/api/campaigns', gm, payload);
        expect(created.statusCode, JSON.stringify(payload)).toBe(400);
        expect(created.json<{ issues: unknown[] }>().issues.length).toBeGreaterThan(0);

        const renamed = await call('PATCH', `/api/campaigns/${id}`, gm, payload);
        expect(renamed.statusCode, JSON.stringify(payload)).toBe(400);
      }
      expect((await stored(id))?.name).toBe('Validation Target');
    });

    it('rejects cross-origin writes with 403', async () => {
      const before = (await list(gm)).length;
      const response = await call(
        'POST',
        '/api/campaigns',
        gm,
        { name: 'Evil' },
        { origin: 'https://evil.example' },
      );

      expect(response.statusCode).toBe(403);
      expect(await list(gm)).toHaveLength(before);
    });
  });

  describe('authentication and isolation', () => {
    let target: Campaign;

    beforeAll(async () => {
      target = await create(gm, 'Private Campaign');
    });

    function urlFor(route: CampaignRoute, id: string): string {
      return route.path
        .replace(':campaignId', id)
        .replace(':userId', gmId)
        .replace(':inviteId', '00000000-0000-4000-8000-000000000001');
    }

    it('lists every campaign route in the isolation table', () => {
      const scoped = registeredRoutes(app).filter((route) =>
        route.includes('/api/campaigns/:campaignId'),
      );
      const listed = CAMPAIGN_ROUTES.map((route) => `${route.method} ${route.path}`);

      expect(scoped.sort()).toEqual(listed.sort());
    });

    it('requires a session on every route', async () => {
      expect((await call('GET', '/api/campaigns', '')).statusCode).toBe(401);
      expect((await call('POST', '/api/campaigns', '', { name: 'Nobody' })).statusCode).toBe(401);
      for (const route of CAMPAIGN_ROUTES) {
        const response = await call(route.method, urlFor(route, target.id), '', route.payload);
        expect(response.statusCode, `${route.method} ${route.path}`).toBe(401);
      }
    });

    it("hides another user's campaign behind 404 on every route", async () => {
      for (const route of CAMPAIGN_ROUTES) {
        const response = await call(
          route.method,
          urlFor(route, target.id),
          outsider,
          route.payload,
        );
        expect(response.statusCode, `${route.method} ${route.path}`).toBe(404);
        expect(response.json()).toEqual({ error: 'Not Found', message: 'Campaign not found' });
      }

      expect(await stored(target.id)).toMatchObject({ name: 'Private Campaign', archivedAt: null });
    });

    it("leaves other users' campaigns out of the list", async () => {
      await create(outsider, 'Outsider Campaign');

      const outsiderNames = (await list(outsider)).map((c) => c.name);
      expect(outsiderNames).toEqual(['Outsider Campaign']);
      expect((await list(gm)).map((c) => c.name)).not.toContain('Outsider Campaign');
    });

    it('answers unknown and malformed ids with the same 404', async () => {
      for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid', '1']) {
        const response = await call('GET', `/api/campaigns/${id}`, gm);
        expect(response.statusCode, id).toBe(404);
        expect(response.json()).toEqual({ error: 'Not Found', message: 'Campaign not found' });
      }
    });

    describe('as a player', () => {
      let shared: Campaign;

      beforeAll(async () => {
        shared = await create(gm, 'Shared Table');
        // Invites arrive in F1.2; add the membership directly for now.
        await handle.db
          .insert(campaignMembers)
          .values({ campaignId: shared.id, userId: playerId, role: 'player' });
      });

      it('can read the campaign and sees it in their list', async () => {
        const response = await call('GET', `/api/campaigns/${shared.id}`, player);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ name: 'Shared Table', role: 'player' });

        expect(await list(player)).toEqual([expect.objectContaining({ id: shared.id })]);
      });

      it('is refused every GM-only route with 403', async () => {
        for (const route of CAMPAIGN_ROUTES.filter((r) => r.gmOnly)) {
          const response = await call(
            route.method,
            urlFor(route, shared.id),
            player,
            route.payload,
          );
          expect(response.statusCode, `${route.method} ${route.path}`).toBe(403);
        }
        expect(await stored(shared.id)).toMatchObject({ name: 'Shared Table', archivedAt: null });
      });

      it('cannot be made a second GM (D-14, enforced by the database)', async () => {
        const promoted = handle.db
          .update(campaignMembers)
          .set({ role: 'gm' })
          .where(eq(campaignMembers.userId, playerId));

        const error = await promoted.then(
          () => null,
          (e: unknown) => e,
        );
        expect(pgCode(error)).toBe('23505'); // unique_violation
      });
    });
  });
});
