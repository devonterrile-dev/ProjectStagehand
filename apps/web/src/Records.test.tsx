import type { Campaign, CampaignRecord } from '@stagehand/shared';
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
  uuid,
} from '@/test/app-harness';

type FetchMock = ReturnType<typeof mockApi>;

/** Opens a Radix dropdown menu from the keyboard (jsdom has no real pointer events). */
function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
}

function calledWith(fetchMock: FetchMock, url: string, method: string) {
  return fetchMock.mock.calls.some(
    ([input, init]) => input === url && (init?.method ?? 'GET') === method,
  );
}

/** The parsed JSON bodies of every request with `method`, in order. */
function bodiesOf(fetchMock: FetchMock, method: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));
}

/** Clicks the confirm button inside the open "Are you sure?" dialog. */
async function confirm(label: string) {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
}

/** A fresh campaign with an Area, a Spot in it and an NPC. */
function world(overrides: Partial<Campaign> = {}) {
  const coast = campaign({ name: 'Shattered Coast', ...overrides });
  const harbor = record({ type: 'area', name: 'Harbor District' });
  const market = record({ type: 'spot', name: 'Fish Market', parentId: harbor.id });
  const vex = record({
    type: 'npc',
    name: 'Captain Vex',
    fields: { appearance: 'Tall, salt-stained coat', status: 'alive' },
  });
  const records = [vex, harbor, market];
  const fetchMock = mockApi(MIRA, [coast], { campaignData: { [coast.id]: { records } } });
  return { coast, harbor, market, vex, fetchMock };
}

const listUrl = (c: Campaign) => `/campaigns/${c.id}/records`;
const recordUrl = (c: Campaign, r: CampaignRecord) => `/campaigns/${c.id}/records/${r.id}`;

describe('Records on the campaign page', () => {
  it('links the GM to the records', async () => {
    const { coast } = world();
    renderAt(`/campaigns/${coast.id}`);

    const link = await screen.findByRole('link', { name: 'Open records' });
    expect(link).toHaveProperty('href', expect.stringContaining(listUrl(coast)));
  });

  it('tells players the workshop is the GM’s', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(`/campaigns/${coast.id}`);

    expect(await screen.findByText(/Records are the GM/)).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Open records' })).toBeNull();
  });
});

