import type { Campaign, CampaignRecord, PlayerEntry, RichText } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { campaign, currentUrl, MIRA, mockApi, record, renderAt, uuid } from '@/test/app-harness';
import type { NoteSeed } from '@/test/journal-world';

const REVEALED = '2026-11-16T12:00:00.000Z';
const ROWAN = { userId: uuid(), displayName: 'Rowan' };
const ME = { userId: MIRA.id, displayName: MIRA.displayName };

function text(words: string, ...mentions: CampaignRecord[]): RichText {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: words },
          ...mentions.map((r) => ({
            type: 'mention' as const,
            attrs: { id: r.id, label: r.name },
          })),
        ],
      },
    ],
  };
}

/** A campaign with two revealed records, one hidden, an entry and some notes. */
function world(role: 'player' | 'gm' = 'player', overrides: Partial<Campaign> = {}) {
  const coast = campaign({ name: 'Shattered Coast', role, ...overrides });
  const queen = record({ type: 'npc', name: 'The smuggler queen', tags: ['villain'] });
  const maren = record({
    type: 'npc',
    name: 'Old Maren',
    publicDescription: text('A keeper with salt-white hair.'),
    revealedAt: REVEALED,
  });
  const lamp = record({
    type: 'prop',
    name: 'Lighthouse lamp',
    publicDescription: text('Tended by ', maren, queen),
    revealedAt: REVEALED,
  });
  const map: PlayerEntry = {
    id: uuid(),
    title: 'Map of the caves',
    description: 'Left at the fork,\nthen down.',
    author: ROWAN,
    createdAt: '2026-11-16T10:00:00.000Z',
    updatedAt: '2026-11-16T10:00:00.000Z',
  };
  const notes: NoteSeed[] = [
    { id: uuid(), body: 'It hums at night', author: ROWAN, recordId: lamp.id },
    { id: uuid(), body: 'My first note', author: ME, recordId: lamp.id },
  ];
  const fetchMock = mockApi(MIRA, [coast], {
    campaignData: { [coast.id]: { records: [queen, maren, lamp] } },
    entries: { [coast.id]: [map] },
    notes: { [coast.id]: notes },
  });
  return { coast, queen, maren, lamp, map, fetchMock };
}

const listUrl = (c: Campaign) => `/campaigns/${c.id}/records`;
const recordUrl = (c: Campaign, r: { id: string }) => `/campaigns/${c.id}/records/${r.id}`;
const entryUrl = (c: Campaign, e: { id: string }) => `/campaigns/${c.id}/entries/${e.id}`;

