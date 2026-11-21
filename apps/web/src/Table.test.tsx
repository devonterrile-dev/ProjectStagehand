import {
  PLAY_SOCKET,
  type Campaign,
  type FreeRoll,
  type LiveStage,
  type RichText,
  type RollCall,
  type RollResult,
} from '@stagehand/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SPEAKING_GAP_MS } from '@/play/room';
import type { PlayCanvasProps } from '@/stage/PlayCanvas';
import { campaign, MIRA, mockApi, record, renderAt, uuid } from '@/test/app-harness';
import { fakePlaySocket, type FakePlaySocket } from '@/test/fake-play-socket';
import type { NoteSeed } from '@/test/journal-world';
import { gmStage, playerObject, playerStage, present } from '@/test/play-fixtures';

// jsdom has no WebGL, so the 3D theater is replaced by a stand-in. It shows where the camera
// rests and draws the table's HTML pieces as they would be laid on the table (F3.5b, F3.6), and
// the player's emote card (F3.7).
let canvasProps: PlayCanvasProps | null = null;
vi.mock('@/stage/PlayCanvas', () => ({
  PlayCanvas: (props: PlayCanvasProps) => {
    canvasProps = props;
    const table = props.table;
    return (
      <div data-testid="play-canvas" data-view={table?.view ?? 'stage'}>
        {table?.inspect !== null && table?.inspect !== undefined && (
          <div data-testid="inspect-stage" data-image={table.inspect.image?.url ?? ''}>
            {table.inspect.title}
            {table.inspect.card}
          </div>
        )}
        {table?.inspectNote}
        {table?.binderPage}
        {table?.binderNote}
        {table?.sheet?.page}
        {table?.sheet?.page != null && table.sheet.cards !== null && (
          <>
            {table.sheet.cards.piles.loadout}
            {table.sheet.cards.piles.vault}
            {table.sheet.cards.subclass}
            {table.sheet.cards.ancestry}
          </>
        )}
        {props.own?.menu?.card}
      </div>
    );
  },
}));

let socket: FakePlaySocket;
vi.mock('@/play/socket', () => ({ createPlaySocket: () => socket }));
vi.mock('@/play/preload', () => ({ preloadImages: () => Promise.resolve() }));

beforeEach(() => {
  socket = fakePlaySocket();
  canvasProps = null;
});

function serverSends(event: string, ...args: unknown[]) {
  act(() => {
    socket.receive(event, ...args);
  });
}

async function answer(event: string, value: unknown) {
  await act(async () => {
    socket.last(event).answer(value);
    await Promise.resolve();
  });
}

async function seated(coast: Campaign, stage: LiveStage) {
  renderAt(`/campaigns/${coast.id}/play`);
  await waitFor(() => {
    expect(socket.connects).toBe(1);
  });
  serverSends('connect');
  await answer(PLAY_SOCKET.join, { status: 'joined', stage, presence: [present(1, 'Mira')] });
  return screen.findByTestId('play-canvas');
}

const view = () => screen.getByTestId('play-canvas').dataset['view'];
const props = (): PlayCanvasProps => {
  if (canvasProps === null) throw new Error('the theater was not drawn');
  return canvasProps;
};

type FetchMock = ReturnType<typeof mockApi>;
const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const gets = (fetchMock: FetchMock, suffix: string) =>
  fetchMock.mock.calls.filter(
    ([input, init]) => urlOf(input).endsWith(suffix) && (init?.method ?? 'GET') === 'GET',
  ).length;

function text(words: string): RichText {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }],
  };
}

const ROWAN = { userId: uuid(), displayName: 'Rowan' };