describe('Records list', () => {
  it('counts every type and filters by one through the URL', async () => {
    const { coast } = world();
    renderAt(listUrl(coast));

    expect(await screen.findByRole('button', { name: 'All (3)' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Spot (1)' })).toBeDefined();
    expect(within(screen.getByRole('list', { name: 'Records' })).getAllByRole('link')).toHaveLength(
      3,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Spot (1)' }));
    expect(currentUrl()).toBe(`${listUrl(coast)}?type=spot`);
    const list = screen.getByRole('list', { name: 'Records' });
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(within(list).getByText('in Harbor District')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'All (3)' }));
    expect(currentUrl()).toBe(listUrl(coast));
  });

  it('treats an unknown type filter as all', async () => {
    const { coast } = world();
    renderAt(`${listUrl(coast)}?type=monster`);

    expect(await screen.findByRole('button', { name: 'All (3)', pressed: true })).toBeDefined();
  });

  it('suggests creating one when the type is empty', async () => {
    const { coast } = world();
    renderAt(`${listUrl(coast)}?type=lore`);

    expect(await screen.findByText('No Lores yet. Create one with New record.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'New record' })).toBeDefined();
  });

  it('shows players the note and never asks for records', async () => {
    const { coast, fetchMock } = world({ role: 'player' });
    renderAt(listUrl(coast));

    expect(await screen.findByText(/Records are the GM/)).toBeDefined();
    expect(calledWith(fetchMock, `/api${listUrl(coast)}`, 'GET')).toBe(false);
  });
});

describe('Creating a record', () => {
  it('creates an NPC from the NPC filter and opens it', async () => {
    const { coast, fetchMock } = world();
    renderAt(`${listUrl(coast)}?type=npc`);

    fireEvent.click(await screen.findByRole('button', { name: 'New record' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Type')).toHaveProperty('value', 'npc');
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: '  Sister Ode  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create record' }));

    await waitFor(() => {
      expect(currentUrl()).toMatch(new RegExp(`^${listUrl(coast)}/[0-9a-f-]{36}$`));
    });
    expect(bodiesOf(fetchMock, 'POST')).toEqual([{ type: 'npc', name: 'Sister Ode' }]);
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Sister Ode',
    );
  });

  it('validates the name before sending', async () => {
    const { coast, fetchMock } = world();
    renderAt(listUrl(coast));

    fireEvent.click(await screen.findByRole('button', { name: 'New record' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create record' }));

    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      'Record name cannot be empty',
    );
    expect(bodiesOf(fetchMock, 'POST')).toEqual([]);
  });

  it('needs an Area for a Spot, and sends it along', async () => {
    const { coast, harbor, fetchMock } = world();
    renderAt(`${listUrl(coast)}?type=spot`);

    fireEvent.click(await screen.findByRole('button', { name: 'New record' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Docks' } });
    fireEvent.change(within(dialog).getByLabelText('Area'), { target: { value: harbor.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create record' }));

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'POST')).toEqual([
        { type: 'spot', name: 'Docks', parentId: harbor.id },
      ]);
    });
  });

  it('asks for an Area first when there is none', async () => {
    const coast = campaign({ name: 'Empty Coast' });
    mockApi(MIRA, [coast]);
    renderAt(`${listUrl(coast)}?type=spot`);

    fireEvent.click(await screen.findByRole('button', { name: 'New record' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Create an Area first/)).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'Create record' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});

describe('Editing a record', () => {
  it('shows every field of the type in order, link fields included', async () => {
    const { coast, vex } = world();
    renderAt(recordUrl(coast, vex));

    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Captain Vex',
    );
    const labels = screen
      .getAllByText(
        /^(Appearance|Personality|Voice and mannerisms|Wants and motivations|What they know|Secrets|Role in the story|Status|Home spot|Factions)$/,
      )
      .map((node) => node.textContent);
    expect(labels).toEqual([
      'Appearance',
      'Personality',
      'Voice and mannerisms',
      'Wants and motivations',
      'What they know',
      'Secrets',
      'Role in the story',
      'Status',
      'Home spot',
      'Factions',
    ]);
    expect(screen.getByLabelText('Appearance')).toHaveProperty('value', 'Tall, salt-stained coat');
    expect(screen.getByLabelText('Status')).toHaveProperty('value', 'alive');
  });

  it('saves the name when the field loses focus, and nothing when unchanged', async () => {
    const { coast, vex, fetchMock } = world();
    renderAt(recordUrl(coast, vex));

    const name = await screen.findByRole('textbox', { name: 'Name' });
    fireEvent.blur(name);
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([]);

    fireEvent.change(name, { target: { value: 'Captain Vex II' } });
    expect(screen.getByRole('status')).toHaveProperty('textContent', 'Saving…');
    fireEvent.blur(name);

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ name: 'Captain Vex II' }]);
    });
    expect(await screen.findByText('Saved')).toBeDefined();
  });

  it('saves a choice at once and clears a text field with null', async () => {
    const { coast, vex, fetchMock } = world();
    renderAt(recordUrl(coast, vex));

    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'dead' } });
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ fields: { status: 'dead' } }]);
    });

    const appearance = screen.getByLabelText('Appearance');
    fireEvent.change(appearance, { target: { value: '' } });
    fireEvent.blur(appearance);
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([
        { fields: { status: 'dead' } },
        { fields: { appearance: null } },
      ]);
    });
  });

  it('moves a Spot to another Area', async () => {
    const { coast, market, fetchMock } = world();
    const uptown = record({ type: 'area', name: 'Uptown' });
    // A second Area the fake API knows about.
    fetchMock.mockRestore();
    const world2 = mockApi(MIRA, [coast], {
      campaignData: { [coast.id]: { records: [market, uptown] } },
    });
    renderAt(recordUrl(coast, market));

    fireEvent.change(await screen.findByLabelText('Area'), { target: { value: uptown.id } });
    await waitFor(() => {
      expect(bodiesOf(world2, 'PATCH')).toEqual([{ parentId: uptown.id }]);
    });
  });

  it('adds and removes tags', async () => {
    const { coast, vex, fetchMock } = world();
    renderAt(recordUrl(coast, vex));

    const tags = await screen.findByLabelText('Tags');
    fireEvent.change(tags, { target: { value: 'guild' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ tags: ['guild'] }]);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove guild' }));
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ tags: ['guild'] }, { tags: [] }]);
    });
  });

  it('sends what is pending when the GM leaves the page', async () => {
    const { coast, vex, fetchMock } = world();
    renderAt(recordUrl(coast, vex));

    const name = await screen.findByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Captain Vex III' } });
    fireEvent.click(screen.getByRole('link', { name: '← Records' }));

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ name: 'Captain Vex III' }]);
    });
    expect(await screen.findByRole('button', { name: 'All (3)' })).toBeDefined();
  });

  it('says when a save fails and retries it', async () => {
    const { coast, vex, fetchMock } = world();
    renderAt(recordUrl(coast, vex));

    const name = await screen.findByRole('textbox', { name: 'Name' });
    const restore = failRequests(fetchMock, 'PATCH', 500, 'Database is down');
    fireEvent.change(name, { target: { value: 'Captain Vex II' } });
    fireEvent.blur(name);

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining("Couldn't save: Database is down"),
    );

    restore();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Saved')).toBeDefined();
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([
      { name: 'Captain Vex II' },
      { name: 'Captain Vex II' },
    ]);
  });

  it('deletes after confirmation and returns to the list', async () => {
    const { coast, vex, fetchMock } = world();
    renderAt(recordUrl(coast, vex));

    await screen.findByRole('textbox', { name: 'Name' });
    openMenu('Record settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    await confirm('Delete');

    await waitFor(() => {
      expect(currentUrl()).toBe(`${listUrl(coast)}?type=npc`);
    });
    expect(calledWith(fetchMock, `/api${recordUrl(coast, vex)}`, 'DELETE')).toBe(true);
    expect(await screen.findByRole('button', { name: 'All (2)' })).toBeDefined();
  });

  it('refuses to delete an Area that still has Spots', async () => {
    const { coast, harbor } = world();
    renderAt(recordUrl(coast, harbor));

    await screen.findByRole('textbox', { name: 'Name' });
    openMenu('Record settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    await confirm('Delete');

    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      'This area still has spots. Move or delete them first.',
    );
    expect(currentUrl()).toBe(recordUrl(coast, harbor));
  });

  it('is read-only while the campaign is archived', async () => {
    const { coast, vex } = world({ archivedAt: '2026-11-01T10:00:00.000Z' });
    renderAt(recordUrl(coast, vex));

    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Status')).toHaveProperty('disabled', true);
    expect(screen.getByRole('textbox', { name: 'GM notes' }).getAttribute('contenteditable')).toBe(
      'false',
    );
    expect(screen.queryByRole('button', { name: 'Record settings' })).toBeNull();
  });

  it('hides New record while the campaign is archived', async () => {
    const { coast } = world({ archivedAt: '2026-11-01T10:00:00.000Z' });
    renderAt(listUrl(coast));

    expect(await screen.findByRole('button', { name: 'All (3)' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'New record' })).toBeNull();
  });

  it('says when a record does not exist', async () => {
    const { coast } = world();
    renderAt(`${listUrl(coast)}/${uuid()}`);

    expect(await screen.findByRole('heading', { name: 'Record not found' })).toBeDefined();
  });

  it('shows players the note instead of a record', async () => {
    const { coast, vex, fetchMock } = world({ role: 'player' });
    renderAt(recordUrl(coast, vex));

    expect(await screen.findByText(/Records are the GM/)).toBeDefined();
    expect(calledWith(fetchMock, `/api${recordUrl(coast, vex)}`, 'GET')).toBe(false);
  });
});

