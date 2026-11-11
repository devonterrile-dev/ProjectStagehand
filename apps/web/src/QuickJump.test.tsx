import type { Campaign } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  campaign,
  currentUrl,
  failRequests,
  MIRA,
  mockApi,
  record,
  renderAt,
  statBlock,
  uuid,
} from '@/test/app-harness';

type FetchMock = ReturnType<typeof mockApi>;

const PC_ID = uuid();

function world(overrides: Partial<Campaign> = {}) {
  const coast = campaign({ name: 'Shattered Coast', ...overrides });
  const harbor = record({ type: 'area', name: 'Harbor District' });
  const vex = record({ type: 'npc', name: 'Captain Vex' });
  const bruiser = statBlock({ name: 'Vex Bruiser' });
  const fetchMock = mockApi(MIRA, [coast], {
    campaignData: {
      [coast.id]: {
        records: [vex, harbor],
        statBlocks: [bruiser],
        characters: [{ id: PC_ID, name: 'Vexa Thorn' }],
      },
    },
  });
  return { coast, harbor, vex, bruiser, fetchMock };
}

const campaignUrl = (c: Campaign) => `/campaigns/${c.id}`;

function pressShortcut() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
}

const input = () =>
  screen.getByRole('combobox', { name: 'Search records, stat blocks and characters' });

function patches(fetchMock: FetchMock): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('Quick jump', () => {
  it('opens with Ctrl+K and from the header button', async () => {
    const { coast } = world();
    renderAt(campaignUrl(coast));

    const button = await screen.findByRole('button', { name: 'Search' });
    pressShortcut();
    expect(await screen.findByRole('dialog', { name: 'Quick jump' })).toBeDefined();
    expect(screen.getByText('Search records, stat blocks and characters')).toBeDefined();

    fireEvent.keyDown(input(), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(button);
    expect(await screen.findByRole('dialog', { name: 'Quick jump' })).toBeDefined();
  });

  it('finds records, stat blocks and characters, and opens one from the keyboard', async () => {
    const { coast, bruiser } = world();
    renderAt(campaignUrl(coast));
    await screen.findByRole('button', { name: 'Search' });
    pressShortcut();

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'vex' } });

    const records = await screen.findByRole('group', { name: 'Records' });
    expect(within(records).getByRole('option').textContent).toContain('Captain Vex');
    expect(
      within(screen.getByRole('group', { name: 'Stat blocks' })).getByRole('option').textContent,
    ).toContain('Vex Bruiser');
    expect(
      within(screen.getByRole('group', { name: 'Characters' })).getByRole('option').textContent,
    ).toContain('Vexa Thorn');
    expect(within(records).getByRole('option', { selected: true })).toBeDefined();

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(
      within(screen.getByRole('group', { name: 'Stat blocks' })).getByRole('option', {
        selected: true,
      }),
    ).toBeDefined();
    fireEvent.keyDown(input(), { key: 'Enter' });

    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${coast.id}/stat-blocks/${bruiser.id}`);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says when nothing matches', async () => {
    const { coast } = world();
    renderAt(campaignUrl(coast));
    await screen.findByRole('button', { name: 'Search' });
    pressShortcut();

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No matches')).toBeDefined();
  });

  it('lists what was opened lately, newest first, without deleted items', async () => {
    const { coast, vex } = world();
    window.localStorage.setItem(
      `stagehand:recent:${coast.id}`,
      JSON.stringify([{ kind: 'record', id: uuid() }]),
    );
    renderAt(`/campaigns/${coast.id}/records/${vex.id}`);
    await screen.findByRole('textbox', { name: 'Name' });

    pressShortcut();
    const recent = await screen.findByRole('group', { name: 'Recent' });
    expect(
      within(recent)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining('Captain Vex')]);

    fireEvent.change(input(), { target: { value: 'vexa' } });
    fireEvent.keyDown(await screen.findByRole('combobox'), { key: 'ArrowDown' });
    await screen.findByRole('group', { name: 'Characters' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${coast.id}/characters/${PC_ID}`);
    });
    await screen.findByRole('textbox', { name: 'Character name' });

    pressShortcut();
    const again = await screen.findByRole('group', { name: 'Recent' });
    expect(
      within(again)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining('Vexa Thorn'), expect.stringContaining('Captain Vex')]);
  });

  it('waits for the open record to save before leaving', async () => {
    const { coast, vex, harbor, fetchMock } = world();
    renderAt(`/campaigns/${coast.id}/records/${vex.id}`);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), {
      target: { value: 'Captain Vex II' },
    });
    pressShortcut();
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'harbor' } });
    await screen.findByRole('group', { name: 'Records' });
    fireEvent.keyDown(input(), { key: 'Enter' });

    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${coast.id}/records/${harbor.id}`);
    });
    expect(patches(fetchMock)).toEqual([{ name: 'Captain Vex II' }]);
  });

  it('stays on the record when its save fails', async () => {
    const { coast, vex, fetchMock } = world();
    renderAt(`/campaigns/${coast.id}/records/${vex.id}`);

    const name = await screen.findByRole('textbox', { name: 'Name' });
    failRequests(fetchMock, 'PATCH', 500, 'Database is down');
    fireEvent.change(name, { target: { value: 'Captain Vex II' } });
    pressShortcut();
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'harbor' } });
    await screen.findByRole('group', { name: 'Records' });
    fireEvent.keyDown(input(), { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(currentUrl()).toBe(`/campaigns/${coast.id}/records/${vex.id}`);
    expect(await screen.findByText(/Couldn't save: Database is down/)).toBeDefined();
  });

  it('is not there for players', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(campaignUrl(coast));

    await screen.findByText(/Records are the GM/);
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    pressShortcut();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is not there outside a campaign', async () => {
    world();
    renderAt('/');

    await screen.findByRole('link', { name: 'Your profile' });
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    pressShortcut();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
