import type { Campaign, CampaignRecord, RichText } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  campaign,
  currentUrl,
  failRequests,
  MIRA,
  mockApi,
  record,
  renderAt,
} from '@/test/app-harness';

type FetchMock = ReturnType<typeof mockApi>;

/** The parsed JSON bodies of every PATCH, in order. */
function patches(fetchMock: FetchMock): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));
}

/** Opens a Radix dropdown menu from the keyboard (jsdom has no real pointer events). */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

/** Text that @-mentions a record. */
function mentioning(target: { id: string; name: string }): RichText {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ask ' },
          { type: 'mention', attrs: { id: target.id, label: target.name } },
        ],
      },
    ],
  };
}

/** A campaign with an Area, a Spot, an NPC, two Factions and an Item. */
function world(extra: CampaignRecord[] = []) {
  const coast = campaign({ name: 'Shattered Coast' });
  const harbor = record({ type: 'area', name: 'Harbor District' });
  const market = record({ type: 'spot', name: 'Fish Market', parentId: harbor.id });
  const vex = record({ type: 'npc', name: 'Captain Vex' });
  const tide = record({ type: 'faction', name: 'Tide Guild' });
  const ash = record({ type: 'faction', name: 'Ash Circle' });
  const key = record({ type: 'item', name: 'Brass Key' });
  const records = [vex, harbor, market, tide, ash, key, ...extra];
  const fetchMock = mockApi(MIRA, [coast], { campaignData: { [coast.id]: { records } } });
  return { coast, harbor, market, vex, tide, ash, key, fetchMock };
}

const recordUrl = (c: Campaign, r: { id: string }) => `/campaigns/${c.id}/records/${r.id}`;

/** The options the picker labelled `name` offers right now, by name. */
function optionNames(name: string): string[] {
  return within(screen.getByRole('listbox', { name }))
    .getAllByRole('option')
    .map((option) => option.firstChild?.textContent ?? '');
}

/** Picks an option of the picker labelled `name` with the mouse. */
function pick(name: string, option: RegExp) {
  fireEvent.mouseDown(
    within(screen.getByRole('listbox', { name })).getByRole('option', { name: option }),
  );
}

