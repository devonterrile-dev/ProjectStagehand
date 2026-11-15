import { PLAY_SOCKET, type Campaign, type LiveStage, type Presence } from '@stagehand/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StageCutout } from '@/lib/scenes';
import type { PlayCanvasProps } from '@/stage/PlayCanvas';
import { campaign, currentUrl, MIRA, mockApi, renderAt, uuid } from '@/test/app-harness';
import { fakePlaySocket, type FakePlaySocket } from '@/test/fake-play-socket';
import {
  gmStage,
  playerObject,
  playerStage,
  present,
  SESSION,
  stageImage,
} from '@/test/play-fixtures';

// jsdom has no WebGL, so the 3D theater is replaced by a stand-in that shows what it was given.
vi.mock('@/stage/PlayCanvas', () => ({
  PlayCanvas: (props: PlayCanvasProps) => (
    <div
      data-testid="play-canvas"
      data-backdrop={props.backdropUrl ?? ''}
      data-curtain={props.curtainOpen ? 'open' : 'closed'}
      data-objects={JSON.stringify(props.objects)}
    />
  ),
}));

/** The live room's connection: each test plays the server on it. */
let socket: FakePlaySocket;
vi.mock('@/play/socket', () => ({ createPlaySocket: () => socket }));
// jsdom never loads an image, so every scene's images count as loaded at once.
vi.mock('@/play/preload', () => ({ preloadImages: () => Promise.resolve() }));

beforeEach(() => {
  socket = fakePlaySocket();
});

type FetchMock = ReturnType<typeof mockApi>;

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** How many requests went to a URL ending in `suffix` with `method`. */
const sentTo = (fetchMock: FetchMock, suffix: string, method: string) =>
  fetchMock.mock.calls.filter(
    ([input, init]) => urlOf(input).endsWith(suffix) && (init?.method ?? 'GET') === method,
  ).length;

const canvas = () => screen.findByTestId('play-canvas');
const drawn = (theater: HTMLElement) =>
  JSON.parse(theater.dataset['objects'] ?? '[]') as StageCutout[];
