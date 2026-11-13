/**
 * Integration-test helpers: build the app against the test database, and sign in through
 * the real Better Auth handler with Discord's token and profile endpoints faked (CI can't
 * do real OAuth).
 */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect, inject, vi } from 'vitest';

import { loadImportSystemPrompt } from '../src/ai-import/prompt';
import { buildApp, type BuildAppOptions } from '../src/app';
import { createAuth } from '../src/auth/auth';
import { createDb, type DbHandle } from '../src/db/client';
import type { AnthropicProvider } from '../src/providers/anthropic';
import type { CredentialDeps } from '../src/routes/provider-credentials';

export const PUBLIC_URL = 'http://localhost:5173';
export const DISCORD_CLIENT_ID = 'test-client-id';
/** Headers that pass the CSRF origin check on writes. */
export const SAME_ORIGIN = { origin: PUBLIC_URL };
/** CREDENTIALS_ENCRYPTION_KEY for integration tests. */
export const TEST_CREDENTIALS_KEY = Buffer.alloc(32, 0x5a);

export interface FakeDiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  email: string | null;
  verified: boolean;
}

/**
 * The full app (auth, CSRF, every API route) on the shared test database. The app owns the
 * pool, so `app.close()` ends it.
 */
export async function buildTestApp(
  options: Pick<BuildAppOptions, 'logger'> & {
    anthropic?: Partial<AnthropicProvider>;
    openrouter?: Partial<CredentialDeps['openrouter']>;
  } = {},
): Promise<{ app: FastifyInstance; handle: DbHandle }> {
  const handle = createDb(inject('databaseUrl'), { max: 2 });
  const auth = createAuth({
    db: handle.db,
    publicUrl: PUBLIC_URL,
    secret: 'integration-test-secret-at-least-32-chars',
    discord: { clientId: DISCORD_CLIENT_ID, clientSecret: 'test-client-secret' },
  });
  const app = buildApp({
    db: handle,
    auth,
    publicUrl: PUBLIC_URL,
    logger: options.logger,
    credentials: {
      key: TEST_CREDENTIALS_KEY,
      // No test may reach Anthropic: every call is a fake, and the ones a test didn't
      // provide answer as if Anthropic were down.
      anthropic: {
        checkKey: () => Promise.resolve('ok'),
        generateImport: () => Promise.resolve({ status: 'unreachable' }),
        countImportTokens: () => Promise.resolve({ status: 'unreachable' }),
        ...options.anthropic,
      },
      // No test may reach OpenRouter either.
      openrouter: {
        checkKey: () => Promise.resolve('ok'),
        ...options.openrouter,
      },
    },
    importPrompt: loadImportSystemPrompt(),
  });
  await app.ready();
  return { app, handle };
}

export function discordUser(overrides: Partial<FakeDiscordUser> & { id: string }): FakeDiscordUser {
  return {
    username: `user${overrides.id}`,
    global_name: `User ${overrides.id}`,
    avatar: 'abc123',
    email: `user${overrides.id}@example.com`,
    verified: true,
    ...overrides,
  };
}

/** Routes Discord API calls to a fake; everything else goes to the real fetch. */
export function fakeDiscord(user: FakeDiscordUser): void {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'discord.com') return realFetch(input, init);
    // Better Auth requests `/users/@me` with the `@` percent-encoded.
    const path = decodeURIComponent(url.pathname);

    if (path === '/api/oauth2/token') {
      return Response.json({
        access_token: `access-${user.id}`,
        refresh_token: `refresh-${user.id}`,
        token_type: 'Bearer',
        expires_in: 604800,
        scope: 'identify email',
      });
    }
    if (path === '/api/users/@me') {
      return Response.json({
        discriminator: '0',
        mfa_enabled: false,
        banner: null,
        accent_color: null,
        locale: 'en-US',
        flags: 0,
        premium_type: 0,
        public_flags: 0,
        ...user,
      });
    }
    return new Response('unexpected Discord call', { status: 500 });
  });
}

/** name=value pairs from Set-Cookie headers, merged into a Cookie header value. */
export function cookieHeader(...responses: LightMyRequestResponse[]): string {
  const jar = new Map<string, string>();
  for (const response of responses) {
    const raw = response.headers['set-cookie'];
    for (const cookie of Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]) {
      const [pair] = cookie.split(';');
      const [name, ...value] = (pair ?? '').split('=');
      if (name) jar.set(name.trim(), value.join('='));
    }
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** Starts Discord sign-in; returns the response and the Discord authorize URL. */
export async function startSignIn(app: FastifyInstance, extra: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/social',
    headers: SAME_ORIGIN,
    payload: { provider: 'discord', callbackURL: '/', ...extra },
  });
  expect(response.statusCode).toBe(200);
  const { url } = response.json<{ url: string }>();
  return { response, authorizeUrl: new URL(url) };
}

/** Full sign-in as `user`; returns the Cookie header for the new session. */
export async function signIn(
  app: FastifyInstance,
  user: FakeDiscordUser,
  extra: Record<string, unknown> = {},
): Promise<string> {
  fakeDiscord(user);
  const { response: start, authorizeUrl } = await startSignIn(app, extra);
  const state = authorizeUrl.searchParams.get('state') ?? '';

  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback/discord?code=fake-code&state=${encodeURIComponent(state)}`,
    headers: { cookie: cookieHeader(start) },
  });

  expect(callback.statusCode).toBe(302);
  // Better Auth reports callback failures as a redirect to /api/auth/error?error=<code>.
  const location = String(callback.headers.location);
  expect(location.includes('/error'), `callback failed: ${location}`).toBe(false);
  vi.restoreAllMocks();
  return cookieHeader(callback);
}