describe('Props (F1.10)', () => {
  /** The world plus a Prop at the Fish Market. */
  function withProp() {
    const coast = campaign({ name: 'Prop Coast' });
    const harbor = record({ type: 'area', name: 'Harbor District' });
    const market = record({ type: 'spot', name: 'Fish Market', parentId: harbor.id });
    const well = record({
      type: 'prop',
      name: 'Old Well',
      links: { spot: [{ id: market.id, name: market.name, type: 'spot' }] },
    });
    const fetchMock = mockApi(MIRA, [coast], {
      campaignData: { [coast.id]: { records: [harbor, market, well] } },
    });
    return { coast, market, well, fetchMock };
  }

  it('shows a Prop its fields and its one Spot', async () => {
    const { coast, well } = withProp();
    renderAt(recordUrl(coast, well));

    await screen.findByRole('textbox', { name: 'Name' });
    const labels = screen
      .getAllByText(/^(Appearance|Hidden details|Spot)$/)
      .map((node) => node.textContent);
    expect(labels).toEqual(['Appearance', 'Hidden details', 'Spot']);
    expect(
      within(screen.getByRole('list', { name: 'Spot' })).getByText('Fish Market'),
    ).toBeDefined();
  });

  it("lists a Spot's Props from their own links, once, not again under backlinks", async () => {
    const { coast, market } = withProp();
    renderAt(recordUrl(coast, market));

    const props = await screen.findByRole('list', { name: 'Props here' });
    expect(within(props).getByText('Old Well')).toBeDefined();
    const backlinks = screen.getByRole('generic', { name: 'Backlinks' });
    await waitFor(() => {
      expect(within(backlinks).getByText('Nothing links here yet.')).toBeDefined();
    });
  });

  it('creates a Prop already placed at the Spot, then opens it', async () => {
    const { coast, market, fetchMock } = withProp();
    renderAt(recordUrl(coast, market));

    fireEvent.click(await screen.findByRole('button', { name: 'New prop here' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('It goes at Fish Market. Everything else is filled in on its page.'),
    ).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Notice board' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create record' }));

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'POST')).toEqual([
        { type: 'prop', name: 'Notice board', links: { spot: [market.id] } },
      ]);
    });
    // The new Prop's own page opens.
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'Notice board');
    });
    expect(
      within(screen.getByRole('list', { name: 'Spot' })).getByText('Fish Market'),
    ).toBeDefined();
  });

  it('has no "New prop here" while the campaign is archived', async () => {
    const coast = campaign({ name: 'Old Coast', archivedAt: '2026-11-01T00:00:00.000Z' });
    const harbor = record({ type: 'area', name: 'Harbor' });
    const market = record({ type: 'spot', name: 'Market', parentId: harbor.id });
    mockApi(MIRA, [coast], { campaignData: { [coast.id]: { records: [harbor, market] } } });
    renderAt(recordUrl(coast, market));

    expect(await screen.findByText(/None yet/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'New prop here' })).toBeNull();
  });
});

