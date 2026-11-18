import { ACTIVITY_NO_ACCOUNT, ACTIVITY_SIGN_IN_PATH, type MeResponse } from '@stagehand/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivitySdk } from './discord';
import {
  enterActivity,
  enterOnce,
  ENTRY_MESSAGES,
  firstArrival,
  forgetEntry,
  type EnterDeps,
} from './enter';

const ME: MeResponse = {
  id: '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11',
  displayName: 'Mira',
  hasCustomDisplayName: false,
  discordUsername: 'mira',
  avatarUrl: null,
};

interface World {
  config: unknown;
  /** What the sign-in route answers. */
  signIn: () => Response;
  /** What `/api/me` answers after the sign-in. */
  me: () => Response;
  sdk: Partial<ActivitySdk>;
}

/** A server and a Discord client that let everyone in, changed per test. */
function setup(overrides: Partial<World> = {}) {
  const world: World = {
    config: { clientId: 'client-123', signIn: true, test: false },
    signIn: () => Response.json({ accessToken: 'token-abc', scopes: ['identify'] }),
    me: () => Response.json(ME),
    sdk: {},
    ...overrides,
  };
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const asked: { clientIds: string[]; scopes: unknown[]; tokens: string[] } = {
    clientIds: [],
    scopes: [],
    tokens: [],
  };

  const deps: EnterDeps = {
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
      if (url === '/api/activity/config') {
        return Promise.resolve(
          world.config === null
            ? Response.json({ error: 'Not Found' }, { status: 404 })
            : Response.json(world.config),
        );
      }
      if (url === ACTIVITY_SIGN_IN_PATH) return Promise.resolve(world.signIn());
      if (url === '/api/me') return Promise.resolve(world.me());
      return Promise.reject(new Error(`unexpected request to ${url}`));
    },
    sdk: (clientId) => {
      asked.clientIds.push(clientId);
      return {
        platform: 'desktop',
        ready: () => Promise.resolve(),
        authorize: (scopes) => {
          asked.scopes.push([...scopes]);
          return Promise.resolve('code-1');
        },
        authenticate: (token) => {
          asked.tokens.push(token);
          return Promise.resolve({ scopes: ['identify', 'rpc.voice.read'], userId: 'discord-1' });
        },
        subscribeSpeaking: () => Promise.resolve(() => undefined),
        ...world.sdk,
      };
    },
  };
  return { deps, calls, bodies, asked };
}

