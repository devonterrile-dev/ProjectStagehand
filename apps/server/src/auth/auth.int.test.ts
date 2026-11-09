/**
 * Sign in with Discord, end to end through the real Better Auth handler and a real
 * Postgres, with Discord's token and profile endpoints faked (CI can't do real OAuth).
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildTestApp,
  DISCORD_CLIENT_ID,
  discordUser,
  PUBLIC_URL,
  SAME_ORIGIN,
  signIn as signInAs,
  startSignIn as startSignInOn,
  type FakeDiscordUser,
} from '../../test/auth-helpers';
import type { DbHandle } from '../db/client';
import { accounts, sessions, users } from '../db/schema';

import { placeholderEmail } from './auth';

describe('Sign in with Discord', () => {
  let handle: DbHandle;
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close(); // also ends the pool
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function startSignIn(extra: Record<string, unknown> = {}) {
    return startSignInOn(app, extra);
  }

  function signIn(user: FakeDiscordUser, extra: Record<string, unknown> = {}): Promise<string> {
    return signInAs(app, user, extra);
  }

  async function getMe(cookie: string) {
    return app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
  }

  it('starts sign-in with a Discord authorize URL for our app', async () => {
    const { authorizeUrl } = await startSignIn();

    expect(authorizeUrl.origin).toBe('https://discord.com');
    expect(authorizeUrl.searchParams.get('client_id')).toBe(DISCORD_CLIENT_ID);
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
      `${PUBLIC_URL}/api/auth/callback/discord`,
    );
    expect(authorizeUrl.searchParams.get('scope')?.split(' ').sort()).toEqual([
      'email',
      'identify',
    ]);
  });

  it('creates the user, Discord account and session on callback', async () => {
    const cookie = await signIn(discordUser({ id: '1001', username: 'mira', global_name: 'Mira' }));

    expect(cookie).toMatch(/session_token=/);

    const [user] = await handle.db.select().from(users).where(eq(users.discordId, '1001'));
    expect(user).toMatchObject({
      name: 'Mira',
      discordUsername: 'mira',
      email: 'user1001@example.com',
      emailVerified: true,
      image: 'https://cdn.discordapp.com/avatars/1001/abc123.png',
      displayName: null,
    });
    expect(user?.id).toMatch(/^[0-9a-f-]{36}$/);

    const linked = await handle.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, user?.id ?? ''));
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ providerId: 'discord', accountId: '1001' });
    // OAuth tokens are encrypted at rest, never stored as issued.
    expect(linked[0]?.accessToken).not.toBe('access-1001');
  });

  it('returns the profile for a valid session, and 401 without one', async () => {
    const cookie = await signIn(discordUser({ id: '1002', username: 'tomas', global_name: null }));

    const me = await getMe(cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      displayName: 'tomas', // no global name: falls back to the username
      hasCustomDisplayName: false,
      discordUsername: 'tomas',
      avatarUrl: 'https://cdn.discordapp.com/avatars/1002/abc123.png',
    });

    expect((await getMe('')).statusCode).toBe(401);
    expect((await getMe('better-auth.session_token=forged')).statusCode).toBe(401);
  });

  it('ignores Discord identity fields smuggled in by the client', async () => {
    // discordId/discordUsername are `input: true` so mapProfileToUser can set them; make sure
    // the sign-in request body can't.
    await signIn(discordUser({ id: '1007', username: 'honest' }), {
      additionalData: { discordId: 'spoofed', discordUsername: 'spoofed' },
      discordId: 'spoofed',
    });

    const [user] = await handle.db.select().from(users).where(eq(users.discordId, '1007'));
    expect(user?.discordUsername).toBe('honest');
    expect(await handle.db.select().from(users).where(eq(users.discordId, 'spoofed'))).toEqual([]);
  });

  it('gives phone-only Discord accounts a placeholder email', async () => {
    await signIn(discordUser({ id: '1003', email: null, verified: false }));

    const [user] = await handle.db.select().from(users).where(eq(users.discordId, '1003'));
    expect(user?.email).toBe(placeholderEmail('1003'));
    expect(user?.emailVerified).toBe(false);
  });

  it('refreshes Discord name and avatar on sign-in but keeps a custom display name', async () => {
    const first = await signIn(discordUser({ id: '1004', global_name: 'Old Name' }));
    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { ...SAME_ORIGIN, cookie: first },
      payload: { displayName: 'Captain Vex' },
    });
    expect(patched.statusCode).toBe(200);

    const second = await signIn(
      discordUser({ id: '1004', global_name: 'New Name', avatar: 'def456' }),
    );

    const [user] = await handle.db.select().from(users).where(eq(users.discordId, '1004'));
    expect(user).toMatchObject({
      name: 'New Name',
      image: 'https://cdn.discordapp.com/avatars/1004/def456.png',
      displayName: 'Captain Vex',
    });
    expect((await getMe(second)).json()).toMatchObject({
      displayName: 'Captain Vex',
      hasCustomDisplayName: true,
    });
  });

  describe('PATCH /api/me', () => {
    let cookie: string;

    beforeAll(async () => {
      cookie = await signIn(discordUser({ id: '1005', global_name: 'Discord Name' }));
    });

    async function patch(payload: unknown, headers: Record<string, string> = SAME_ORIGIN) {
      return app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: { ...headers, cookie },
        payload: payload as Record<string, unknown>,
      });
    }

    it('sets a trimmed display name', async () => {
      const response = await patch({ displayName: '  Lady Ash  ' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        displayName: 'Lady Ash',
        hasCustomDisplayName: true,
      });
    });

    it('resets to the Discord name with null', async () => {
      const response = await patch({ displayName: null });

      expect(response.json()).toMatchObject({
        displayName: 'Discord Name',
        hasCustomDisplayName: false,
      });
    });

    it('rejects empty, too-long and unknown fields with 400', async () => {
      expect((await patch({ displayName: '   ' })).statusCode).toBe(400);
      expect((await patch({ displayName: 'x'.repeat(33) })).statusCode).toBe(400);
      expect((await patch({ displayName: 'ok', discordId: '1' })).statusCode).toBe(400);
    });

    it('rejects cross-origin and origin-less requests with 403', async () => {
      expect(
        (await patch({ displayName: 'Evil' }, { origin: 'https://evil.example' })).statusCode,
      ).toBe(403);
      expect((await patch({ displayName: 'Evil' }, {})).statusCode).toBe(403);

      const [user] = await handle.db.select().from(users).where(eq(users.discordId, '1005'));
      expect(user?.displayName).not.toBe('Evil');
    });

    it('requires a session', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: SAME_ORIGIN,
        payload: { displayName: 'Nobody' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  it('signs out: the session is deleted and the cookie stops working', async () => {
    const cookie = await signIn(discordUser({ id: '1006' }));
    const [user] = await handle.db.select().from(users).where(eq(users.discordId, '1006'));

    const signOut = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { ...SAME_ORIGIN, cookie },
    });
    expect(signOut.statusCode).toBe(200);

    expect((await getMe(cookie)).statusCode).toBe(401);
    const remaining = await handle.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user?.id ?? ''));
    expect(remaining).toHaveLength(0);
  });

  it('disables Better Auth endpoints Stagehand does not use', async () => {
    for (const url of [
      '/api/auth/update-user',
      '/api/auth/sign-up/email',
      '/api/auth/delete-user',
    ]) {
      const response = await app.inject({ method: 'POST', url, headers: SAME_ORIGIN, payload: {} });
      expect(response.statusCode, url).toBe(404);
    }
  });
});