describe('Search and filters', () => {
  const doc = (text: string) => ({
    type: 'doc' as const,
    content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
  });

  /** The Records world, with tags, GM notes and a second Area with its own Spot. */
  function searchWorld() {
    const coast = campaign({ name: 'Shattered Coast' });
    const harbor = record({ type: 'area', name: 'Harbor District' });
    const oldTown = record({ type: 'area', name: 'Old Town' });
    const market = record({
      type: 'spot',
      name: 'Fish Market',
      parentId: harbor.id,
      tags: ['harbour'],
    });
    const tower = record({ type: 'spot', name: 'Bell Tower', parentId: oldTown.id });
    const vex = record({
      type: 'npc',
      name: 'Captain Vex',
      tags: ['harbour', 'act 1'],
      gmNotes: doc('Owes the Tide Guild money'),
    });
    const records = [vex, harbor, oldTown, market, tower];
    const fetchMock = mockApi(MIRA, [coast], { campaignData: { [coast.id]: { records } } });
    return { coast, harbor, market, vex, fetchMock };
  }

  const shownNames = () =>
    within(screen.getByRole('list', { name: 'Records' }))
      .getAllByRole('link')
      .map((link) => link.querySelector('.font-medium')?.textContent);

  it('searches as the GM types, with an excerpt of the matching text', async () => {
    const { coast } = searchWorld();
    renderAt(listUrl(coast));

    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search records' }), {
      target: { value: 'guild' },
    });

    await waitFor(() => {
      expect(currentUrl()).toBe(`${listUrl(coast)}?q=guild`);
    });
    await waitFor(() => {
      expect(shownNames()).toEqual(['Captain Vex']);
    });
    const list = screen.getByRole('list', { name: 'Records' });
    expect(within(list).getByText(/GM notes:/)).toBeDefined();
    expect(within(list).getByText('Guild').tagName).toBe('STRONG');
    expect(screen.getByRole('button', { name: 'All (1)' })).toBeDefined();
  });

  it('loads the filters from the URL', async () => {
    const { coast, fetchMock } = searchWorld();
    renderAt(`${listUrl(coast)}?q=fish`);

    expect(await screen.findByRole('searchbox', { name: 'Search records' })).toHaveProperty(
      'value',
      'fish',
    );
    await waitFor(() => {
      expect(shownNames()).toEqual(['Fish Market']);
    });
    expect(calledWith(fetchMock, `/api${listUrl(coast)}?q=fish`, 'GET')).toBe(true);
  });

  it('picks tags from a search box: a record needs every tag picked', async () => {
    const { coast } = searchWorld();
    renderAt(listUrl(coast));

    const box = await screen.findByRole('combobox', { name: 'Filter by tag' });
    // Tags are suggested, not all listed up front.
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByRole('button', { name: 'harbour' })).toBeNull();

    fireEvent.change(box, { target: { value: 'harb' } });
    const options = within(screen.getByRole('listbox', { name: 'Tags' })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['harbour']);
    if (options[0] === undefined) throw new Error('no harbour option');
    fireEvent.mouseDown(options[0]);
    await waitFor(() => {
      expect(shownNames()).toEqual(['Captain Vex', 'Fish Market']);
    });
    expect(currentUrl()).toBe(`${listUrl(coast)}?tag=harbour`);
    expect(box).toHaveProperty('value', '');

    // A picked tag is no longer suggested.
    fireEvent.change(box, { target: { value: 'a' } });
    expect(
      within(screen.getByRole('listbox', { name: 'Tags' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['act 1']);

    fireEvent.change(box, { target: { value: 'act' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => {
      expect(shownNames()).toEqual(['Captain Vex']);
    });
    expect(screen.getByRole('button', { name: 'Remove act 1' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Remove harbour' }));
    await waitFor(() => {
      expect(currentUrl()).toBe(`${listUrl(coast)}?tag=act+1`);
    });
    expect(screen.queryByRole('button', { name: 'Remove harbour' })).toBeNull();
  });

  it('says when no tag matches the search', async () => {
    const { coast } = searchWorld();
    renderAt(listUrl(coast));

    fireEvent.change(await screen.findByRole('combobox', { name: 'Filter by tag' }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No matching tags')).toBeDefined();
  });

  it('offers the Area filter only for Spots, and drops it with another type', async () => {
    const { coast, harbor } = searchWorld();
    renderAt(listUrl(coast));

    await screen.findByRole('button', { name: 'All (5)' });
    expect(screen.queryByRole('combobox', { name: 'Area' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Spot (2)' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Area' }), {
      target: { value: harbor.id },
    });
    expect(currentUrl()).toBe(`${listUrl(coast)}?type=spot&area=${harbor.id}`);
    await waitFor(() => {
      expect(shownNames()).toEqual(['Fish Market']);
    });

    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(currentUrl()).toBe(listUrl(coast));
    await waitFor(() => {
      expect(shownNames()).toHaveLength(5);
    });
  });

  it('says when nothing matches, and clears every filter but the type', async () => {
    const { coast } = searchWorld();
    renderAt(`${listUrl(coast)}?type=npc&q=bell&tag=harbour`);

    expect(await screen.findByText('No records match.')).toBeDefined();
    // One under the filters and one in the empty state; either clears.
    const [clear] = screen.getAllByRole('button', { name: 'Clear filters' });
    if (clear === undefined) throw new Error('no Clear filters button');
    fireEvent.click(clear);

    expect(currentUrl()).toBe(`${listUrl(coast)}?type=npc`);
    expect(screen.getByRole('searchbox', { name: 'Search records' })).toHaveProperty('value', '');
    await waitFor(() => {
      expect(shownNames()).toEqual(['Captain Vex']);
    });
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });
});