/** A campaign with a revealed lantern (on stage), a revealed NPC, and notes on the lantern. */
function world(role: 'player' | 'gm' = 'player', noteCount = 2) {
  const coast = campaign({ name: 'Painted Coast', role });
  const lantern = record({
    type: 'prop',
    name: 'Storm lantern',
    publicDescription: text('Its glass is cracked.'),
    revealedAt: '2026-11-16T12:00:00.000Z',
    visualAssetId: uuid(),
  });
  const maren = record({
    type: 'npc',
    name: 'Old Maren',
    publicDescription: text('A keeper with salt-white hair.'),
    revealedAt: '2026-11-16T12:00:00.000Z',
  });
  const hidden = record({ type: 'npc', name: 'The smuggler queen' });
  const notes: NoteSeed[] = Array.from({ length: noteCount }, (_, index) => ({
    id: uuid(),
    body: `Note ${String(index + 1)}`,
    author: ROWAN,
    recordId: lantern.id,
  }));
  const fetchMock = mockApi(MIRA, [coast], {
    campaignData: { [coast.id]: { records: [lantern, maren, hidden] } },
    notes: { [coast.id]: notes },
  });
  const object = playerObject(1, { recordId: lantern.id });
  return { coast, lantern, maren, hidden, fetchMock, object };
}

describe('Inspecting at the table (F3.5b)', () => {
  it('turns to the inspect stage on a revealed record, with its name and what is seen', async () => {
    const { coast, lantern, object } = world();
    await seated(coast, playerStage({ objects: [object] }));
    expect(view()).toBe('stage');

    act(() => {
      props().onInspect?.(lantern.id);
    });
    expect(view()).toBe('inspect');
    const stage = within(screen.getByTestId('inspect-stage'));
    expect(await stage.findByRole('heading', { name: 'Storm lantern' })).toBeDefined();
    expect(stage.getByText('Its glass is cracked.')).toBeDefined();
    expect(screen.getByTestId('inspect-stage').dataset['image']).toContain(
      lantern.visualAssetId ?? 'missing',
    );

    fireEvent.click(stage.getByRole('button', { name: 'Stop inspecting' }));
    expect(view()).toBe('stage');
  });

  it('writes a sticky note that lands in the journal, then backs out with Escape', async () => {
    const { coast, lantern, object, fetchMock } = world();
    await seated(coast, playerStage({ objects: [object] }));
    act(() => {
      props().onInspect?.(lantern.id);
    });
    await screen.findByRole('heading', { name: 'Storm lantern' });

    fireEvent.click(screen.getByRole('button', { name: 'Post note' }));
    expect(view()).toBe('note');
    const note = screen.getByLabelText('Sticky note on Storm lantern');
    fireEvent.change(note, { target: { value: 'It hums at night' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    // The note peels away and a blank one is under it.
    expect(await screen.findByTestId('peeling-note')).toBeDefined();
    expect(screen.getByLabelText('Sticky note on Storm lantern')).toHaveProperty('value', '');
    const posted = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posted.map(([input]) => urlOf(input))).toEqual([
      `/api/campaigns/${coast.id}/journal/records/${lantern.id}/notes`,
    ]);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(view()).toBe('inspect');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(view()).toBe('stage');
  });

  it('puts a record away when the GM hides it while it is being inspected', async () => {
    const { coast, lantern, object, fetchMock } = world();
    await seated(coast, playerStage({ objects: [object] }));
    act(() => {
      props().onInspect?.(lantern.id);
    });
    await screen.findByRole('heading', { name: 'Storm lantern' });

    // The GM un-reveals it: the journal no longer has it.
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input, init) =>
      urlOf(input).endsWith(`/journal/records/${lantern.id}`)
        ? Promise.resolve(Response.json({ message: 'Record not found' }, { status: 404 }))
        : (original?.(input, init) ?? Promise.reject(new Error('fetch is not mocked'))),
    );
    const before = gets(fetchMock, `/journal/records/${lantern.id}`);
    serverSends(PLAY_SOCKET.journalChanged);
    await waitFor(() => {
      expect(view()).toBe('stage');
    });
    expect(gets(fetchMock, `/journal/records/${lantern.id}`)).toBeGreaterThan(before);
  });

  it('gives the GM no inspect stage: pressing a cutout picks it', async () => {
    const { coast } = world('gm');
    await seated(coast, gmStage());
    expect(props().onInspect).toBeUndefined();
    expect(props().onSelect).toBeDefined();
  });
});

