import {
  ACTIVITY_NO_ACCOUNT,
  ACTIVITY_SIGN_IN_PATH,
  PLAY_SOCKET,
  type Campaign,
} from '@stagehand/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivitySdk } from '@/activity/discord';
import { ENTRY_MESSAGES, forgetEntry } from '@/activity/enter';
import type { PlayCanvasProps } from '@/stage/PlayCanvas';
import { campaign, currentUrl, MIRA, mockApi, renderAt, type FakeWorld } from '@/test/app-harness';
import { fakePlaySocket, type FakePlaySocket } from '@/test/fake-play-socket';
import { gmStage, playerStage, present, SESSION } from '@/test/play-fixtures';

// jsdom has no WebGL: the 3D theater and the stage test are replaced by stand-ins.
vi.mock('@/stage/PlayCanvas', () => ({
  PlayCanvas: (props: PlayCanvasProps) => (
    <div data-testid="play-canvas" data-curtain={props.curtainOpen ? 'open' : 'closed'} />
  ),
}));
vi.mock('@/stage/StageTestCanvas', () => ({
  StageTestCanvas: () => <div data-testid="stage-canvas" />,
}));
vi.mock('@/activity/socket-probe', () => ({
  runSocketProbe: () =>
    Promise.resolve({ transport: 'websocket', startedOn: 'polling', roundTripMs: 12 }),
}));

let socket: FakePlaySocket;
vi.mock('@/play/socket', () => ({ createPlaySocket: () => socket }));
vi.mock('@/play/preload', () => ({ preloadImages: () => Promise.resolve() }));

/** The fake Discord client the page talks to through the SDK, and what it was asked. */
const discord = vi.hoisted(() => ({
  clientIds: [] as string[],
  scopes: [] as string[][],
  tokens: [] as string[],
  /** Whether the player lets Stagehand see who they are. */
  authorizes: true,
}));

vi.mock('@/activity/discord', () => ({
  activitySdk: (clientId: string): ActivitySdk => {
    discord.clientIds.push(clientId);
    return {
      platform: 'desktop',
      ready: () => Promise.resolve(),
      authorize: (scopes) => {
        discord.scopes.push([...scopes]);
        return discord.authorizes
          ? Promise.resolve('code-1')
          : Promise.reject(new Error('User denied'));
      },
      // As Discord does it: a page signs the SDK in once per launch, and no more.
      authenticate: (token) => {
        if (discord.tokens.length > 0) {
          return Promise.reject(new Error('Already authenticated (code 4002)'));
        }
        discord.tokens.push(token);
        return Promise.resolve({ scopes: ['identify', 'rpc.voice.read'], userId: 'discord-1' });
      },
      subscribeSpeaking: () => Promise.resolve(() => undefined),
    };
  },
}));

interface Server {
  /** How sign-in goes; a test may change it between tries. */
  signIn: 'ok' | 'no-account' | 'cookie-lost';
  /** The bodies posted to the sign-in route. */
  codes: unknown[];
}

/**
 * Stagehand with the Activity switched on. Nobody is signed in until the frame signs in:
 * before that every other route answers 401, as the real server would with no cookie.
 */
function activityServer(
  campaigns: Campaign[],
  options: { world?: FakeWorld; test?: boolean; signIn?: Server['signIn'] } = {},
): Server {
  const server: Server = { signIn: options.signIn ?? 'ok', codes: [] };
  const api = mockApi(MIRA, campaigns, options.world);
  const rest = api.getMockImplementation();
  let hasCookie = false;

  api.mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === '/api/activity/config') {
      return Promise.resolve(
        Response.json({ clientId: 'client-123', signIn: true, test: options.test ?? false }),
      );
    }
    if (url === ACTIVITY_SIGN_IN_PATH) {
      server.codes.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
      if (server.signIn === 'no-account') {
        return Promise.resolve(
          Response.json(
            { code: ACTIVITY_NO_ACCOUNT, message: 'Join your campaign in a browser first.' },
            { status: 404 },
          ),
        );
      }
      hasCookie = server.signIn === 'ok';
      return Promise.resolve(Response.json({ accessToken: 'token-abc', scopes: ['identify'] }));
    }
    // The Activity test's own routes, which need no Stagehand sign-in.
    if (options.test === true && url === '/api/activity/probe') {
      return Promise.resolve(
        Response.json({
          origin: 'https://client-123.discordsays.com',
          secFetchSite: 'same-origin',
          host: 'stagehand.example',
          cookieCameBack: true,
        }),
      );
    }
    if (options.test === true && url === '/api/activity/token') {
      return Promise.resolve(
        Response.json({ accessToken: 'test-token', scopes: ['identify', 'rpc.voice.read'] }),
      );
    }
    // The page asking for itself.
    if (!url.startsWith('/api/')) return Promise.resolve(new Response('<html></html>'));
    if (!hasCookie) {
      return Promise.resolve(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    }
    return rest?.(input, init) ?? Promise.reject(new Error('fetch is not mocked'));
  });
  return server;
}

