import {
  PLAY_SOCKET,
  type Campaign,
  type GmStageObject,
  type LiveStage,
  type Presence,
} from '@stagehand/shared';
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

// jsdom has no WebGL, so the 3D theater is replaced by a stand-in that shows what it was given,
// and keeps its props so a test can press a cutout as the GM would.
let canvasProps: PlayCanvasProps | null = null;
vi.mock('@/stage/PlayCanvas', () => ({
  PlayCanvas: (props: PlayCanvasProps) => {
    canvasProps = props;
    return (
      <div
        data-testid="play-canvas"
        data-backdrop={props.backdropUrl ?? ''}
        data-curtain={props.curtainOpen ? 'open' : 'closed'}
        data-objects={JSON.stringify(props.objects)}
      />
    );
  },
}));

/** The live room's connection: each test plays the server on it. */
let socket: FakePlaySocket;
vi.mock('@/play/socket', () => ({ createPlaySocket: () => socket }));
// jsdom never loads an image, so every scene's images count as loaded at once.
vi.mock('@/play/preload', () => ({ preloadImages: () => Promise.resolve() }));

beforeEach(() => {
  socket = fakePlaySocket();
  canvasProps = null;
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
    // Nothing in a player's theater can be picked or dragged.
    expect(canvasProps?.onSelect).toBeUndefined();
    expect(canvasProps?.onMove).toBeUndefined();
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

    // The well is in sight and the hidden trapdoor drawn see-through; Marta waits below.
    await waitFor(() => {
      expect(drawn(theater)).toHaveLength(2);
    });
    expect(drawn(theater).map((cutout) => cutout.faded)).toEqual([false, true]);
    expect(desk().getByRole('heading', { name: 'Session 3' })).toBeDefined();
    expect(
      within(desk().getByRole('list', { name: 'On stage' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Stone WellIn sightHide',
      'Secret TrapdoorHiddenShow',
      'Old MartaWaiting belowRaise',
    ]);
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

  describe('the control desk', () => {
    const [well, trapdoor, marta] = gmStage().objects.map((object) => object.id);
    const wellId = well ?? '';
    const sent = (event: string) => socket.requests.filter((request) => request.event === event);
    const picked = (name: string) =>
      within(desk().getByRole('region', { name: `Selected: ${name}` }));

    function pressInTheater(id: string | null) {
      act(() => {
        canvasProps?.onSelect?.(id);
      });
    }

    it('picks an object in the theater, and moves it at once, sending moves one at a time', async () => {
      await seated(coast, stageWith(), [GM_HERE]);
      pressInTheater(wellId);
      expect(canvasProps?.selectedId).toBe(wellId);

      fireEvent.change(picked('Stone Well').getByLabelText('Left to right'), {
        target: { value: '0.8' },
      });
      expect(socket.last(PLAY_SOCKET.moveObject).payload).toEqual({ id: wellId, across: 0.8 });
      expect(drawn(await canvas())[0]?.across).toBe(0.8);

      // A second change waits for the first to be answered, then goes after the gap.
      fireEvent.click(picked('Stone Well').getByRole('button', { name: 'Step back' }));
      expect(sent(PLAY_SOCKET.moveObject)).toHaveLength(1);
      await answer(PLAY_SOCKET.moveObject, { ok: true });
      await waitFor(() => {
        expect(sent(PLAY_SOCKET.moveObject)).toHaveLength(2);
      });
      expect(socket.last(PLAY_SOCKET.moveObject).payload).toEqual({ id: wellId, depthTick: 6 });

      pressInTheater(null);
      expect(desk().queryByRole('region', { name: 'Selected: Stone Well' })).toBeNull();
    });

    it('drags a cutout in the theater, and moves it with the arrow keys', async () => {
      await seated(coast, stageWith(), [GM_HERE]);
      fireEvent.click(desk().getByRole('button', { name: /^Stone Well/ }));

      act(() => {
        canvasProps?.onMove?.(wellId, { across: 0.1, up: 0.3 });
      });
      expect(socket.last(PLAY_SOCKET.moveObject).payload).toEqual({
        id: wellId,
        across: 0.1,
        up: 0.3,
      });
      await answer(PLAY_SOCKET.moveObject, { ok: true });

      fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });
      await waitFor(() => {
        expect(sent(PLAY_SOCKET.moveObject)).toHaveLength(2);
      });
      // From where the drag left it, not from where the server last had it.
      expect(socket.last(PLAY_SOCKET.moveObject).payload).toEqual({ id: wellId, across: 0.05 });

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(canvasProps?.selectedId).toBeNull();
    });

    it('raises a puppet and shows a prop from the list', async () => {
      await seated(coast, stageWith(), [GM_HERE]);

      fireEvent.click(desk().getByRole('button', { name: 'Raise: Old Marta' }));
      expect(socket.last(PLAY_SOCKET.raisePuppet).payload).toEqual({ id: marta });
      await answer(PLAY_SOCKET.raisePuppet, { ok: true });

      fireEvent.click(desk().getByRole('button', { name: 'Show: Secret Trapdoor' }));
      expect(socket.last(PLAY_SOCKET.showProp).payload).toEqual({ id: trapdoor });
      await answer(PLAY_SOCKET.showProp, { ok: false, message: 'That is no longer on the stage' });
      expect(desk().getByRole('alert').textContent).toBe('That is no longer on the stage');
    });

    it('plays an emote on a raised puppet, and offers none while it waits below', async () => {
      await seated(coast, stageWith(), [GM_HERE]);
      pressInTheater(marta ?? '');
      expect(picked('Old Marta').queryByRole('group', { name: 'Emote' })).toBeNull();

      const raised = stageWith();
      const puppet = raised.objects[2];
      if (puppet !== undefined) puppet.shown = true;
      serverSends(PLAY_SOCKET.stage, raised);
      const emotes = within(picked('Old Marta').getByRole('group', { name: 'Emote' }));
      expect(emotes.getAllByRole('button')).toHaveLength(10);

      fireEvent.click(emotes.getByRole('button', { name: 'Shiver' }));
      expect(socket.last(PLAY_SOCKET.emote).payload).toEqual({ id: marta, emote: 'shiver' });
      await answer(PLAY_SOCKET.emote, { ok: false, message: 'Too quick: wait a moment' });
      expect(desk().getByRole('alert').textContent).toBe('Too quick: wait a moment');

      // A prop has no emotes.
      pressInTheater(wellId);
      expect(picked('Stone Well').queryByRole('group', { name: 'Emote' })).toBeNull();
    });

    it('voices a raised NPC, switches in one click and releases it (F3.8)', async () => {
      const raised = stageWith();
      const puppet = raised.objects[2];
      if (puppet !== undefined) puppet.shown = true;
      await seated(coast, raised, [GM_HERE, SAM_HERE]);

      // A prop and a PC are never voiced; a raised NPC is, from the list or once picked.
      expect(desk().queryByRole('button', { name: 'Voice: Stone Well' })).toBeNull();
      fireEvent.click(desk().getByRole('button', { name: 'Voice: Old Marta' }));
      expect(socket.last(PLAY_SOCKET.takeOverNpc).payload).toEqual({ id: marta });
      await answer(PLAY_SOCKET.takeOverNpc, { ok: true });

      serverSends(PLAY_SOCKET.presence, [
        { ...GM_HERE, speaking: true, voicing: marta ?? null },
        SAM_HERE,
      ]);
      const strip = within(desk().getByRole('region', { name: 'Voicing' }));
      expect(strip.getByText('Old Marta')).toBeDefined();
      // The GM's own list says whose voice it is.
      const here = within(desk().getByRole('list', { name: 'Who is here' }));
      expect(here.getByText('as Old Marta')).toBeDefined();

      pressInTheater(marta ?? '');
      const stop = picked('Old Marta').getByRole('button', { name: 'Stop voicing' });
      expect(stop.getAttribute('aria-pressed')).toBe('true');

      fireEvent.click(strip.getByRole('button', { name: 'Release' }));
      expect(socket.last(PLAY_SOCKET.releaseNpc).payload).toEqual({});
      await answer(PLAY_SOCKET.releaseNpc, { ok: true });
      serverSends(PLAY_SOCKET.presence, [GM_HERE, SAM_HERE]);
      expect(desk().queryByRole('region', { name: 'Voicing' })).toBeNull();
      expect(picked('Old Marta').getByRole('button', { name: 'Voice this NPC' })).toBeDefined();
    });

    it('offers no voice for an NPC waiting below', async () => {
      await seated(coast, stageWith(), [GM_HERE]);
      expect(desk().queryByRole('button', { name: 'Voice: Old Marta' })).toBeNull();
      pressInTheater(marta ?? '');
      expect(picked('Old Marta').queryByRole('button', { name: 'Voice this NPC' })).toBeNull();
    });

    it('adds a PC out of sight, and picks it once the stage has it', async () => {
      const vexId = uuid();
      mockApi(MIRA, [coast], {
        playSessions: { [coast.id]: SESSION },
        stageCharacters: {
          [coast.id]: [{ id: vexId, name: 'Vex Tidecaller', image: stageImage(9) }],
        },
      });
      await seated(coast, stageWith(), [GM_HERE]);

      fireEvent.click(await desk().findByRole('button', { name: 'Add Vex Tidecaller' }));
      const { payload } = socket.last(PLAY_SOCKET.addObject);
      expect(payload).toEqual({ id: expect.any(String) as string, characterId: vexId });
      await answer(PLAY_SOCKET.addObject, { ok: true });

      const added = (payload as { id: string }).id;
      serverSends(
        PLAY_SOCKET.stage,
        stageWith({
          objects: [
            ...gmStage().objects,
            {
              ...gmStage().objects[2],
              id: added,
              subject: { kind: 'pc', id: vexId, name: 'Vex Tidecaller' },
            } as GmStageObject,
          ],
        }),
      );
      expect(await desk().findByRole('region', { name: 'Selected: Vex Tidecaller' })).toBeDefined();
      expect(picked('Vex Tidecaller').getByRole('button', { name: 'Raise' })).toBeDefined();
      expect(picked('Vex Tidecaller').queryByRole('button', { name: 'Reveal' })).toBeNull();
    });

    it('takes an object off the stage after asking', async () => {
      await seated(coast, stageWith(), [GM_HERE]);
      pressInTheater(wellId);

      fireEvent.click(picked('Stone Well').getByRole('button', { name: 'Remove from stage' }));
      const dialog = within(await screen.findByRole('alertdialog'));
      expect(dialog.getByText(/The saved scene keeps it/)).toBeDefined();
      fireEvent.click(dialog.getByRole('button', { name: 'Remove from stage' }));

      await waitFor(() => {
        expect(socket.last(PLAY_SOCKET.removeObject).payload).toEqual({ id: wellId });
      });
    });

    it('reveals what is picked through the server', async () => {
      await seated(coast, stageWith(), [GM_HERE]);
      pressInTheater(wellId);

      fireEvent.click(picked('Stone Well').getByRole('button', { name: 'Reveal' }));

      const recordId = gmStage().objects[0]?.subject.id ?? '';
      await waitFor(() => {
        expect(sentTo(fetchMock, `/records/${recordId}/reveal`, 'POST')).toBe(1);
      });
    });

    it('shows the GM the theater as players see it, on request', async () => {
      const theater = await seated(coast, stageWith(), [GM_HERE]);
      await waitFor(() => {
        expect(drawn(theater)).toHaveLength(2);
      });

      fireEvent.click(desk().getByRole('button', { name: 'As players see it' }));

      expect(drawn(await canvas())).toHaveLength(1);
    });
  });

  it('puts the desk away and brings it back, for a small window', async () => {
    const theater = await seated(coast, stageWith(), [GM_HERE]);

    fireEvent.click(screen.getByRole('button', { name: 'Hide desk' }));
    expect(screen.queryByRole('complementary', { name: 'Control desk' })).toBeNull();
    expect(theater.isConnected).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Show desk' }));
    expect(desk().getByRole('heading', { name: 'Session 3' })).toBeDefined();
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

  describe('rolls, Hope and Fear (F3.6)', () => {
    const vex = uuid();
    const bram = uuid();
    const party = [
      { characterId: bram, name: 'Bram', playerName: 'Sam', hope: 0 },
      { characterId: vex, name: 'Vex', playerName: 'Rowan', hope: 2 },
    ];
    const rolls = () => within(desk().getByRole('region', { name: 'Rolls' }));

    it('calls a roll for every PC at once, with a hidden difficulty and a label', async () => {
      await seated(coast, stageWith({ party }), [GM_HERE]);
      const form = within(rolls().getByRole('form', { name: 'Call a roll' }));
      expect(form.getByRole('button', { name: 'Call roll' })).toHaveProperty('disabled', true);

      fireEvent.click(form.getByRole('checkbox', { name: 'All' }));
      fireEvent.change(form.getByRole('combobox', { name: 'Trait' }), {
        target: { value: 'instinct' },
      });
      fireEvent.change(form.getByRole('spinbutton', { name: 'Difficulty' }), {
        target: { value: '14' },
      });
      fireEvent.change(form.getByRole('textbox', { name: 'What for (optional)' }), {
        target: { value: 'Spot the ambush' },
      });
      fireEvent.click(form.getByRole('checkbox', { name: 'Hide the difficulty from players' }));
      fireEvent.click(form.getByRole('button', { name: 'Call roll' }));

      expect(socket.last(PLAY_SOCKET.callRoll).payload).toEqual({
        characterIds: [bram, vex],
        trait: 'instinct',
        difficulty: 14,
        hidden: true,
        label: 'Spot the ambush',
      });
      await answer(PLAY_SOCKET.callRoll, { ok: true });
    });

    it('takes back a call, and reveals a hidden roll’s result', async () => {
      const callId = uuid();
      const rollId = uuid();
      await seated(
        coast,
        stageWith({
          party,
          calls: [
            {
              id: callId,
              characterId: bram,
              characterName: 'Bram',
              trait: 'strength',
              difficulty: 10,
              hidden: false,
              label: null,
            },
          ],
          lastRoll: {
            id: rollId,
            characterId: vex,
            characterName: 'Vex',
            trait: 'agility',
            label: null,
            dice: { hope: 3, fear: 5 },
            modifier: 2,
            hopeBonus: 0,
            total: 10,
            critical: false,
            gained: 'fear',
            difficulty: 15,
            success: false,
            hidden: true,
            revealed: false,
            at: '2026-11-17T20:00:00.000Z',
          },
        }),
        [GM_HERE],
      );

      expect(rolls().getByText('Bram: Strength vs 10')).toBeDefined();
      fireEvent.click(rolls().getByRole('button', { name: "Cancel Bram's roll" }));
      expect(socket.last(PLAY_SOCKET.cancelRoll).payload).toEqual({ callId });
      await answer(PLAY_SOCKET.cancelRoll, { ok: true });

      expect(rolls().getByText('3 + 5 + 2 = 10 vs 15: failure with Fear')).toBeDefined();
      fireEvent.click(rolls().getByRole('button', { name: 'Reveal result' }));
      expect(socket.last(PLAY_SOCKET.revealRoll).payload).toEqual({ rollId });
      await answer(PLAY_SOCKET.revealRoll, { ok: true });
    });

    it('spends Fear with a reason, and corrects Fear and Hope', async () => {
      await seated(coast, stageWith({ party, fear: 3 }), [GM_HERE]);
      const fear = within(desk().getByRole('region', { name: 'Fear' }));
      expect(fear.getByText('3 of 12')).toBeDefined();

      fireEvent.change(fear.getByRole('textbox', { name: 'Why (optional)' }), {
        target: { value: 'The bridge gives way' },
      });
      fireEvent.click(fear.getByRole('button', { name: 'Spend' }));
      expect(socket.last(PLAY_SOCKET.spendFear).payload).toEqual({
        amount: 1,
        reason: 'The bridge gives way',
      });
      await answer(PLAY_SOCKET.spendFear, { ok: true });

      fireEvent.click(fear.getByRole('button', { name: 'Raise Fear' }));
      expect(socket.last(PLAY_SOCKET.setFear).payload).toEqual({ fear: 4 });
      await answer(PLAY_SOCKET.setFear, { ok: true });

      const hope = within(desk().getByRole('region', { name: 'Hope' }));
      expect(hope.getByRole('button', { name: "Lower Bram's Hope" })).toHaveProperty(
        'disabled',
        true,
      );
      fireEvent.click(hope.getByRole('button', { name: "Lower Vex's Hope" }));
      expect(socket.last(PLAY_SOCKET.setHope).payload).toEqual({ characterId: vex, hope: 1 });
      await answer(PLAY_SOCKET.setHope, { ok: false, message: 'Hope is from 0 to 6' });
      expect(desk().getByRole('alert').textContent).toBe('Hope is from 0 to 6');
    });

    it('shows the session’s log, and reads it again when it grows', async () => {
      fetchMock = mockApi(MIRA, [coast], {
        playSessions: { [coast.id]: SESSION },
        sessionLogs: {
          [coast.id]: [
            {
              id: uuid(),
              kind: 'fear_spend',
              at: '2026-11-17T20:05:00.000Z',
              actorName: 'Mira',
              text: 'Spent 1 Fear (3 → 2): The bridge gives way',
            },
          ],
        },
      });
      await seated(coast, stageWith({ party }), [GM_HERE]);
      const log = within(desk().getByRole('region', { name: 'Log' }));
      expect(await log.findByText(/Spent 1 Fear \(3 → 2\): The bridge gives way/)).toBeDefined();

      const before = sentTo(fetchMock, '/play-session/log', 'GET');
      serverSends(PLAY_SOCKET.logChanged);
      await waitFor(() => {
        expect(sentTo(fetchMock, '/play-session/log', 'GET')).toBeGreaterThan(before);
      });
    });
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
