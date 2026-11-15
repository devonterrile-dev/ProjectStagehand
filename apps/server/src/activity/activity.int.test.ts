/**
 * The Discord Activity test beside the real app: its routes answer Discord's proxy origin,
 * and that origin gets nothing else past the cross-origin check (governance §14).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, DISCORD_CLIENT_ID, SAME_ORIGIN } from '../../test/auth-helpers';

/** What a request from inside the Activity frame carries. */
const FROM_DISCORD = {
  origin: `https://${DISCORD_CLIENT_ID}.discordsays.com`,
  'content-type': 'application/json',
};

describe('Activity test, switched on', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildTestApp({ activityTest: true }));
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers its routes from Discord's proxy origin", async () => {
    const config = await app.inject({ url: '/api/activity/config', headers: FROM_DISCORD });
    // Only the test is on: the frame gets the probes, and no sign-in.
    expect(config.json()).toEqual({ clientId: DISCORD_CLIENT_ID, signIn: false, test: true });

    const probe = await app.inject({
      method: 'POST',
      url: '/api/activity/probe',
      headers: FROM_DISCORD,
      payload: {},
    });
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toMatchObject({ origin: FROM_DISCORD.origin });
  });

  it('still blocks that origin on every other state-changing route', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: FROM_DISCORD,
      payload: { displayName: 'x' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('sets no Stagehand session', async () => {
    const probe = await app.inject({
      method: 'POST',
      url: '/api/activity/probe',
      headers: FROM_DISCORD,
      payload: {},
    });

    expect(String(probe.headers['set-cookie'])).not.toContain('session_token');
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
  });
});

describe('Activity test, switched off (the default)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it("blocks Discord's proxy origin and serves no Activity route", async () => {
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/activity/probe',
      headers: FROM_DISCORD,
      payload: {},
    });
    expect(blocked.statusCode).toBe(403);

    const sameOrigin = await app.inject({
      method: 'POST',
      url: '/api/activity/probe',
      headers: SAME_ORIGIN,
      payload: {},
    });
    expect(sameOrigin.statusCode).toBe(404);
    expect((await app.inject({ url: '/api/activity/config' })).statusCode).toBe(404);
  });
});