const noteBodies = () =>
  within(screen.getByRole('list', { name: 'Notes' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('p')?.textContent);

/** The note at this place in the list, newest first. */
function noteItem(index: number): HTMLElement {
  const item = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem')[index];
  if (item === undefined) throw new Error(`No note at ${String(index)}`);
  return item;
}

describe('The journal list (F3.5)', () => {
  it('shows a player the revealed records, with entries first and only types that have some', async () => {
    const { coast } = world();
    renderAt(listUrl(coast));

    const list = await screen.findByRole('list', { name: 'Records' });
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Lighthouse lampProp', 'Old MarenNPC']);
    const chips = within(screen.getByRole('group', { name: 'Record types' }))
      .getAllByRole('button')
      .map((chip) => chip.textContent);
    expect(chips).toEqual(['Player entries (1)', 'All (2)', 'NPC (1)', 'Prop (1)']);
    expect(screen.queryByText('The smuggler queen')).toBeNull();
    expect(screen.queryByText('villain')).toBeNull();
  });

  it('switches to player entries, and searches them', async () => {
    const { coast } = world();
    renderAt(listUrl(coast));

    fireEvent.click(await screen.findByRole('button', { name: 'Player entries (1)' }));
    expect(currentUrl()).toBe(`${listUrl(coast)}?type=entries`);
    const entries = screen.getByRole('list', { name: 'Player entries' });
    expect(within(entries).getByText('Map of the caves')).toBeDefined();
    expect(within(entries).getByText(/Rowan/)).toBeDefined();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the journal' }), {
      target: { value: 'tide' },
    });
    expect(await screen.findByText('No entries match.')).toBeDefined();
    expect(currentUrl()).toBe(`${listUrl(coast)}?type=entries&q=tide`);
  });

  it('makes a new entry and opens it', async () => {
    const { coast } = world();
    renderAt(listUrl(coast));

    fireEvent.click(await screen.findByRole('button', { name: 'New entry' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Tide times' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Low at dawn' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create entry' }));

    expect(await screen.findByRole('heading', { name: 'Tide times' })).toBeDefined();
    expect(currentUrl()).toMatch(new RegExp(`^/campaigns/${coast.id}/entries/[0-9a-f-]{36}$`));
    expect(screen.getByText('Low at dawn')).toBeDefined();
  });

  it('gives the GM a Player entries chip on the records page', async () => {
    const { coast } = world('gm');
    renderAt(listUrl(coast));

    fireEvent.click(await screen.findByRole('button', { name: 'Player entries (1)' }));
    expect(
      within(screen.getByRole('list', { name: 'Player entries' })).getByText('Map of the caves'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'New entry' })).toBeNull();
  });
});

describe('A record in the journal (F3.5)', () => {
  it('shows its public layer, linking only revealed mentions', async () => {
    const { coast, lamp, maren } = world();
    renderAt(recordUrl(coast, lamp));

    expect(await screen.findByRole('heading', { name: 'Lighthouse lamp' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Old Maren' })).toHaveProperty(
      'href',
      expect.stringContaining(recordUrl(coast, maren)),
    );
    // The hidden queen's name is plain text, not a link.
    expect(screen.getByText('The smuggler queen')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'The smuggler queen' })).toBeNull();
  });

  it('lists notes newest first, with Edit and Delete on my own only', async () => {
    const { coast, lamp } = world();
    renderAt(recordUrl(coast, lamp));

    await screen.findByRole('list', { name: 'Notes' });
    expect(noteBodies()).toEqual(['My first note', 'It hums at night']);
    const [mine, rowans] = [noteItem(0), noteItem(1)];
    expect(within(mine).getByRole('button', { name: 'Edit' })).toBeDefined();
    expect(within(mine).getByText(/Mira ·/)).toBeDefined();
    expect(within(rowans).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(rowans).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('posts a note to the top, then edits and deletes it', async () => {
    const { coast, lamp } = world();
    renderAt(recordUrl(coast, lamp));

    fireEvent.change(await screen.findByLabelText('New note'), {
      target: { value: 'Smells of oil' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post note' }));
    await waitFor(() => {
      expect(noteBodies()[0]).toBe('Smells of oil');
    });
    expect(screen.getByLabelText('New note')).toHaveProperty('value', '');

    const top = () => noteItem(0);
    fireEvent.click(within(top()).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(top()).getByLabelText('Edit note'), {
      target: { value: 'Smells of whale oil' },
    });
    fireEvent.click(within(top()).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(noteBodies()[0]).toBe('Smells of whale oil');
    });

    fireEvent.click(within(top()).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete note' }));
    await waitFor(() => {
      expect(noteBodies()).toEqual(['My first note', 'It hums at night']);
    });
  });

  it('shows no box to post in an archived campaign', async () => {
    const { coast, lamp } = world('player', { archivedAt: '2026-11-16T00:00:00.000Z' });
    renderAt(recordUrl(coast, lamp));

    await screen.findByRole('list', { name: 'Notes' });
    expect(screen.queryByLabelText('New note')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('gives the GM the notes under a revealed record, with Delete on every note', async () => {
    const { coast, lamp } = world('gm');
    renderAt(recordUrl(coast, lamp));

    await screen.findByRole('list', { name: 'Notes' });
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
    // Only my own note can be edited, even by the GM.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });

  it('gives the GM no notes under a hidden record', async () => {
    const { coast, queen } = world('gm');
    renderAt(recordUrl(coast, queen));

    await screen.findByDisplayValue('The smuggler queen');
    expect(screen.queryByRole('heading', { name: 'Notes' })).toBeNull();
  });
});

describe('A player entry (F3.5)', () => {
  it('shows its author, notes, and Delete for the GM only', async () => {
    const { coast, map } = world('gm');
    renderAt(entryUrl(coast, map));

    expect(await screen.findByRole('heading', { name: 'Map of the caves' })).toBeDefined();
    expect(screen.getByText(/Rowan ·/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete entry' }));
    await waitFor(() => {
      expect(currentUrl()).toBe(`${listUrl(coast)}?type=entries`);
    });
  });

  it('lets its author edit it', async () => {
    const { coast } = world();
    renderAt(listUrl(coast));
    fireEvent.click(await screen.findByRole('button', { name: 'New entry' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Draft' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create entry' }));
    await screen.findByRole('heading', { name: 'Draft' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Final' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Final' })).toBeDefined();
  });
});