/** Discord opens an Activity at the root path with its launch parameters. */
function openInDiscord() {
  window.history.replaceState({}, '', '/?instance_id=i-1&frame_id=f-1&platform=desktop');
  renderAt('/');
}

const campaignList = () =>
  within(screen.getByRole('list', { name: 'Your campaigns' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

beforeEach(() => {
  forgetEntry();
  socket = fakePlaySocket();
  discord.clientIds.length = 0;
  discord.scopes.length = 0;
  discord.tokens.length = 0;
  discord.authorizes = true;
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('Stagehand inside Discord', () => {
  it('signs the player in through Discord and shows their campaigns', async () => {
    const coast = campaign({ name: 'Painted Coast' });
    const marsh = campaign({ name: 'Salt Marsh', role: 'player' });
    const shelf = campaign({ name: 'Shelved', archivedAt: '2026-11-09T12:00:00.000Z' });
    const server = activityServer([coast, marsh, shelf]);
    openInDiscord();

    expect(await screen.findByText('Signing you in with Discord…')).toBeDefined();
    await waitFor(() => {
      expect(campaignList()).toEqual([
        'Painted CoastGMNo session right now.Open',
        'Salt MarshPlayerNo session right now.Open',
      ]);
    });

    expect(discord.clientIds).toEqual(['client-123']);
    // Who they are, and who talks (F3.9).
    expect(discord.scopes).toEqual([['identify', 'rpc.voice.read']]);
    expect(server.codes).toEqual([{ code: 'code-1' }]);
    // This server granted only who they are, so Discord's SDK is left unsigned.
    expect(discord.tokens).toEqual([]);
    // The Activity is the table, not the workshop: no browser sign-in, no app header.
    expect(screen.queryByRole('button', { name: 'Sign in with Discord' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Activity test' })).toBeNull();
    expect(currentUrl()).toBe('/');
  });

  it('takes the player straight to the table when one campaign has a session running', async () => {
    const coast = campaign({ name: 'Painted Coast', role: 'player' });
    const marsh = campaign({ name: 'Salt Marsh', role: 'player' });
    activityServer([coast, marsh], { world: { playSessions: { [marsh.id]: SESSION } } });
    openInDiscord();

    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${marsh.id}/play`);
    });
    await waitFor(() => {
      expect(socket.connects).toBe(1);
    });
    act(() => {
      socket.receive('connect');
    });
    expect(socket.last(PLAY_SOCKET.join).payload).toEqual({ campaignId: marsh.id });
    await act(async () => {
      socket.last(PLAY_SOCKET.join).answer({
        status: 'joined',
        stage: playerStage(),
        presence: [present(1, 'Mira')],
      });
      await Promise.resolve();
    });
    expect((await screen.findByTestId('play-canvas')).dataset['curtain']).toBe('open');
  });

  it('leaves the choice to the player when two sessions are running', async () => {
    const coast = campaign({ name: 'Painted Coast' });
    const marsh = campaign({ name: 'Salt Marsh', role: 'player' });
    activityServer([coast, marsh], {
      world: { playSessions: { [coast.id]: SESSION, [marsh.id]: { ...SESSION, number: 7 } } },
    });
    openInDiscord();

    await waitFor(() => {
      expect(campaignList()).toEqual([
        'Painted CoastGMSession 3 is running.Open the stage',
        'Salt MarshPlayerSession 7 is running.Join the session',
      ]);
    });
    expect(currentUrl()).toBe('/');
    expect(
      screen.getByRole('link', { name: 'Go to the table: Salt Marsh' }).getAttribute('href'),
    ).toBe(`/campaigns/${marsh.id}/play`);
  });

  it('does not send a player who left the table back to it', async () => {
    const coast = campaign({ name: 'Painted Coast', role: 'player' });
    activityServer([coast], { world: { playSessions: { [coast.id]: SESSION } } });
    openInDiscord();
    await waitFor(() => {
      expect(socket.connects).toBe(1);
    });
    act(() => {
      socket.receive('connect');
    });
    await act(async () => {
      socket.last(PLAY_SOCKET.join).answer({
        status: 'joined',
        stage: playerStage(),
        presence: [],
      });
      await Promise.resolve();
    });

    fireEvent.click(await screen.findByRole('link', { name: 'Leave the table' }));

    // The campaign's page in the Activity: its session, and nothing of the workshop.
    expect(await screen.findByText('Session 3 is running.')).toBeDefined();
    expect(currentUrl()).toBe(`/campaigns/${coast.id}`);
    expect(screen.getByRole('link', { name: 'Join the session' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Open records' })).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: '← All campaigns' }));
    await waitFor(() => {
      expect(campaignList()).toEqual(['Painted CoastPlayerSession 3 is running.Join the session']);
    });
    expect(currentUrl()).toBe('/');
    expect(socket.disconnects).toBe(1);
  });

  it('lets the GM start a session from inside Discord', async () => {
    const coast = campaign({ name: 'Painted Coast' });
    activityServer([coast]);
    openInDiscord();

    fireEvent.click(await screen.findByRole('link', { name: 'Open' }));
    expect(await screen.findByText(/No session is running/)).toBeDefined();
    expect(screen.getByText(/made in Stagehand in a browser/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${coast.id}/play`);
    });
    await waitFor(() => {
      expect(socket.connects).toBe(1);
    });
    act(() => {
      socket.receive('connect');
    });
    await act(async () => {
      socket.last(PLAY_SOCKET.join).answer({
        status: 'joined',
        stage: gmStage({ sceneLoad: 0, curtainOpen: false, scene: null, objects: [] }),
        presence: [present(0, 'Mira', { role: 'gm' })],
      });
      await Promise.resolve();
    });
    expect(await screen.findByRole('complementary', { name: 'Control desk' })).toBeDefined();
  });

  it('tells someone with no Stagehand account what to do, and lets them try again', async () => {
    const coast = campaign({ name: 'Painted Coast', role: 'player' });
    const server = activityServer([coast], { signIn: 'no-account' });
    openInDiscord();

    expect(await screen.findByText("You're new here")).toBeDefined();
    expect(screen.getByText('Join your campaign in a browser first.')).toBeDefined();
    expect(screen.queryByRole('list', { name: 'Your campaigns' })).toBeNull();

    // They joined in a browser meanwhile.
    server.signIn = 'ok';
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(campaignList()).toHaveLength(1);
    });
    expect(server.codes).toHaveLength(2);
  });

  it('says so when this Discord app does not keep the sign-in', async () => {
    activityServer([campaign()], { signIn: 'cookie-lost' });
    openInDiscord();

    expect((await screen.findByRole('alert')).textContent).toBe(ENTRY_MESSAGES.cookieBlocked);
    expect(screen.queryByRole('list', { name: 'Your campaigns' })).toBeNull();
  });

  it('asks again when the player did not let Discord share who they are', async () => {
    const server = activityServer([campaign({ name: 'Painted Coast' })]);
    discord.authorizes = false;
    openInDiscord();

    expect((await screen.findByRole('alert')).textContent).toBe(ENTRY_MESSAGES.declined);
    expect(server.codes).toEqual([]);

    discord.authorizes = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(campaignList()).toHaveLength(1);
    });
    // Each try asks for the voice too, then for who they are alone.
    expect(discord.scopes).toHaveLength(3);
  });

  it('tells a player with no campaign how to get one', async () => {
    activityServer([]);
    openInDiscord();

    expect(await screen.findByText(/not in a campaign yet/)).toBeDefined();
  });

  it('links to the Activity test while the server serves it', async () => {
    activityServer([campaign({ name: 'Painted Coast' })], { test: true });
    openInDiscord();

    fireEvent.click(await screen.findByRole('link', { name: 'Activity test' }));

    expect(await screen.findByTestId('stage-canvas')).toBeDefined();
    expect(currentUrl()).toBe('/activity-test');
  });

  it('leaves Discord’s SDK for the Activity test to sign in, so it can hear who talks', async () => {
    activityServer([campaign({ name: 'Painted Coast' })], { test: true });
    openInDiscord();

    fireEvent.click(await screen.findByRole('link', { name: 'Activity test' }));

    const panel = within(await screen.findByRole('region', { name: 'Activity test' }));
    await panel.findByText('Run again', { selector: 'button:not([disabled])' });
    const probe = (label: string) => panel.getByRole('listitem', { name: label }).textContent;
    expect(probe('Sign-in inside Discord')).toContain('okscopes identify, rpc.voice.read');
    expect(probe('Speaking events')).toContain('oksubscribed');
    // The test asked for both permissions and signed the SDK in with its own token.
    expect(discord.scopes).toEqual([
      ['identify', 'rpc.voice.read'],
      ['identify', 'rpc.voice.read'],
    ]);
    expect(discord.tokens).toEqual(['test-token']);
  });
});