describe('The binder at the table (F3.5b)', () => {
  async function openBinder(role: 'player' | 'gm' = 'player', noteCount = 2) {
    const made = world(role, noteCount);
    await seated(made.coast, role === 'gm' ? gmStage() : playerStage());
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }));
    expect(view()).toBe('binder');
    return made;
  }

  const sections = () =>
    within(screen.getByRole('list', { name: 'Journal sections' }))
      .getAllByRole('button')
      .map((line) => line.textContent);

  it('opens at the key: Player entries first, then each type with something revealed', async () => {
    await openBinder();
    await waitFor(() => {
      expect(sections()).toEqual(['Player entries (0)', 'NPCs (1)', 'Props (1)']);
    });
  });

  it('turns to a type, then a record with its three newest notes, and back a page at a time', async () => {
    await openBinder('player', 5);
    fireEvent.click(await screen.findByRole('button', { name: 'Props (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Storm lantern' }));

    expect(await screen.findByRole('heading', { name: 'Storm lantern' })).toBeDefined();
    const stickies = () =>
      within(screen.getByRole('list', { name: 'Sticky notes' }))
        .getAllByRole('listitem')
        .map((item) => item.querySelector('p')?.textContent);
    await waitFor(() => {
      expect(stickies()).toEqual(['Note 5', 'Note 4', 'Note 3']);
    });
    expect(screen.getByRole('button', { name: 'Newer notes' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Older notes' }));
    expect(stickies()).toEqual(['Note 2', 'Note 1']);
    expect(screen.getByRole('button', { name: 'Older notes' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(await screen.findByRole('heading', { name: 'Props' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(await screen.findByRole('heading', { name: 'Journal' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(view()).toBe('stage');
  });

  it('writes a new entry on a blank page and turns to it', async () => {
    const { fetchMock } = await openBinder();
    fireEvent.click(await screen.findByRole('button', { name: /^Player entries/ }));
    fireEvent.click(await screen.findByRole('button', { name: '+ New entry' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Tide times' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Low at dawn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { name: 'Tide times' })).toBeDefined();
    expect(screen.getByText('Low at dawn')).toBeDefined();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
    // Back skips the blank page.
    fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(await screen.findByRole('heading', { name: 'Player entries' })).toBeDefined();
  });

  it('posts a note from a record’s page on the pad beside the binder', async () => {
    await openBinder();
    fireEvent.click(await screen.findByRole('button', { name: 'NPCs (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Old Maren' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Post note' }));

    expect(view()).toBe('binder');
    fireEvent.change(screen.getByLabelText('Sticky note on Old Maren'), {
      target: { value: 'Kind eyes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      const stickies = within(screen.getByRole('list', { name: 'Sticky notes' }));
      expect(stickies.getByText('Kind eyes')).toBeDefined();
    });
  });

  it('reads again when the journal changes', async () => {
    const { fetchMock } = await openBinder();
    await waitFor(() => {
      expect(gets(fetchMock, '/journal/records')).toBeGreaterThan(0);
    });
    const before = gets(fetchMock, '/journal/records');
    serverSends(PLAY_SOCKET.journalChanged);
    await waitFor(() => {
      expect(gets(fetchMock, '/journal/records')).toBeGreaterThan(before);
    });
  });

  it('gives the GM the binder, with no new entries', async () => {
    await openBinder('gm');
    fireEvent.click(await screen.findByRole('button', { name: /^Player entries/ }));
    expect(await screen.findByText('No player entries yet.')).toBeDefined();
    expect(screen.queryByRole('button', { name: '+ New entry' })).toBeNull();
  });
});

describe('The sheet page and rolls at the table (F3.6)', () => {
  const VEX = uuid();
  const BRAM = uuid();

  /** A campaign where Mira plays Vex, with Agility +2, 2 Hope and an own Hope bonus of +1. */
  function party(withPc = true) {
    const coast = campaign({ name: 'Painted Coast', role: 'player' });
    const vex = {
      id: VEX,
      name: 'Vex',
      hope: 2,
      hopeBonus: 1,
      traits: { agility: 2, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
      assignedToUserId: MIRA.id,
    };
    const fetchMock = mockApi(MIRA, [coast], {
      campaignData: { [coast.id]: { characters: withPc ? [vex] : [] } },
    });
    return { coast, fetchMock };
  }

  function called(overrides: Partial<RollCall> = {}): RollCall {
    return {
      id: uuid(),
      characterId: VEX,
      characterName: 'Vex',
      trait: 'agility',
      difficulty: 12,
      hidden: false,
      label: 'Climb the wall',
      ...overrides,
    };
  }

  it('looks down at the sheet from the Sheet button, with Hope as pips, and back', async () => {
    const { coast } = party();
    await seated(coast, playerStage());

    fireEvent.click(await screen.findByRole('button', { name: 'Sheet' }));
    expect(view()).toBe('sheet');
    const sheet = within(await screen.findByRole('region', { name: 'Your sheet' }));
    expect(await sheet.findByLabelText('Hope: 2 of 6')).toBeDefined();
    expect(sheet.queryByRole('group', { name: 'Called roll' })).toBeNull();

    fireEvent.click(sheet.getByRole('button', { name: 'Put the sheet down' }));
    expect(view()).toBe('stage');
  });

  it('gives a player without a PC no sheet', async () => {
    const { coast } = party(false);
    await seated(coast, playerStage());
    expect(await screen.findByRole('button', { name: 'Journal' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Sheet' })).toBeNull();
    expect(props().table?.sheet).toBeNull();
  });

  it('tells the player when the GM calls a roll, and rolls it from the sheet with Hope spent', async () => {
    const { coast } = party();
    const call = called();
    await seated(coast, playerStage({ calls: [call] }));

    expect(
      await screen.findByText('The GM calls for a roll: Agility, Climb the wall'),
    ).toBeDefined();
    await waitFor(() => {
      expect(props().table?.sheet?.waiting).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Go to sheet' }));
    expect(view()).toBe('sheet');
    expect(screen.queryByText('The GM calls for a roll: Agility, Climb the wall')).toBeNull();

    const panel = within(await screen.findByRole('group', { name: 'Called roll' }));
    expect(panel.getByText('Agility +2 · Climb the wall')).toBeDefined();
    expect(panel.getByText('Difficulty 12')).toBeDefined();
    fireEvent.click(await panel.findByRole('checkbox', { name: /Spend 1 Hope for \+3/ }));
    fireEvent.click(panel.getByRole('button', { name: 'Roll' }));
    expect(socket.last(PLAY_SOCKET.makeRoll).payload).toEqual({ callId: call.id, spendHope: true });

    await answer(PLAY_SOCKET.makeRoll, { ok: true });
    // Back to the theater, to watch the dice land.
    await waitFor(() => {
      expect(view()).toBe('stage');
    });
  });

  it('says why a roll was refused, and keeps the sheet open', async () => {
    const { coast } = party();
    await seated(coast, playerStage({ calls: [called({ difficulty: null, hidden: true })] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Go to sheet' }));
    const panel = within(await screen.findByRole('group', { name: 'Called roll' }));
    expect(panel.getByText('Difficulty hidden')).toBeDefined();

    fireEvent.click(panel.getByRole('button', { name: 'Roll' }));
    await answer(PLAY_SOCKET.makeRoll, { ok: false, message: 'That roll is no longer called' });
    expect((await panel.findByRole('alert')).textContent).toBe('That roll is no longer called');
    expect(view()).toBe('sheet');
  });

  it('says who else is rolling, and reads the sheet again when it changes', async () => {
    const { coast, fetchMock } = party();
    await seated(
      coast,
      playerStage({
        calls: [called({ characterId: BRAM, characterName: 'Bram', trait: 'instinct' })],
      }),
    );
    expect(await screen.findByText(/Bram is rolling Instinct/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Go to sheet' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sheet' }));
    await screen.findByLabelText('Hope: 2 of 6');
    const sheetPath = `/characters/${VEX}`;
    const before = gets(fetchMock, sheetPath);
    serverSends(PLAY_SOCKET.sheetChanged, { characterId: BRAM });
    serverSends(PLAY_SOCKET.sheetChanged, { characterId: VEX });
    await waitFor(() => {
      expect(gets(fetchMock, sheetPath)).toBe(before + 1);
    });
  });

  it('puts the dice and the Fear on the table, and tells the roll once the dice land', async () => {
    const { coast } = party();
    await seated(coast, playerStage({ fear: 4 }));
    expect(props().table?.dice).toBeNull();
    expect(props().table?.fear).toMatchObject({ count: 4, spendId: null });

    const roll: RollResult = {
      id: uuid(),
      characterId: VEX,
      characterName: 'Vex',
      trait: 'agility',
      label: 'Climb the wall',
      dice: { hope: 9, fear: 4 },
      modifier: 2,
      hopeBonus: 3,
      total: 18,
      critical: false,
      gained: 'hope',
      difficulty: null,
      success: null,
      hidden: true,
      revealed: false,
      at: '2026-11-17T20:00:00.000Z',
    };
    serverSends(PLAY_SOCKET.stage, playerStage({ fear: 4, lastRoll: roll }));
    await waitFor(() => {
      expect(props().table?.dice).toEqual({ id: roll.id, hope: 9, fear: 4 });
    });
    const told = await screen.findByRole('status', { name: 'Roll result' }, { timeout: 3000 });
    expect(told.textContent).toContain('Vex rolled Agility (Climb the wall)');
    expect(told.textContent).toContain('9 + 4 + 2 + 3 = 18: result hidden with Hope');

    const spend = { id: uuid(), amount: 2, reason: 'The bridge gives way' };
    serverSends(PLAY_SOCKET.stage, playerStage({ fear: 2, lastRoll: roll, lastFearSpend: spend }));
    await waitFor(() => {
      expect(props().table?.fear).toMatchObject({ count: 2, spendId: spend.id });
    });
    expect(await screen.findByText('The GM spends 2 Fear: The bridge gives way')).toBeDefined();
  });

  describe('the dice tray (F4.2)', () => {
    const BRAM_USER = uuid();
    const freeRoll = (overrides: Partial<FreeRoll> = {}): FreeRoll => ({
      id: uuid(),
      userId: MIRA.id,
      rollerName: 'Vex',
      die: 6,
      results: [5, 3, 2],
      total: 10,
      private: false,
      at: '2026-11-20T12:00:00.000Z',
      ...overrides,
    });

    beforeEach(() => {
      // The result at once, with no playback to wait through.
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      return () => {
        vi.unstubAllGlobals();
      };
    });

    async function tray() {
      const { coast } = party();
      await seated(coast, playerStage());
      fireEvent.click(await screen.findByRole('button', { name: 'Sheet' }));
      return within(await screen.findByRole('group', { name: 'Dice tray' }));
    }

    it('rolls from the sheet page, back to the theater, and tosses the dice on the table', async () => {
      const dice = await tray();
      expect(dice.queryByLabelText('Private')).toBeNull();
      fireEvent.click(dice.getByRole('button', { name: 'd6' }));
      expect(dice.getByRole('button', { name: 'd6' }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.change(dice.getByLabelText('How many dice'), { target: { value: '3' } });
      fireEvent.click(dice.getByRole('button', { name: 'Roll 3' }));
      expect(socket.last(PLAY_SOCKET.freeRoll).payload).toEqual({
        die: 6,
        count: 3,
        private: false,
      });

      const mine = freeRoll();
      serverSends(PLAY_SOCKET.freeRoll, mine);
      // The sheet page says no result: the dice and the notice do (D-60).
      expect(dice.queryByRole('status', { name: 'Dice result' })).toBeNull();
      await answer(PLAY_SOCKET.freeRoll, { ok: true });
      await waitFor(() => {
        expect(view()).toBe('stage');
      });
      expect(props().table?.freeDice).toEqual({ id: mine.id, die: 6, results: [5, 3, 2] });

      // The roller is told too.
      const notice = within(await screen.findByRole('status', { name: 'Dice rolled' }));
      expect(notice.getByText('Vex rolled 3d6')).toBeDefined();
      expect(notice.getByText('3d6: 5 + 3 + 2 = 10')).toBeDefined();
    });

    it('asks for 1 to 20 dice, and says why a roll was refused', async () => {
      const dice = await tray();
      fireEvent.change(dice.getByLabelText('How many dice'), { target: { value: '21' } });
      expect(dice.getByText('From 1 to 20 dice')).toBeDefined();
      expect(dice.getByRole('button', { name: 'Roll N' })).toHaveProperty('disabled', true);

      fireEvent.change(dice.getByLabelText('How many dice'), { target: { value: '2' } });
      fireEvent.click(dice.getByRole('button', { name: 'Roll 2' }));
      await answer(PLAY_SOCKET.freeRoll, { ok: false, message: 'Too quick: wait a moment' });
      expect((await dice.findByRole('alert')).textContent).toBe('Too quick: wait a moment');
    });

    it("tosses someone else's roll and tells it, as the dice land", async () => {
      const { coast } = party();
      await seated(coast, playerStage());
      const theirs = freeRoll({
        userId: BRAM_USER,
        rollerName: 'Bram',
        die: 20,
        results: [14],
        total: 14,
      });
      serverSends(PLAY_SOCKET.freeRoll, theirs);
      expect(props().table?.freeDice).toEqual({ id: theirs.id, die: 20, results: [14] });
      const notice = within(await screen.findByRole('status', { name: 'Dice rolled' }));
      expect(notice.getByText('Bram rolled a d20')).toBeDefined();
      expect(notice.getByText('d20: 14')).toBeDefined();
    });

    it('tells a roll as it goes while the dice are still in the air', async () => {
      vi.unstubAllGlobals();
      const { coast } = party();
      await seated(coast, playerStage());
      serverSends(
        PLAY_SOCKET.freeRoll,
        freeRoll({ userId: BRAM_USER, rollerName: 'Bram', die: 8, results: [7, 2], total: 9 }),
      );
      const notice = within(await screen.findByRole('status', { name: 'Dice rolling' }));
      expect(notice.getByText('Bram rolls 2d8')).toBeDefined();
      expect(notice.getByText('…')).toBeDefined();
    });
  });
});

describe('Puppet motion at the table (F3.7)', () => {
  const VEX = uuid();

  /** A campaign where Mira plays Vex, whose puppet is raised beside Old Marta's. */
  function puppets(role: 'player' | 'gm' = 'player') {
    const coast = campaign({ name: 'Painted Coast', role });
    const vex = {
      id: VEX,
      name: 'Vex',
      hope: 2,
      traits: { agility: 2, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
      assignedToUserId: MIRA.id,
    };
    mockApi(MIRA, [coast], { campaignData: { [coast.id]: { characters: [vex] } } });
    const vexPuppet = playerObject(2, {
      kind: 'puppet',
      mount: null,
      recordId: null,
      characterId: VEX,
    });
    const marta = playerObject(3, { kind: 'puppet', mount: null, recordId: null });
    return { coast, vexPuppet, marta };
  }

  it('opens the emote card on a player’s own puppet, and plays the one picked', async () => {
    const { coast, vexPuppet, marta } = puppets();
    await seated(coast, playerStage({ objects: [vexPuppet, marta] }));
    await waitFor(() => {
      expect(props().own?.characterId).toBe(VEX);
    });
    expect(props().own?.menu).toBeNull();

    act(() => {
      props().own?.onPress(vexPuppet.id);
    });
    const card = within(await screen.findByRole('region', { name: /^Emotes/ }));
    expect(card.getAllByRole('button')).toHaveLength(11);

    fireEvent.click(card.getByRole('button', { name: 'Wave' }));
    expect(socket.last(PLAY_SOCKET.emote).payload).toEqual({ id: vexPuppet.id, emote: 'wave' });
    expect(screen.queryByRole('region', { name: /^Emotes/ })).toBeNull();
    await answer(PLAY_SOCKET.emote, { ok: true });
  });

  it('closes the card with Escape, its close mark, or a click away', async () => {
    const { coast, vexPuppet } = puppets();
    await seated(coast, playerStage({ objects: [vexPuppet] }));
    await waitFor(() => {
      expect(props().own).toBeDefined();
    });
    const open = async () => {
      act(() => {
        props().own?.onPress(vexPuppet.id);
      });
      return within(await screen.findByRole('region', { name: /^Emotes/ }));
    };

    await open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /^Emotes/ })).toBeNull();

    fireEvent.click((await open()).getByRole('button', { name: 'Close emotes' }));
    expect(screen.queryByRole('region', { name: /^Emotes/ })).toBeNull();

    await open();
    act(() => {
      props().own?.onClose();
    });
    expect(screen.queryByRole('region', { name: /^Emotes/ })).toBeNull();
    expect(socket.requests.filter((sent) => sent.event === PLAY_SOCKET.emote)).toHaveLength(0);
  });

  it('gives the GM no emote card of their own', async () => {
    const { coast, vexPuppet } = puppets('gm');
    await seated(coast, gmStage());
    expect(props().own).toBeUndefined();
    expect(vexPuppet.characterId).toBe(VEX);
  });

  it('shows the puppet of whoever is talking, and the emotes played', async () => {
    const { coast, vexPuppet, marta } = puppets();
    await seated(coast, playerStage({ objects: [vexPuppet, marta] }));

    serverSends(PLAY_SOCKET.presence, [
      present(1, 'Mira', { characterId: VEX, characterName: 'Vex', speaking: true }),
    ]);
    expect([...(props().motion?.talking ?? [])]).toEqual([vexPuppet.id]);

    const played = { id: uuid(), objectId: marta.id, emote: 'bow' };
    serverSends(PLAY_SOCKET.emote, played);
    expect(props().motion?.emotes[marta.id]).toEqual(played);
  });

  it('moves the NPC the GM voices, and leaves the GM’s own picture plain (F3.8)', async () => {
    const { coast, vexPuppet, marta } = puppets();
    await seated(coast, playerStage({ objects: [vexPuppet, marta] }));

    serverSends(PLAY_SOCKET.presence, [
      present(0, 'Dana', { role: 'gm', speaking: true, voicing: marta.id }),
    ]);
    expect([...(props().motion?.talking ?? [])]).toEqual([marta.id]);
    const gmRow = screen.getByRole('list', { name: 'Who is here' }).querySelector('li');
    expect(gmRow?.hasAttribute('data-speaking')).toBe(false);
    // Players are not told whose voice it is.
    expect(gmRow?.textContent).toContain('GM');
  });

  it('tells the server while T is held, but not while typing', async () => {
    const { coast } = puppets();
    await seated(coast, playerStage());
    const spoken = () =>
      socket.emitted
        .filter((sent) => sent.event === PLAY_SOCKET.speaking)
        .map((sent) => (sent.payload as { speaking: boolean }).speaking);

    fireEvent.keyDown(window, { key: 't' });
    expect(spoken()).toEqual([true]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SPEAKING_GAP_MS));
    });
    fireEvent.keyUp(window, { key: 't' });
    expect(spoken()).toEqual([true, false]);

    const field = document.createElement('textarea');
    document.body.append(field);
    fireEvent.keyDown(field, { key: 't' });
    field.remove();
    expect(spoken()).toEqual([true, false]);
  });
});

describe('Hearing talk at the table (F3.9)', () => {
  it('asks for the mic on joining, and shows how it is doing', async () => {
    const asked: MediaStreamConstraints[] = [];
    vi.stubGlobal('AudioContext', vi.fn());
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: (constraints: MediaStreamConstraints) => {
          asked.push(constraints);
          return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        },
      },
    });
    try {
      const coast = campaign({ name: 'Painted Coast', role: 'player' });
      mockApi(MIRA, [coast]);
      await seated(coast, playerStage());

      expect(asked).toHaveLength(1);
      expect(asked[0]?.audio).toMatchObject({ echoCancellation: true });
      expect(await screen.findByText('Mic blocked')).toBeDefined();
      expect(screen.getByText(/Allow it in the site settings/)).toBeDefined();
    } finally {
      Reflect.deleteProperty(navigator, 'mediaDevices');
      vi.unstubAllGlobals();
    }
  });
});

describe('The cards beside the sheet page (F4.7)', () => {
  const VEX = uuid();
  const GRACE = uuid();
  const BLADE = uuid();
  const INSPIRE = uuid();
  const WHIRL = uuid();
  const FAERIE = uuid();

  /** Mira plays Vex: a Faerie with Inspirational Words in the loadout and Whirlwind in the vault. */
  function party() {
    const coast = campaign({ name: 'Painted Coast', role: 'player' });
    const vex = {
      id: VEX,
      name: 'Vex',
      stressMax: 6,
      assignedToUserId: MIRA.id,
      links: {
        classId: null,
        subclassId: null,
        subclassCards: 1,
        speciesIds: [FAERIE, null] as [string | null, string | null],
        primaryWeaponId: null,
        secondaryWeaponId: null,
        armorId: null,
        spareWeaponIds: [],
      },
    };
    const fetchMock = mockApi(MIRA, [coast], {
      campaignData: { [coast.id]: { characters: [vex] } },
      domains: {
        [coast.id]: [
          { id: GRACE, name: 'Grace' },
          { id: BLADE, name: 'Blade' },
        ],
      },
      domainCards: {
        [coast.id]: [
          { id: INSPIRE, domainId: GRACE, name: 'Inspirational Words', level: 1, recallCost: 1 },
          { id: WHIRL, domainId: BLADE, name: 'Whirlwind', level: 1, recallCost: 2 },
        ],
      },
      species: {
        [coast.id]: [
          {
            id: FAERIE,
            name: 'Faerie',
            features: [
              { name: 'Luckbender', text: '' },
              { name: 'Wings', text: '' },
            ],
          },
        ],
      },
      heldCards: {
        [VEX]: [
          { cardId: INSPIRE, place: 'loadout' as const },
          { cardId: WHIRL, place: 'vault' as const },
        ],
      },
    });
    return { coast, fetchMock };
  }

  const moves = (fetchMock: FetchMock) =>
    fetchMock.mock.calls
      .filter(([input, init]) => init?.method === 'POST' && urlOf(input).endsWith('/move'))
      .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));

  it('lays the piles and the ancestry beside the sheet, and the cards are not on the page', async () => {
    const { coast } = party();
    await seated(coast, playerStage());
    expect(props().table?.sheet?.cards).not.toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Sheet' }));
    const loadout = within(await screen.findByRole('region', { name: 'Loadout' }));
    expect(
      loadout.getByRole('article', { name: 'Inspirational Words, a Grace card' }),
    ).toBeDefined();
    const vault = within(screen.getByRole('region', { name: 'Vault' }));
    expect(vault.getByRole('article', { name: 'Whirlwind, a Blade card' })).toBeDefined();
    expect(screen.getByRole('article', { name: 'Faerie, the species' })).toBeDefined();

    const page = within(screen.getByRole('region', { name: 'Your sheet' }));
    expect(page.queryByRole('article')).toBeNull();
  });

  it('recalls a card for Stress, and free while the GM has Rest on', async () => {
    const { coast, fetchMock } = party();
    await seated(coast, playerStage());
    fireEvent.click(await screen.findByRole('button', { name: 'Sheet' }));
    const vault = within(await screen.findByRole('region', { name: 'Vault' }));
    expect(
      vault.getByRole('button', { name: 'Bring Whirlwind to the loadout (2 Stress)' }),
    ).toBeDefined();
    expect(vault.queryByText('Rest: swaps are free')).toBeNull();

    serverSends(PLAY_SOCKET.stage, playerStage({ rest: true }));
    expect(await vault.findByText('Rest: swaps are free')).toBeDefined();
    fireEvent.click(
      vault.getByRole('button', { name: 'Bring Whirlwind to the loadout (free: Rest)' }),
    );
    await waitFor(() => {
      expect(moves(fetchMock)).toEqual([{ to: 'loadout' }]);
    });
    const loadout = within(screen.getByRole('region', { name: 'Loadout' }));
    expect(await loadout.findByText('2 of 5')).toBeDefined();
  });
});
