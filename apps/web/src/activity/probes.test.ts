import { describe, expect, it, vi } from 'vitest';

import type { ActivitySdk, SpeakingKind } from './discord';
import {
  describeError,
  NOT_IN_DISCORD,
  runProbes,
  type ProbeDeps,
  type ProbeId,
  type ProbeResult,
} from './probes';

interface World {
  /** Which path forms reach the server. */
  plain?: boolean;
  proxied?: boolean;
  /** Does the probe cookie come back on the second request? */
  cookie?: boolean;
  policy?: string | null;
}

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : input.toString();

/** A fake of the server as the page reaches it; records every request made. */
function fakeFetch(world: World = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let probes = 0;
  const fetchFn: typeof fetch = (input, init) => {
    const url = urlOf(input);
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });

    const proxied = url.startsWith('/.proxy');
    const path = proxied ? url.slice('/.proxy'.length) : url;
    const reachable = proxied ? (world.proxied ?? false) : (world.plain ?? true);
    if (!path.startsWith('/api/')) {
      const headers = new Headers();
      if (world.policy != null) headers.set('content-security-policy', world.policy);
      return Promise.resolve(new Response('<html></html>', { headers }));
    }
    if (!reachable) return Promise.resolve(Response.json({ error: 'Not Found' }, { status: 404 }));
    if (path === '/api/activity/config') {
      return Promise.resolve(Response.json({ clientId: 'client-123' }));
    }
    if (path === '/api/activity/probe') {
      probes += 1;
      return Promise.resolve(
        Response.json({
          origin: 'https://client-123.discordsays.com',
          secFetchSite: 'same-origin',
          host: 'stagehand.example',
          cookieCameBack: probes > 1 && (world.cookie ?? true),
        }),
      );
    }
    if (path === '/api/activity/token') {
      return Promise.resolve(
        Response.json({ accessToken: 'token-abc', scopes: ['identify', 'rpc.voice.read'] }),
      );
    }
    return Promise.resolve(new Response('not mocked', { status: 500 }));
  };
  return { fetchFn, calls };
}

function fakeSdk(overrides: Partial<ActivitySdk> = {}) {
  let listener: ((kind: SpeakingKind, userId: string) => void) | null = null;
  const stop = vi.fn();
  const sdk: ActivitySdk = {
    platform: 'desktop',
    ready: () => Promise.resolve(),
    authorize: () => Promise.resolve('code-1'),
    authenticate: () => Promise.resolve({ scopes: ['identify', 'rpc.voice.read'], userId: 'd-1' }),
    subscribeSpeaking: (given) => {
      listener = given;
      return Promise.resolve(stop);
    },
    ...overrides,
  };
  return { sdk, stop, say: (kind: SpeakingKind, userId: string) => listener?.(kind, userId) };
}

/** Runs the probes against fakes; returns what was reported. */
async function run(deps: Partial<ProbeDeps>, cancelAfter?: ProbeId) {
  const results: Partial<Record<ProbeId, ProbeResult>> = {};
  const heard: [SpeakingKind, string][] = [];
  const disposers: (() => void)[] = [];
  let cancelled = false;
  let clock = 0;

  const available = await runProbes(
    {
      fetch: fakeFetch().fetchFn,
      inFrame: true,
      pageUrl: '/?frame_id=f-1',
      sdk: () => fakeSdk().sdk,
      socketProbe: () =>
        Promise.resolve({ transport: 'websocket', startedOn: 'polling', roundTripMs: 41.6 }),
      now: () => (clock += 100),
      ...deps,
    },
    {
      cancelled: () => cancelled,
      result: (id, result) => {
        results[id] = result;
        if (id === cancelAfter) cancelled = true;
      },
      speaking: (kind, userId) => heard.push([kind, userId]),
      cleanup: (dispose) => disposers.push(dispose),
    },
  );
  return { available, results, heard, disposers };
}