describe('Link fields', () => {
  it('pick a home spot from Spots only, then clear it', async () => {
    const { coast, vex, market, fetchMock } = world();
    renderAt(recordUrl(coast, vex));

    const picker = await screen.findByRole('combobox', { name: 'Home spot' });
    fireEvent.focus(picker);
    expect(optionNames('Home spot')).toEqual(['Fish Market · Harbor District']);
    pick('Home spot', /Fish Market/);

    await waitFor(() => {
      expect(patches(fetchMock)).toEqual([{ links: { homeSpot: [market.id] } }]);
    });
    const field = screen.getByRole('list', { name: 'Home spot' });
    expect(within(field).getByRole('button', { name: 'Fish Market' })).toBeDefined();
    // A one-record field has no picker while it's full.
    expect(screen.queryByRole('combobox', { name: 'Home spot' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Fish Market from Home spot' }));
    await waitFor(() => {
      expect(patches(fetchMock)).toHaveLength(2);
    });
    expect(patches(fetchMock)[1]).toEqual({ links: { homeSpot: [] } });
    expect(await screen.findByRole('combobox', { name: 'Home spot' })).toBeDefined();
  });

  it('search as the GM types and pick with the keyboard', async () => {
    const { coast, vex, tide, ash, fetchMock } = world();
    renderAt(recordUrl(coast, vex));

    const picker = await screen.findByRole('combobox', { name: 'Factions' });
    fireEvent.focus(picker);
    expect(optionNames('Factions')).toEqual(['Ash Circle', 'Tide Guild']);
    fireEvent.change(picker, { target: { value: 'gu' } });
    expect(optionNames('Factions')).toEqual(['Tide Guild']);
    fireEvent.keyDown(picker, { key: 'Enter' });

    await waitFor(() => {
      expect(patches(fetchMock)).toEqual([{ links: { factions: [tide.id] } }]);
    });
    // What's linked isn't offered again.
    fireEvent.focus(screen.getByRole('combobox', { name: 'Factions' }));
    expect(optionNames('Factions')).toEqual(['Ash Circle']);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Factions' }), { key: 'Enter' });
    await waitFor(() => {
      expect(patches(fetchMock)[1]).toEqual({ links: { factions: [tide.id, ash.id] } });
    });
  });

  it('never offer the record itself', async () => {
    const { coast, tide } = world();
    renderAt(recordUrl(coast, tide));

    const picker = await screen.findByRole('combobox', { name: 'Allies and enemies' });
    fireEvent.focus(picker);
    expect(optionNames('Allies and enemies')).toEqual(['Ash Circle']);
  });
});

describe('Other links', () => {
  it('add any record, label the relationship, and remove it', async () => {
    const { coast, vex, key, fetchMock } = world();
    renderAt(recordUrl(coast, vex));

    const picker = await screen.findByRole('combobox', { name: 'Add a link' });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'brass' } });
    fireEvent.keyDown(picker, { key: 'Enter' });
    await waitFor(() => {
      expect(patches(fetchMock)).toEqual([{ otherLinks: [{ recordId: key.id, label: null }] }]);
    });

    const relationship = screen.getByRole('textbox', { name: 'Relationship to Brass Key' });
    fireEvent.change(relationship, { target: { value: 'carries' } });
    fireEvent.blur(relationship);
    await waitFor(() => {
      expect(patches(fetchMock)[1]).toEqual({
        otherLinks: [{ recordId: key.id, label: 'carries' }],
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove the link to Brass Key' }));
    await waitFor(() => {
      expect(patches(fetchMock)[2]).toEqual({ otherLinks: [] });
    });
  });
});

describe('Opening a linked record', () => {
  it('offers Open and Open in new tab; Open shows the backlinks there', async () => {
    const { coast, vex, market } = world();
    renderAt(recordUrl(coast, vex));

    fireEvent.focus(await screen.findByRole('combobox', { name: 'Home spot' }));
    pick('Home spot', /Fish Market/);
    const chip = await screen.findByRole('button', { name: 'Fish Market' });

    openMenu(chip);
    const newTab = await screen.findByRole('menuitem', { name: 'Open in new tab' });
    expect(newTab.getAttribute('href')).toBe(recordUrl(coast, market));
    expect(newTab.getAttribute('target')).toBe('_blank');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    await waitFor(() => {
      expect(currentUrl()).toBe(recordUrl(coast, market));
    });
    const linkedFrom = await screen.findByRole('list', { name: 'Linked from' });
    expect(linkedFrom.textContent).toBe('Captain Vex · Home spot');
  });

  it('opens nothing when the menu is dismissed', async () => {
    const { coast, vex, market } = world();
    renderAt(recordUrl(coast, vex));

    fireEvent.focus(await screen.findByRole('combobox', { name: 'Home spot' }));
    pick('Home spot', /Fish Market/);
    openMenu(await screen.findByRole('button', { name: 'Fish Market' }));
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    expect(currentUrl()).toBe(recordUrl(coast, vex));
    expect(currentUrl()).not.toBe(recordUrl(coast, market));
  });

  it('stays on the record when its pending edits fail to save', async () => {
    const { coast, vex, fetchMock } = world();
    renderAt(recordUrl(coast, vex));

    fireEvent.focus(await screen.findByRole('combobox', { name: 'Home spot' }));
    pick('Home spot', /Fish Market/);
    const chip = await screen.findByRole('button', { name: 'Fish Market' });
    await screen.findByText('Saved');

    failRequests(fetchMock, 'PATCH', 500, 'Database is down');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Captain Vex II' },
    });
    openMenu(chip);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open' }));

    expect(await screen.findByText(/Couldn't save: Database is down/)).toBeDefined();
    expect(currentUrl()).toBe(recordUrl(coast, vex));
  });
});

describe('Backlinks', () => {
  it('list links, other links and mentions, grouped by source', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const vex = record({ type: 'npc', name: 'Captain Vex' });
    const guild = record({
      type: 'faction',
      name: 'Tide Guild',
      links: {
        leaders: [{ id: vex.id, type: 'npc', name: vex.name }],
        members: [{ id: vex.id, type: 'npc', name: vex.name }],
        alliesAndEnemies: [],
      },
      otherLinks: [{ record: { id: vex.id, type: 'npc', name: vex.name }, label: 'owes' }],
    });
    const notes = record({ type: 'session_notes', name: 'Session 1', gmNotes: mentioning(vex) });
    mockApi(MIRA, [coast], { campaignData: { [coast.id]: { records: [vex, guild, notes] } } });
    renderAt(recordUrl(coast, vex));

    const linkedFrom = await screen.findByRole('list', { name: 'Linked from' });
    expect(linkedFrom.textContent).toBe('Tide Guild · Leaders, Members, owes');
    const mentionedIn = screen.getByRole('list', { name: 'Mentioned in' });
    expect(within(mentionedIn).getByRole('link', { name: 'Session 1' })).toHaveProperty(
      'href',
      expect.stringContaining(recordUrl(coast, notes)),
    );
  });

  it('say when nothing links here', async () => {
    const { coast, ash } = world();
    renderAt(recordUrl(coast, ash));
    expect(await screen.findByText('Nothing links here yet.')).toBeDefined();
  });
});

describe('Mentions in the editor', () => {
  it('show a chip that opens the record, or plain text once it is deleted', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const vex = record({ type: 'npc', name: 'Captain Vex' });
    const gone = { id: '4c1f0b3e-8d2a-4e6f-9b7c-1a3d5e7f9b2c', name: 'Old Pell' };
    const notes = record({
      type: 'session_notes',
      name: 'Session 1',
      gmNotes: mentioning(vex),
      publicDescription: mentioning(gone),
    });
    mockApi(MIRA, [coast], { campaignData: { [coast.id]: { records: [vex, notes] } } });
    renderAt(recordUrl(coast, notes));

    const chip = await screen.findByRole('button', { name: '@Captain Vex' });
    openMenu(chip);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open' }));
    await waitFor(() => {
      expect(currentUrl()).toBe(recordUrl(coast, vex));
    });

    renderAt(recordUrl(coast, notes));
    const stale = await screen.findByTitle('This record was deleted');
    expect(stale.textContent).toBe('@Old Pell');
    expect(within(stale).queryByRole('button')).toBeNull();
  });
});