const desk = () => within(screen.getByRole('complementary', { name: 'Control desk' }));
const whoIsHere = () =>
  within(screen.getByRole('list', { name: 'Who is here' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

/** The server sends something over the live room. */
function serverSends(event: string, ...args: unknown[]) {
  act(() => {
    socket.receive(event, ...args);
  });
}

/** Answers the newest request for `event`, and lets the page take it in. */
async function answer(event: string, value: unknown) {
  await act(async () => {
    socket.last(event).answer(value);
    await Promise.resolve();
  });
}

/** Opens the play page; the connection comes up and the page asks to join. */
async function openTable(coast: Campaign) {
  renderAt(`/campaigns/${coast.id}/play`);
  await waitFor(() => {
    expect(socket.connects).toBe(1);
  });
  serverSends('connect');
  expect(socket.last(PLAY_SOCKET.join).payload).toEqual({ campaignId: coast.id });
}

/** Opens the play page and seats the user in a running session. */
async function seated(coast: Campaign, stage: LiveStage, presence: Presence) {
  await openTable(coast);
  await answer(PLAY_SOCKET.join, { status: 'joined', stage, presence });
  return canvas();
}

const GM_HERE = present(0, 'Mira', { role: 'gm' });
const SAM_HERE = present(1, 'Sam', { characterName: 'Vex Tidecaller' });

describe('The campaign page’s session card', () => {
  it('lets the GM start a session, and takes them to the table', async () => {
    const coast = campaign({ name: 'Painted Coast' });
    const fetchMock = mockApi(MIRA, [coast]);
    renderAt(`/campaigns/${coast.id}`);

    expect(await screen.findByText(/No session is running/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${coast.id}/play`);
    });
    expect(sentTo(fetchMock, '/play-session', 'POST')).toBe(1);
  });

  it('shows the GM a running session, to open or to end', async () => {
    const coast = campaign({ name: 'Painted Coast' });
    const fetchMock = mockApi(MIRA, [coast], { playSessions: { [coast.id]: SESSION } });
    renderAt(`/campaigns/${coast.id}`);

    expect(await screen.findByText('Session 3 is running.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open the stage' }).getAttribute('href')).toBe(
      `/campaigns/${coast.id}/play`,
    );
    expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText('End the session?')).toBeDefined();
    fireEvent.click(dialog.getByRole('button', { name: 'End session' }));

    expect(await screen.findByText(/No session is running/)).toBeDefined();
    expect(sentTo(fetchMock, '/play-session/end', 'POST')).toBe(1);
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDefined();
  });

  it('lets a player join a running session, and nothing more', async () => {
    const coast = campaign({ name: 'Painted Coast', role: 'player' });
    mockApi(MIRA, [coast], { playSessions: { [coast.id]: SESSION } });
    renderAt(`/campaigns/${coast.id}`);

    const join = await screen.findByRole('link', { name: 'Join the session' });
    expect(join.getAttribute('href')).toBe(`/campaigns/${coast.id}/play`);
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull();
  });

  it('tells a player when no session is running', async () => {
    const coast = campaign({ name: 'Painted Coast', role: 'player' });
    mockApi(MIRA, [coast]);
    renderAt(`/campaigns/${coast.id}`);

    expect(await screen.findByText(/No session right now/)).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Join the session' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull();
  });

  it('offers no start in an archived campaign', async () => {
    const coast = campaign({ name: 'Painted Coast', archivedAt: '2026-11-09T12:00:00.000Z' });
    mockApi(MIRA, [coast]);
    renderAt(`/campaigns/${coast.id}`);

    expect(await screen.findByText("An archived campaign can't start a session.")).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull();
  });
});

describe('The table, for a player', () => {
  const coast = campaign({ name: 'Painted Coast', role: 'player' });

  beforeEach(() => {
    mockApi(MIRA, [coast]);
  });

  it('waits for the GM, then opens the theater by itself when the session starts', async () => {
    await openTable(coast);
    expect(screen.getByText('Connecting to the table…')).toBeDefined();

    await answer(PLAY_SOCKET.join, { status: 'no-session' });
    expect(screen.getByText(/Waiting for your GM to start the session/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull();
    expect(screen.queryByTestId('play-canvas')).toBeNull();

    serverSends(PLAY_SOCKET.started);
    await answer(PLAY_SOCKET.join, {
      status: 'joined',
      stage: playerStage(),
      presence: [GM_HERE, SAM_HERE],
    });

    expect((await canvas()).dataset['curtain']).toBe('open');
  });

  it('draws what the server sent, with who is here and no desk', async () => {
    const theater = await seated(
      coast,
      playerStage({
        objects: [
          playerObject(1, { across: 0.25 }),
          playerObject(2, { kind: 'puppet', mount: null }),
        ],
      }),
      [GM_HERE, SAM_HERE],
    );

    await waitFor(() => {
      expect(drawn(theater)).toHaveLength(2);
    });
    expect(theater.dataset['backdrop']).toBe(
      `/api/campaigns/${coast.id}/assets/${stageImage(0).assetId}/image?p=3`,
    );
    expect(drawn(theater).map((cutout) => [cutout.across, cutout.mount])).toEqual([
      [0.25, 'stand'],
      [0.5, 'stick'],
    ]);
    expect(whoIsHere()).toEqual(['MMiraGM', 'SSamVex Tidecaller']);
    expect(screen.queryByRole('complementary', { name: 'Control desk' })).toBeNull();
    expect(screen.queryByRole('button', { name: /curtain/ })).toBeNull();
  });

  it('follows the curtain and who is here as the server sends them', async () => {
    const theater = await seated(coast, playerStage(), [GM_HERE]);
    await waitFor(() => {
      expect(theater.dataset['curtain']).toBe('open');
    });

    serverSends(PLAY_SOCKET.stage, playerStage({ curtainOpen: false }));
    expect(theater.dataset['curtain']).toBe('closed');

    serverSends(PLAY_SOCKET.presence, [GM_HERE, present(2, 'Ana')]);
    expect(whoIsHere()).toEqual(['MMiraGM', 'AAnaNo PC yet']);
  });

  it('says the connection is lost, and keeps the theater on screen', async () => {
    const theater = await seated(coast, playerStage(), [GM_HERE]);

    serverSends('disconnect', 'transport close');
    expect(screen.getByRole('status').textContent).toBe('Connection lost. Reconnecting…');
    expect(theater.isConnected).toBe(true);

    serverSends('connect');
    await answer(PLAY_SOCKET.join, { status: 'joined', stage: playerStage(), presence: [GM_HERE] });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers to try again when the session is full', async () => {
    await openTable(coast);
    await answer(PLAY_SOCKET.join, { status: 'full' });

    expect(screen.getByText('The session is full')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(socket.requests).toHaveLength(2);
    await answer(PLAY_SOCKET.join, { status: 'joined', stage: playerStage(), presence: [] });
    expect(await canvas()).toBeDefined();
  });

  it('closes the theater when the GM ends the session', async () => {
    await seated(coast, playerStage(), [GM_HERE]);

    serverSends(PLAY_SOCKET.ended);

    expect(screen.getByText('The session has ended')).toBeDefined();
    expect(screen.queryByTestId('play-canvas')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull();
  });

  it('says so to someone who was removed from the campaign', async () => {
    await openTable(coast);
    await answer(PLAY_SOCKET.join, { status: 'not-found' });

    expect(screen.getByText(/not a member of this campaign any more/)).toBeDefined();
  });

  it('asks someone whose sign-in ran out to sign in again', async () => {
    socket.willRetry = false;
    renderAt(`/campaigns/${coast.id}/play`);
    await waitFor(() => {
      expect(socket.connects).toBe(1);
    });

    serverSends('connect_error', new Error('unauthorized'));

    expect(screen.getByText(/You've been signed out/)).toBeDefined();
  });

  it('leaves the live room when the player leaves the table', async () => {
    await seated(coast, playerStage(), [GM_HERE]);

    fireEvent.click(screen.getByRole('link', { name: 'Leave the table' }));

    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${coast.id}`);
    });
    expect(socket.disconnects).toBe(1);
  });
});

describe('The table, for the GM', () => {
  const coast = campaign({ name: 'Painted Coast' });
  const marketId = uuid();
  const cellarId = uuid();
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = mockApi(MIRA, [coast], {
      scenes: {
        [coast.id]: [
          { id: marketId, name: 'Ambush at the market' },
          { id: cellarId, name: 'The cellar' },
        ],
      },
      playSessions: { [coast.id]: SESSION },
    });
  });

  const stageWith = (overrides: Parameters<typeof gmStage>[0] = {}) =>
    gmStage({ scene: { id: marketId, name: 'Ambush at the market' }, ...overrides });

  it('shows the theater as players see it, with the desk beside it', async () => {
    const theater = await seated(coast, stageWith(), [GM_HERE, SAM_HERE]);

    // Only the well is in sight: the trapdoor is hidden and Marta waits below.
    await waitFor(() => {
      expect(drawn(theater)).toHaveLength(1);
    });
    expect(desk().getByRole('heading', { name: 'Session 3' })).toBeDefined();
    expect(
      within(desk().getByRole('list', { name: 'On stage' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Stone WellIn sight', 'Secret TrapdoorHidden', 'Old MartaWaiting below']);
    expect(whoIsHere()).toEqual(['MMiraGM', 'SSamVex Tidecaller']);
    expect(screen.queryByRole('link', { name: 'Leave the table' })).toBeNull();
  });

  it('lists the scenes, marks the one on stage, and loads another', async () => {
    await seated(coast, stageWith(), [GM_HERE]);
    const scenes = within(await desk().findByRole('list', { name: 'Scenes' }));
    await waitFor(() => {
      expect(scenes.getAllByRole('listitem')).toHaveLength(2);
    });
    expect(scenes.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Ambush at the marketOn stageLoad again',
      'The cellarLoad',
    ]);

    fireEvent.click(scenes.getByRole('button', { name: 'Load: The cellar' }));
    expect(socket.last(PLAY_SOCKET.loadScene).payload).toEqual({ sceneId: cellarId });
    // Nothing more can be sent until this is answered.
    expect(
      desk().getByRole<HTMLButtonElement>('button', { name: 'Close the curtain' }).disabled,
    ).toBe(true);

    await answer(PLAY_SOCKET.loadScene, { ok: true });
    serverSends(
      PLAY_SOCKET.stage,
      stageWith({ sceneLoad: 2, scene: { id: cellarId, name: 'The cellar' }, objects: [] }),
    );

    await waitFor(() => {
      expect(scenes.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'Ambush at the marketLoad',
        'The cellarOn stageLoad again',
      ]);
    });
    expect(desk().getByText('An empty theater.')).toBeDefined();
  });

  it('closes and opens the curtain, following what the server says', async () => {
    const theater = await seated(coast, stageWith(), [GM_HERE]);

    fireEvent.click(desk().getByRole('button', { name: 'Close the curtain' }));
    expect(socket.last(PLAY_SOCKET.closeCurtain).payload).toBeUndefined();
    await answer(PLAY_SOCKET.closeCurtain, { ok: true });
    // The button and the theater change when the stage comes back, not on the click.
    expect(desk().getByRole('button', { name: 'Close the curtain' })).toBeDefined();

    serverSends(PLAY_SOCKET.stage, stageWith({ curtainOpen: false }));
    expect(theater.dataset['curtain']).toBe('closed');

    fireEvent.click(desk().getByRole('button', { name: 'Open the curtain' }));
    expect(socket.last(PLAY_SOCKET.openCurtain)).toBeDefined();
  });

  it('shows why an action was refused', async () => {
    await seated(coast, stageWith(), [GM_HERE]);

    fireEvent.click(desk().getByRole('button', { name: 'Close the curtain' }));
    await answer(PLAY_SOCKET.closeCurtain, { ok: false, message: 'No session is running' });

    expect(desk().getByRole('alert').textContent).toBe('No session is running');
    expect(
      desk().getByRole<HTMLButtonElement>('button', { name: 'Close the curtain' }).disabled,
    ).toBe(false);
  });

  it('can send nothing while the connection is down', async () => {
    await seated(coast, stageWith(), [GM_HERE]);

    serverSends('disconnect', 'transport close');

    expect(
      desk().getByRole<HTMLButtonElement>('button', { name: 'Close the curtain' }).disabled,
    ).toBe(true);
    expect(
      (await desk().findByRole<HTMLButtonElement>('button', { name: 'Load: The cellar' })).disabled,
    ).toBe(true);
  });

  it('says what to do before any scene is loaded', async () => {
    await seated(
      coast,
      stageWith({ sceneLoad: 0, curtainOpen: false, scene: null, backdrop: null, objects: [] }),
      [GM_HERE],
    );

    expect(desk().getByText('Nothing yet. Load a scene to begin.')).toBeDefined();
    expect(desk().getByRole('button', { name: 'Open the curtain' })).toBeDefined();
  });

  it('ends the session for everyone, and can start the next from the same page', async () => {
    await seated(coast, stageWith(), [GM_HERE]);

    fireEvent.click(desk().getByRole('button', { name: 'End session' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'End session' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, '/play-session/end', 'POST')).toBe(1);
    });
    serverSends(PLAY_SOCKET.ended);

    expect(await screen.findByText('The session has ended')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, '/play-session', 'POST')).toBe(1);
    });

    // The server tells the room the session began; the room joins by itself.
    serverSends(PLAY_SOCKET.started);
    await answer(PLAY_SOCKET.join, {
      status: 'joined',
      stage: stageWith({ sceneLoad: 0, scene: null, objects: [] }),
      presence: [GM_HERE],
    });
    expect(await canvas()).toBeDefined();
  });

  it('offers to start a session when none is running', async () => {
    await openTable(coast);
    await answer(PLAY_SOCKET.join, { status: 'no-session' });

    expect(screen.getByText('No session is running.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDefined();
  });
});

describe('The table, for someone who is not in the campaign', () => {
  it('says the campaign was not found, and never connects', async () => {
    mockApi(MIRA, []);
    renderAt(`/campaigns/${uuid()}/play`);

    expect(await screen.findByText('Campaign not found')).toBeDefined();
    expect(socket.connects).toBe(0);
  });
});
