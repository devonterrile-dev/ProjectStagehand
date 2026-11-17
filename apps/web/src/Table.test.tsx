import { PLAY_SOCKET, type Campaign, type LiveStage, type RichText } from '@stagehand/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayCanvasProps } from '@/stage/PlayCanvas';
import { campaign, MIRA, mockApi, record, renderAt, uuid } from '@/test/app-harness';
import { fakePlaySocket, type FakePlaySocket } from '@/test/fake-play-socket';
import type { NoteSeed } from '@/test/journal-world';
import { gmStage, playerObject, playerStage, present } from '@/test/play-fixtures';

// jsdom has no WebGL, so the 3D theater is replaced by a stand-in. It shows where the camera
// rests and draws the table's HTML pieces as they would be laid on the table (F3.5b).
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
