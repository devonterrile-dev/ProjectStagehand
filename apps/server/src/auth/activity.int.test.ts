/**
 * Signing in inside Discord's Activity frame (F3.3c, governance §13 and §14, D-51), against a
 * real Postgres with Discord faked: the session cookie a frame may keep, what that session can
 * then do from Discord's proxy origin (routes, the live room), who is refused, the rate limit,
 * and that none of it exists unless the Activity is switched on.
 */
import type { AddressInfo } from 'node:net';

import {
  ACTIVITY_NO_ACCOUNT,
  ACTIVITY_SIGN_IN_PATH,
  activityConfigResponseSchema,
  discordActivityOrigin,
  PLAY_SOCKET,
  type Campaign,
  type JoinResult,
  type MeResponse,
} from '@stagehand/shared';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildTestApp,
  cookieHeader,
  DISCORD_CLIENT_ID,
  discordUser,
  fakeDiscord,
  PUBLIC_URL,
  SAME_ORIGIN,
  signIn,
  type FakeDiscordUser,
} from '../../test/auth-helpers';
import type { DbHandle } from '../db/client';
import { sessions, users } from '../db/schema';

import { ACTIVITY_SIGN_IN_LIMIT, NO_ACCOUNT_MESSAGE } from './activity-plugin';

/** Where the frame's requests come from: Discord's proxy for this application. */
const FRAME = { origin: discordActivityOrigin(DISCORD_CLIENT_ID) };
/** Another Discord application's Activity: same site, different origin. */
const OTHER_ACTIVITY = { origin: discordActivityOrigin('999999999999999999') };

function rawCookies(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];
  return Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
}