describe('runProbes', () => {
  it('reports every probe inside Discord, using the path form that works', async () => {
    const { fetchFn, calls } = fakeFetch({
      plain: false,
      proxied: true,
      policy: "frame-ancestors 'self' https://discord.com",
    });
    const socketProbe = vi.fn(() =>
      Promise.resolve({ transport: 'websocket', startedOn: 'polling', roundTripMs: 41.6 }),
    );
    const discord = fakeSdk();

    const { available, results, heard, disposers } = await run({
      fetch: fetchFn,
      sdk: () => discord.sdk,
      socketProbe,
    });
    discord.say('start', 'user-9');

    expect(available).toBe(true);
    expect(results).toEqual({
      paths: { status: 'ok', detail: '/api answered 404; /.proxy/api works' },
      headers: {
        status: 'ok',
        detail: "Content-Security-Policy: frame-ancestors 'self' https://discord.com",
      },
      origin: {
        status: 'ok',
        detail:
          'Origin https://client-123.discordsays.com, Sec-Fetch-Site same-origin, Host stagehand.example',
      },
      cookie: { status: 'ok', detail: 'a SameSite=None; Secure; Partitioned cookie came back' },
      socket: { status: 'ok', detail: 'websocket, after starting on polling; echo in 42 ms' },
      sdk: { status: 'ok', detail: 'ready in 100 ms, platform desktop' },
      signIn: { status: 'ok', detail: 'scopes identify, rpc.voice.read' },
      speaking: { status: 'ok', detail: 'subscribed' },
    });
    expect(socketProbe).toHaveBeenCalledWith('/.proxy/socket.io');
    expect(calls).toContainEqual({
      url: '/.proxy/api/activity/token',
      method: 'POST',
      body: { code: 'code-1' },
    });
    expect(heard).toEqual([['start', 'user-9']]);
    expect(disposers).toEqual([discord.stop]);
  });

  it('skips the Discord probes in a normal tab', async () => {
    const sdk = vi.fn(() => fakeSdk().sdk);

    const { results } = await run({ inFrame: false, sdk });

    expect(results.paths).toEqual({ status: 'ok', detail: '/api works; /.proxy/api answered 404' });
    expect(results.headers).toEqual({ status: 'ok', detail: 'no Content-Security-Policy header' });
    for (const id of ['sdk', 'signIn', 'speaking'] as const) {
      expect(results[id]).toEqual({ status: 'skipped', detail: NOT_IN_DISCORD });
    }
    expect(sdk).not.toHaveBeenCalled();
  });

  it('stops after the first probe when the server does not serve the test', async () => {
    const { fetchFn } = fakeFetch({ plain: false, proxied: false });

    const { available, results } = await run({ fetch: fetchFn });

    expect(available).toBe(false);
    expect(results).toEqual({
      paths: { status: 'failed', detail: '/api answered 404; /.proxy/api answered 404' },
    });
  });

  it('says a request was blocked when the browser refuses to send it', async () => {
    const { fetchFn } = fakeFetch();
    const blocking: typeof fetch = (input, init) =>
      urlOf(input).startsWith('/.proxy')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : fetchFn(input, init);

    const { results } = await run({ fetch: blocking, inFrame: false });

    expect(results.paths?.detail).toBe('/api works; /.proxy/api was blocked');
  });

  it('fails the cookie probe when the cookie does not come back', async () => {
    const { results } = await run({ fetch: fakeFetch({ cookie: false }).fetchFn, inFrame: false });

    expect(results.origin?.status).toBe('ok');
    expect(results.cookie).toEqual({
      status: 'failed',
      detail: 'a SameSite=None; Secure; Partitioned cookie did not come back',
    });
  });

  it('fails the socket probe alone when nothing connects', async () => {
    const { results } = await run({
      socketProbe: () => Promise.reject(new Error('websocket error')),
    });

    expect(results.socket).toEqual({
      status: 'failed',
      detail: 'could not connect: websocket error',
    });
    expect(results.sdk?.status).toBe('ok');
  });

  it('says so when the socket never becomes a websocket', async () => {
    const { results } = await run({
      socketProbe: () =>
        Promise.resolve({ transport: 'polling', startedOn: 'polling', roundTripMs: 120 }),
    });

    expect(results.socket).toEqual({
      status: 'ok',
      detail: 'polling only: no websocket got through; echo in 120 ms',
    });
  });

  it('signs in without the voice scope when Discord refuses it, and fails speaking', async () => {
    const asked: string[][] = [];
    const discord = fakeSdk({
      authorize: (scopes) => {
        asked.push([...scopes]);
        if (!scopes.includes('rpc.voice.read')) return Promise.resolve('code-2');
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Discord's SDK rejects with a plain object, which is what is being tested
        return Promise.reject({ code: 5000, message: 'OAuth2 Error: invalid_scope' });
      },
      authenticate: () => Promise.resolve({ scopes: ['identify'], userId: 'd-1' }),
    });

    const { results } = await run({ sdk: () => discord.sdk });

    expect(asked).toEqual([['identify', 'rpc.voice.read'], ['identify']]);
    expect(results.signIn).toEqual({
      status: 'ok',
      detail:
        'with identify alone: asking for rpc.voice.read as well failed (OAuth2 Error: invalid_scope (code 5000))',
    });
    expect(results.speaking).toEqual({
      status: 'failed',
      detail: 'the rpc.voice.read scope was not granted',
    });
  });

  it('skips sign-in and speaking when the SDK does not connect', async () => {
    const discord = fakeSdk({ ready: () => Promise.reject(new Error('handshake refused')) });

    const { results } = await run({ sdk: () => discord.sdk });

    expect(results.sdk).toEqual({ status: 'failed', detail: 'handshake refused' });
    expect(results.signIn?.status).toBe('skipped');
    expect(results.speaking?.status).toBe('skipped');
  });

  it('fails sign-in when the server cannot exchange the code', async () => {
    const { fetchFn } = fakeFetch();
    const refusing: typeof fetch = (input, init) =>
      urlOf(input).endsWith('/token')
        ? Promise.resolve(Response.json({ message: 'no' }, { status: 400 }))
        : fetchFn(input, init);

    const { results } = await run({ fetch: refusing });

    expect(results.signIn).toEqual({
      status: 'failed',
      detail: 'the server answered 400 for the code',
    });
    expect(results.speaking).toEqual({ status: 'skipped', detail: 'Sign-in failed' });
  });

  it('goes no further once cancelled', async () => {
    const socketProbe = vi.fn(() => Promise.reject(new Error('never asked')));

    const { results } = await run({ socketProbe }, 'cookie');

    expect(Object.keys(results)).toEqual(['paths', 'headers', 'origin', 'cookie']);
    expect(socketProbe).not.toHaveBeenCalled();
  });
});

describe('describeError', () => {
  it("reads an Error, the SDK's plain objects, and anything else", () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError({ code: 4006, message: 'Not authenticated' })).toBe(
      'Not authenticated (code 4006)',
    );
    expect(describeError({ message: 'just words' })).toBe('just words');
    expect(describeError(undefined)).toBe('no reason given');
  });
});
