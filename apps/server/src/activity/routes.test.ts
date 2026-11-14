import {
  activityConfigResponseSchema,
  activityProbeResponseSchema,
  activityTokenResponseSchema,
} from '@stagehand/shared';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';

import { PROBE_COOKIE } from './routes';

const DISCORD = { clientId: 'client-123', clientSecret: 'secret-456' };
const JSON_HEADERS = { 'content-type': 'application/json' };

/** Answers the next call to Discord's token endpoint; returns what was sent to it. */
function fakeDiscordToken(answer: () => Response | Promise<Response>) {
  const sent: { url: string; body: URLSearchParams }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    sent.push({
      url: input instanceof Request ? input.url : String(input),
      // The route sends a form.
      body: init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(),
    });
    return answer();
  });
  return sent;
}

describe('Activity test routes', () => {
  const app = buildApp({ activityTest: { discord: DISCORD } });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives the page the Discord client id, and never the secret', async () => {
    const response = await app.inject({ url: '/api/activity/config' });

    expect(response.statusCode).toBe(200);
    expect(activityConfigResponseSchema.parse(response.json())).toEqual({ clientId: 'client-123' });
    expect(response.body).not.toContain(DISCORD.clientSecret);
  });

  it('reports the origin headers it saw and sets a cookie a frame may keep', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/activity/probe',
      headers: {
        ...JSON_HEADERS,
        origin: 'https://client-123.discordsays.com',
        'sec-fetch-site': 'same-origin',
        host: 'example.trycloudflare.com',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(activityProbeResponseSchema.parse(response.json())).toEqual({
      origin: 'https://client-123.discordsays.com',
      secFetchSite: 'same-origin',
      host: 'example.trycloudflare.com',
      cookieCameBack: false,
    });
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`^${PROBE_COOKIE}=[A-Za-z0-9_-]{16};`));
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=None', 'Partitioned', 'Max-Age=600']) {
      expect(cookie, attribute).toContain(attribute);
    }
  });

  it('says so when the probe cookie comes back', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/activity/probe',
      headers: { ...JSON_HEADERS, cookie: `other=1; ${PROBE_COOKIE}=abc` },
      payload: {},
    });

    expect(response.json()).toMatchObject({
      origin: null,
      secFetchSite: null,
      cookieCameBack: true,
    });
  });

  it("exchanges a code for the user's token with the app's client secret", async () => {
    const sent = fakeDiscordToken(() =>
      Response.json({
        access_token: 'token-abc',
        token_type: 'Bearer',
        expires_in: 604800,
        refresh_token: 'refresh-abc',
        scope: 'identify rpc.voice.read',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/activity/token',
      headers: JSON_HEADERS,
      payload: { code: 'code-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(activityTokenResponseSchema.parse(response.json())).toEqual({
      accessToken: 'token-abc',
      scopes: ['identify', 'rpc.voice.read'],
    });
    // The refresh token and the secret stay on the server.
    expect(response.body).not.toContain('refresh-abc');
    expect(response.body).not.toContain(DISCORD.clientSecret);
    expect(response.headers['cache-control']).toBe('no-store');

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://discord.com/api/oauth2/token');
    expect(Object.fromEntries(sent[0]?.body ?? [])).toEqual({
      client_id: 'client-123',
      client_secret: 'secret-456',
      grant_type: 'authorization_code',
      code: 'code-1',
    });
  });

  it('answers 400 when Discord refuses the code, without repeating what Discord said', async () => {
    fakeDiscordToken(() =>
      Response.json(
        { error: 'invalid_grant', error_description: 'code-1 is bad' },
        { status: 400 },
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/activity/token',
      headers: JSON_HEADERS,
      payload: { code: 'code-1' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: 'Discord refused the code (400)' });
    expect(response.body).not.toContain('invalid_grant');
  });

  it('answers 502 when Discord cannot be reached or sends no token', async () => {
    fakeDiscordToken(() => Promise.reject(new TypeError('fetch failed')));
    const unreachable = await app.inject({
      method: 'POST',
      url: '/api/activity/token',
      headers: JSON_HEADERS,
      payload: { code: 'code-1' },
    });
    expect(unreachable.statusCode).toBe(502);
    expect(unreachable.json()).toMatchObject({ message: "Couldn't reach Discord" });

    vi.restoreAllMocks();
    fakeDiscordToken(() => new Response('<html>busy</html>'));
    const garbled = await app.inject({
      method: 'POST',
      url: '/api/activity/token',
      headers: JSON_HEADERS,
      payload: { code: 'code-1' },
    });
    expect(garbled.statusCode).toBe(502);
  });

  it('refuses a request without a code, and never calls Discord for it', async () => {
    const sent = fakeDiscordToken(() => Response.json({}));

    const response = await app.inject({
      method: 'POST',
      url: '/api/activity/token',
      headers: JSON_HEADERS,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("leaves the frame-blocking header alone: Discord's proxy replaces it (D-48)", async () => {
    const response = await app.inject({ url: '/health' });

    expect(response.headers['content-security-policy']).toBe("frame-ancestors 'self'");
  });
});

describe('without ACTIVITY_TEST', () => {
  it('serves none of it, and nobody may frame the app', async () => {
    const app = buildApp();

    expect((await app.inject({ url: '/api/activity/config' })).statusCode).toBe(404);
    const probe = await app.inject({ method: 'POST', url: '/api/activity/probe', payload: {} });
    expect(probe.statusCode).toBe(404);
    expect(probe.headers['set-cookie']).toBeUndefined();
    expect(probe.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    await app.close();
  });
});