describe('Activity sign-in', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let port: number;
  const mira = discordUser({ id: '18501', global_name: 'Mira in Discord' });
  const stranger = discordUser({ id: '18599', global_name: 'Never Signed In' });
  let miraId: string;
  const open: Socket[] = [];

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp({ activity: true }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    ({ port } = app.server.address() as AddressInfo);
    // Mira has a Stagehand account: she signed in from a browser tab once.
    await signIn(app, mira);
    const [row] = await handle.db.select().from(users).where(eq(users.discordId, mira.id));
    miraId = row?.id ?? '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const socket of open.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Posts a code as the frame would, with Discord answering as `who`. */
  async function signInFromFrame(
    who: FakeDiscordUser,
    headers: Record<string, string> = FRAME,
    payload: unknown = { code: 'code-from-the-sdk' },
  ) {
    fakeDiscord(who);
    const response = await app.inject({
      method: 'POST',
      url: ACTIVITY_SIGN_IN_PATH,
      headers,
      payload: payload as Record<string, unknown>,
    });
    vi.restoreAllMocks();
    return response;
  }

  /** Connects to the live room; rejects when the server refuses the connection. */
  function connect(cookie: string, origin: string): Promise<Socket> {
    const socket = io(`http://127.0.0.1:${String(port)}${PLAY_SOCKET.namespace}`, {
      path: PLAY_SOCKET.path,
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { cookie, origin },
    });
    open.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => {
        resolve(socket);
      });
      socket.once('connect_error', reject);
    });
  }

  it('tells the frame it can sign in here, and which Discord application this is', async () => {
    const response = await app.inject({ url: '/api/activity/config' });

    expect(response.statusCode).toBe(200);
    expect(activityConfigResponseSchema.parse(response.json())).toEqual({
      clientId: DISCORD_CLIENT_ID,
      signIn: true,
      test: false,
    });
    // The probes belong to the Activity test, which is not on.
    const probe = await app.inject({
      method: 'POST',
      url: '/api/activity/probe',
      headers: FRAME,
      payload: {},
    });
    expect(probe.statusCode).toBe(404);
  });

  it('signs an existing account in with a cookie the frame may keep', async () => {
    const response = await signInFromFrame(mira);

    expect(response.statusCode, response.body).toBe(200);
    // The Discord token goes back for the SDK; the refresh token and the secret do not.
    expect(response.json()).toEqual({
      accessToken: `access-${mira.id}`,
      scopes: ['identify', 'email'],
    });
    expect(response.body).not.toContain('refresh-');
    expect(response.body).not.toContain('test-client-secret');
    expect(response.headers['cache-control']).toBe('no-store');

    const session = rawCookies(response).find((cookie) => cookie.includes('session_token='));
    expect(session).toBeDefined();
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=None', 'Partitioned', 'Path=/']) {
      expect(session, attribute).toContain(attribute);
    }
    expect(session).not.toMatch(/SameSite=Lax/i);

    const me = await app.inject({ url: '/api/me', headers: { cookie: cookieHeader(response) } });
    expect(me.statusCode).toBe(200);
    expect(me.json<MeResponse>().id).toBe(miraId);
  });

  it('leaves a browser tab’s cookie as strict as it was', async () => {
    fakeDiscord(mira);
    const start = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: SAME_ORIGIN,
      payload: { provider: 'discord', callbackURL: '/' },
    });
    const state = new URL(start.json<{ url: string }>().url).searchParams.get('state') ?? '';
    const callback = await app.inject({
      url: `/api/auth/callback/discord?code=fake-code&state=${encodeURIComponent(state)}`,
      headers: { cookie: cookieHeader(start) },
    });

    const session = rawCookies(callback).find((cookie) => cookie.includes('session_token='));
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).not.toContain('Partitioned');
  });

  it('lets that session use the app from the frame, routes and live room alike', async () => {
    const cookie = cookieHeader(await signInFromFrame(mira));

    const created = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { ...FRAME, cookie },
      payload: { name: 'Played In Discord' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const campaign = created.json<Campaign>();
    const started = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaign.id}/play-session`,
      headers: { ...FRAME, cookie },
    });
    expect(started.statusCode, started.body).toBe(201);

    const socket = await connect(cookie, FRAME.origin);
    const joined = (await socket
      .timeout(3000)
      .emitWithAck(PLAY_SOCKET.join, { campaignId: campaign.id })) as JoinResult;
    expect(joined.status).toBe('joined');
    expect(joined.status === 'joined' && joined.stage.role).toBe('gm');
  });

  it('refuses another Discord application’s Activity, even with the user’s cookie', async () => {
    const cookie = cookieHeader(await signInFromFrame(mira));

    const write = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { ...OTHER_ACTIVITY, cookie },
      payload: { name: 'Hijacked' },
    });
    expect(write.statusCode).toBe(403);
    await expect(connect(cookie, OTHER_ACTIVITY.origin)).rejects.toThrow();

    // Nor may it sign the frame in, with or without a cookie: not even Discord is asked.
    const before = await handle.db.select({ n: count() }).from(sessions);
    const discordCalls = vi.spyOn(globalThis, 'fetch');
    for (const headers of [OTHER_ACTIVITY, { ...OTHER_ACTIVITY, cookie }, {}]) {
      const signedIn = await app.inject({
        method: 'POST',
        url: ACTIVITY_SIGN_IN_PATH,
        headers,
        payload: { code: 'code-from-the-sdk' },
      });
      expect(signedIn.statusCode).toBe(403);
      expect(rawCookies(signedIn)).toEqual([]);
    }
    expect(discordCalls).not.toHaveBeenCalled();
    expect(await handle.db.select({ n: count() }).from(sessions)).toEqual(before);
  });

  it('still takes sign-in from the app’s own address', async () => {
    expect((await signInFromFrame(mira, { origin: PUBLIC_URL })).statusCode).toBe(200);
  });

  it('gives nobody an account: a Discord user Stagehand has never seen is told what to do', async () => {
    const before = await handle.db.select({ n: count() }).from(users);

    const response = await signInFromFrame(stranger);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: ACTIVITY_NO_ACCOUNT,
      message: NO_ACCOUNT_MESSAGE,
    });
    expect(rawCookies(response)).toEqual([]);
    expect(response.body).not.toContain('access-');
    expect(await handle.db.select({ n: count() }).from(users)).toEqual(before);
  });

  it('answers 400 when Discord refuses the code, without repeating what Discord said', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        Response.json(
          { error: 'invalid_grant', error_description: 'code-from-the-sdk is bad' },
          { status: 400 },
        ),
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: ACTIVITY_SIGN_IN_PATH,
      headers: FRAME,
      payload: { code: 'code-from-the-sdk' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: 'Discord refused the code (400)' });
    expect(response.body).not.toContain('invalid_grant');
    expect(rawCookies(response)).toEqual([]);
  });

  it('answers 502 when Discord can’t be reached, for the code or for who the user is', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    const unreachable = await app.inject({
      method: 'POST',
      url: ACTIVITY_SIGN_IN_PATH,
      headers: FRAME,
      payload: { code: 'code-from-the-sdk' },
    });
    expect(unreachable.statusCode).toBe(502);
    expect(unreachable.json()).toMatchObject({ message: "Couldn't reach Discord" });

    vi.restoreAllMocks();
    // The code is good, but the token is not accepted when asking who the user is.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      return Promise.resolve(
        url.includes('/oauth2/token')
          ? Response.json({ access_token: 'token-abc', scope: 'identify' })
          : Response.json({ message: '401: Unauthorized' }, { status: 401 }),
      );
    });
    const noUser = await app.inject({
      method: 'POST',
      url: ACTIVITY_SIGN_IN_PATH,
      headers: FRAME,
      payload: { code: 'code-from-the-sdk' },
    });
    expect(noUser.statusCode).toBe(502);
    expect(noUser.body).not.toContain('token-abc');
    expect(rawCookies(noUser)).toEqual([]);
  });

  it('refuses a request without a usable code, and never calls Discord for it', async () => {
    const calls = vi.spyOn(globalThis, 'fetch');

    for (const payload of [{}, { code: '' }, { code: 'x'.repeat(513) }]) {
      const response = await app.inject({
        method: 'POST',
        url: ACTIVITY_SIGN_IN_PATH,
        headers: FRAME,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload).slice(0, 40)).toBe(400);
    }

    expect(calls).not.toHaveBeenCalled();
  });
});

describe('Activity sign-in, rate limited', () => {
  it('stops answering one address after too many sign-ins in a minute', async () => {
    const { app } = await buildTestApp({ activity: true, rateLimit: true });
    const user = discordUser({ id: '18601', global_name: 'Eager' });
    await signIn(app, user);
    fakeDiscord(user);
    // Better Auth tells callers apart by the address Cloudflare reports.
    const from = (address: string) => ({ ...FRAME, 'cf-connecting-ip': address });
    const attempt = (address: string) =>
      app.inject({
        method: 'POST',
        url: ACTIVITY_SIGN_IN_PATH,
        headers: from(address),
        payload: { code: 'code-from-the-sdk' },
      });

    for (let n = 0; n < ACTIVITY_SIGN_IN_LIMIT.max; n += 1) {
      expect((await attempt('203.0.113.7')).statusCode, `sign-in ${String(n + 1)}`).toBe(200);
    }
    const tooMany = await attempt('203.0.113.7');
    expect(tooMany.statusCode).toBe(429);
    expect(rawCookies(tooMany)).toEqual([]);
    // Someone else is not held up by it.
    expect((await attempt('203.0.113.8')).statusCode).toBe(200);

    vi.restoreAllMocks();
    await app.close();
  });
});

describe('without ACTIVITY', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('has no sign-in for the frame, and says nothing about an Activity', async () => {
    const fetched = vi.spyOn(globalThis, 'fetch');

    const response = await app.inject({
      method: 'POST',
      url: ACTIVITY_SIGN_IN_PATH,
      headers: FRAME,
      payload: { code: 'code-from-the-sdk' },
    });

    expect(response.statusCode).toBe(404);
    expect(fetched).not.toHaveBeenCalled();
    expect((await app.inject({ url: '/api/activity/config' })).statusCode).toBe(404);
    vi.restoreAllMocks();
  });

  it('treats Discord’s proxy as any other site', async () => {
    const cookie = await signIn(app, discordUser({ id: '18701', global_name: 'Tab Only' }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { ...FRAME, cookie },
      payload: { name: 'From A Frame' },
    });

    expect(response.statusCode).toBe(403);
  });
});