beforeEach(() => {
  forgetEntry();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('enterActivity', () => {
  it('asks Discord who the player is, signs in with the code, and checks the cookie stuck', async () => {
    const { deps, calls, bodies, asked } = setup();

    expect(await enterActivity(deps)).toEqual({
      status: 'signed-in',
      me: ME,
      test: false,
      voice: null,
    });

    expect(calls).toEqual([
      'GET /api/activity/config',
      `POST ${ACTIVITY_SIGN_IN_PATH}`,
      'GET /api/me',
    ]);
    expect(bodies).toEqual([{ code: 'code-1' }]);
    expect(asked).toEqual({
      clientIds: ['client-123'],
      // Who they are, and who talks (F3.9).
      scopes: [['identify', 'rpc.voice.read']],
      // Discord granted only who they are: the SDK isn't signed in, and the table uses T.
      tokens: [],
    });
  });

  it('signs the SDK in to hear who talks when Discord grants it (F3.9)', async () => {
    const { deps, asked } = setup({
      signIn: () =>
        Response.json({ accessToken: 'token-abc', scopes: ['identify', 'rpc.voice.read'] }),
    });

    const entry = await enterActivity(deps);

    expect(entry).toMatchObject({ status: 'signed-in', voice: { discordUserId: 'discord-1' } });
    // Discord takes it once per launch: here, for the table and the Activity test alike.
    expect(asked.tokens).toEqual(['token-abc']);
  });

  it('still signs in when the voice is turned down, or the SDK’s sign-in fails (F3.9)', async () => {
    let tries = 0;
    const declined = setup({
      sdk: {
        authorize: (scopes) => {
          tries += 1;
          return scopes.includes('rpc.voice.read')
            ? Promise.reject(new Error('User denied'))
            : Promise.resolve('code-2');
        },
      },
    });
    expect(await enterActivity(declined.deps)).toMatchObject({ status: 'signed-in', voice: null });
    expect(tries).toBe(2);
    expect(declined.bodies).toEqual([{ code: 'code-2' }]);

    const failing = setup({
      signIn: () =>
        Response.json({ accessToken: 'token-abc', scopes: ['identify', 'rpc.voice.read'] }),
      sdk: { authenticate: () => Promise.reject(new Error('Already authenticated (code 4002)')) },
    });
    expect(await enterActivity(failing.deps)).toMatchObject({ status: 'signed-in', voice: null });
  });

  it('says when the test page is served too', async () => {
    const { deps } = setup({ config: { clientId: 'client-123', signIn: true, test: true } });

    expect(await enterActivity(deps)).toMatchObject({ status: 'signed-in', test: true });
  });

  it.each([
    ['has no Activity', null],
    ['serves only the test', { clientId: 'client-123', test: true }],
    ['answers something else', { hello: 'world' }],
  ])(
    'leaves it to the test page when the server %s, and never wakes Discord',
    async (_, config) => {
      const { deps, calls, asked } = setup({ config });

      expect(await enterActivity(deps)).toEqual({ status: 'test-only' });
      expect(calls).toEqual(['GET /api/activity/config']);
      expect(asked.clientIds).toEqual([]);
    },
  );

  it('leaves it to the test page when the server can’t be reached at all', async () => {
    const { deps } = setup();
    deps.fetch = () => Promise.reject(new TypeError('Failed to fetch'));

    expect(await enterActivity(deps)).toEqual({ status: 'test-only' });
  });

  it('gives up on a Discord client that never answers', async () => {
    vi.useFakeTimers();
    const { deps, calls } = setup({ sdk: { ready: () => new Promise(() => undefined) } });

    const entering = enterActivity(deps);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await entering).toEqual({ status: 'failed', message: ENTRY_MESSAGES.discordSilent });
    expect(calls).toEqual(['GET /api/activity/config']);
  });

  it('says what to do when the player does not authorize', async () => {
    const { deps, calls } = setup({
      sdk: { authorize: () => Promise.reject(new Error('User denied')) },
    });

    expect(await enterActivity(deps)).toEqual({
      status: 'failed',
      message: ENTRY_MESSAGES.declined,
    });
    expect(calls).not.toContain(`POST ${ACTIVITY_SIGN_IN_PATH}`);
  });

  it('passes on what the server says to someone with no Stagehand account', async () => {
    const { deps, asked, calls } = setup({
      signIn: () =>
        Response.json(
          { code: ACTIVITY_NO_ACCOUNT, message: 'Join in a browser first.' },
          { status: 404 },
        ),
    });

    expect(await enterActivity(deps)).toEqual({
      status: 'no-account',
      message: 'Join in a browser first.',
    });
    expect(asked.tokens).toEqual([]);
    expect(calls).not.toContain('GET /api/me');
  });

  it.each([
    [429, { message: 'Too many requests.' }, ENTRY_MESSAGES.tooMany],
    [502, { message: "Couldn't reach Discord" }, ENTRY_MESSAGES.server],
    [400, { message: 'Discord refused the code (400)' }, 'Discord refused the code (400)'],
    [403, null, ENTRY_MESSAGES.server],
    // A 404 that is not ours: the route itself is missing.
    [404, { error: 'Not Found' }, ENTRY_MESSAGES.server],
  ])('explains a %i from sign-in', async (status, body, message) => {
    const { deps } = setup({
      signIn: () =>
        body === null ? new Response('nope', { status }) : Response.json(body, { status }),
    });

    expect(await enterActivity(deps)).toEqual({ status: 'failed', message });
  });

  it('says so when sign-in answers nonsense or not at all', async () => {
    const garbled = setup({ signIn: () => Response.json({ token: 'wrong shape' }) });
    expect(await enterActivity(garbled.deps)).toEqual({
      status: 'failed',
      message: ENTRY_MESSAGES.server,
    });

    const down = setup({
      signIn: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(await enterActivity(down.deps)).toEqual({
      status: 'failed',
      message: ENTRY_MESSAGES.server,
    });
  });

  it('notices a Discord client that does not keep the sign-in cookie', async () => {
    const { deps } = setup({ me: () => Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    expect(await enterActivity(deps)).toEqual({ status: 'cookie-blocked' });
  });
});

describe('enterOnce', () => {
  it('signs in once per try, however often it is asked', async () => {
    const { deps, calls } = setup();

    const [first, second] = await Promise.all([enterOnce(0, deps), enterOnce(0, deps)]);

    expect(first).toBe(second);
    expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(1);

    await enterOnce(1, deps);
    expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(2);
  });
});

describe('firstArrival', () => {
  it('is true once per page load', () => {
    expect(firstArrival()).toBe(true);
    expect(firstArrival()).toBe(false);

    forgetEntry();
    expect(firstArrival()).toBe(true);
  });
});
