import type { Campaign, StatBlock } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  campaign,
  currentUrl,
  MIRA,
  mockApi,
  record,
  renderAt,
  statBlock,
} from '@/test/app-harness';

type FetchMock = ReturnType<typeof mockApi>;

/** Opens a Radix dropdown menu from the keyboard (jsdom has no real pointer events). */
function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
}

/** The parsed JSON bodies of every request with `method`, in order. */
function bodiesOf(fetchMock: FetchMock, method: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));
}

/** A campaign with a Reef Shark stat block, a Captain Rook NPC and a Harbor area. */
function world(overrides: Partial<Campaign> = {}) {
  const coast = campaign({ name: 'Shattered Coast', ...overrides });
  const shark = statBlock({
    name: 'Reef Shark',
    tier: 2,
    role: 'Bruiser',
    hpMax: 6,
    standardAttack: { name: 'Bite', range: 'Melee', damageDice: '2d8+3', damageType: 'physical' },
  });
  const rook = record({ type: 'npc', name: 'Captain Rook' });
  const harbor = record({ type: 'area', name: 'Harbor' });
  const fetchMock = mockApi(MIRA, [coast], {
    campaignData: { [coast.id]: { statBlocks: [shark], records: [rook, harbor] } },
  });
  return { coast, shark, rook, harbor, fetchMock };
}

const listUrl = (c: Campaign) => `/campaigns/${c.id}/stat-blocks`;
const blockUrl = (c: Campaign, b: StatBlock) => `/campaigns/${c.id}/stat-blocks/${b.id}`;

describe('Stat blocks list', () => {
  it('is linked from the campaign page and lists the blocks', async () => {
    const { coast } = world();
    renderAt(`/campaigns/${coast.id}`);

    fireEvent.click(await screen.findByRole('link', { name: 'Open stat blocks' }));
    const list = await screen.findByRole('list', { name: 'Stat blocks' });
    expect(within(list).getByText('Reef Shark')).toBeDefined();
    expect(within(list).getByText('Tier 2')).toBeDefined();
    expect(within(list).getByText('Bruiser')).toBeDefined();
  });

  it('creates a stat block and opens it', async () => {
    const { coast } = world();
    renderAt(listUrl(coast));

    fireEvent.click(await screen.findByRole('button', { name: 'New stat block' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gull Swarm' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create stat block' }));

    await waitFor(() => {
      expect(currentUrl()).toMatch(new RegExp(`^${listUrl(coast)}/.+`));
    });
    expect(await screen.findByRole('textbox', { name: 'Stat block name' })).toHaveProperty(
      'value',
      'Gull Swarm',
    );
  });

  it('tells players stat blocks are the GM’s, and never fetches them', async () => {
    const { coast, fetchMock } = world({ role: 'player' });
    renderAt(listUrl(coast));

    expect(await screen.findByText(/Only the GM can see them/)).toBeDefined();
    expect(
      fetchMock.mock.calls.some(([input]) => input === `/api/campaigns/${coast.id}/stat-blocks`),
    ).toBe(false);
  });
});

describe('The stat block editor', () => {
  it('saves numbers, allowing a negative attack modifier', async () => {
    const { coast, shark, fetchMock } = world();
    renderAt(blockUrl(coast, shark));

    const tier = await screen.findByLabelText('Tier');
    fireEvent.change(tier, { target: { value: '3' } });
    const modifier = screen.getByLabelText('Attack modifier');
    fireEvent.change(modifier, { target: { value: '-1' } });
    fireEvent.blur(modifier);

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ tier: 3, attackModifier: -1 }]);
    });
    expect(
      screen.getByText(/Each copy of this monster tracks its own HP and Stress/),
    ).toBeDefined();
  });

  it('removes and re-adds the standard attack', async () => {
    const { coast, shark, fetchMock } = world();
    renderAt(blockUrl(coast, shark));

    expect(await screen.findByRole('textbox', { name: 'Standard attack name' })).toHaveProperty(
      'value',
      'Bite',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove standard attack' }));
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ standardAttack: null }]);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add standard attack' }));
    const name = screen.getByRole('textbox', { name: 'Standard attack name' });
    fireEvent.change(name, { target: { value: 'Ram' } });
    fireEvent.blur(name);
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH').at(-1)).toEqual({
        standardAttack: { name: 'Ram', range: '', damageDice: '1d6', damageType: '' },
      });
    });
  });

  it('adds a feature with its kind and cost', async () => {
    const { coast, shark, fetchMock } = world();
    renderAt(blockUrl(coast, shark));

    fireEvent.click(await screen.findByRole('button', { name: 'Add feature' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Feature 1 name' }), {
      target: { value: 'Thrash' },
    });
    fireEvent.change(screen.getByLabelText('Feature 1 kind'), { target: { value: 'reaction' } });
    const cost = screen.getByRole('textbox', { name: 'Feature 1 cost' });
    fireEvent.change(cost, { target: { value: 'Mark a Stress' } });
    fireEvent.blur(cost);

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH').at(-1)).toEqual({
        features: [{ name: 'Thrash', kind: 'reaction', cost: 'Mark a Stress', description: '' }],
      });
    });
  });
});

describe('NPCs and stat blocks', () => {
  it('links an NPC, which then shows under Used by', async () => {
    const { coast, shark, rook, fetchMock } = world();
    renderAt(`/campaigns/${coast.id}/records/${rook.id}`);

    const select = await screen.findByLabelText('Stat block');
    await within(select).findByRole('option', { name: 'Reef Shark (tier 2)' });
    fireEvent.change(select, { target: { value: shark.id } });

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ statBlockId: shark.id }]);
    });
    fireEvent.click(await screen.findByRole('link', { name: 'Open' }));

    const usedBy = await screen.findByRole('list', { name: 'NPCs using this stat block' });
    expect(within(usedBy).getByRole('link', { name: 'Captain Rook' })).toBeDefined();
  });

  it('offers a stat block only on NPCs', async () => {
    const { coast, harbor } = world();
    renderAt(`/campaigns/${coast.id}/records/${harbor.id}`);

    await screen.findByRole('textbox', { name: 'Name' });
    expect(screen.queryByLabelText('Stat block')).toBeNull();
  });

  it('warns before deleting a block in use, then unlinks its NPCs', async () => {
    const { coast, shark, rook } = world();
    rook.statBlockId = shark.id;
    renderAt(blockUrl(coast, shark));

    await screen.findByRole('link', { name: 'Captain Rook' });
    openMenu('Stat block settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Captain Rook will lose its stat block/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(currentUrl()).toBe(listUrl(coast));
    });
    expect(await screen.findByText(/No stat blocks yet/)).toBeDefined();
  });
});
