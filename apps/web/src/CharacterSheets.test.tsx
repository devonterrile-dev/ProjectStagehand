import type { Campaign, CharacterSheet } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  campaign,
  characterSheet,
  currentUrl,
  member,
  MIRA,
  mockApi,
  record,
  renderAt,
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

const TRAITS = { agility: 0, strength: 1, finesse: 0, instinct: 0, presence: -1, knowledge: 0 };

/** A GM's campaign: Jun plays Vex (HP 6 of 6, wearing armor); Spare is unassigned. */
function gmWorld(overrides: Partial<Campaign> = {}) {
  const coast = campaign({ name: 'Shattered Coast', ...overrides });
  const jun = member('Jun');
  const vex = characterSheet({
    name: 'Vex',
    assignedToUserId: jun.userId,
    traits: TRAITS,
    evasion: 10,
    hpMax: 6,
    hpCurrent: 6,
    armor: {
      name: 'Oilskin',
      baseMajorThreshold: 6,
      baseSevereThreshold: 13,
      baseScore: 3,
      feature: '',
    },
  });
  const spare = characterSheet({ name: 'Spare' });
  const fetchMock = mockApi(MIRA, [coast], {
    campaignData: { [coast.id]: { members: [jun], characters: [vex, spare] } },
  });
  return { coast, jun, vex, spare, fetchMock };
}

const sheetUrl = (c: Campaign, pc: CharacterSheet) => `/campaigns/${c.id}/characters/${pc.id}`;

describe('The GM’s sheet editor', () => {
  it('shows the groups in governance order and who plays the PC', async () => {
    const { coast, vex } = gmWorld();
    renderAt(sheetUrl(coast, vex));

    expect(await screen.findByRole('textbox', { name: 'Character name' })).toHaveProperty(
      'value',
      'Vex',
    );
    expect(screen.getByText('Played by Jun')).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Identity',
      'Traits',
      'Defense',
      'Health',
      'Hope and proficiency',
      'Experiences',
      'Weapons',
      'Armor',
      'Inventory',
      'Class feature',
      'Combat options',
      'GM notes',
    ]);
    expect(screen.getByLabelText('Strength')).toHaveProperty('value', '1');
  });

  it('saves a changed number on blur, and only that key', async () => {
    const { coast, vex, fetchMock } = gmWorld();
    renderAt(sheetUrl(coast, vex));

    const evasion = await screen.findByLabelText('Evasion');
    fireEvent.change(evasion, { target: { value: '11' } });
    fireEvent.blur(evasion);

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ evasion: 11 }]);
    });
    expect(await screen.findByText('Saved')).toBeDefined();
  });

  it('asks for a whole number when a number is left empty', async () => {
    const { coast, vex, fetchMock } = gmWorld();
    renderAt(sheetUrl(coast, vex));

    const evasion = await screen.findByLabelText('Evasion');
    fireEvent.change(evasion, { target: { value: '' } });
    fireEvent.blur(evasion);

    expect(await screen.findByText('Enter a whole number')).toBeDefined();
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([]);
  });

  it('refuses a max below the current value until the current value comes down', async () => {
    const { coast, vex, fetchMock } = gmWorld();
    renderAt(sheetUrl(coast, vex));

    const hpMax = await screen.findByLabelText('HP max');
    fireEvent.change(hpMax, { target: { value: '4' } });
    fireEvent.blur(hpMax);
    expect(
      await screen.findByText("Can't be below current HP (6); lower that first"),
    ).toBeDefined();
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([]);

    const current = screen.getByLabelText('Current HP');
    fireEvent.change(current, { target: { value: '4' } });
    fireEvent.blur(current);

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ hpCurrent: 4, hpMax: 4 }]);
    });
    expect(screen.queryByText(/Can't be below current HP/)).toBeNull();
  });

  it('refuses Hope above the ruleset max', async () => {
    const { coast, vex, fetchMock } = gmWorld();
    renderAt(sheetUrl(coast, vex));

    expect(await screen.findByText('of 6')).toBeDefined();
    const hope = screen.getByLabelText('Hope');
    fireEvent.change(hope, { target: { value: '7' } });
    fireEvent.blur(hope);

    expect(await screen.findByText("Hope can't be above 6")).toBeDefined();
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([]);
  });

  it('sends every trait when one changes, at once', async () => {
    const { coast, vex, fetchMock } = gmWorld();
    renderAt(sheetUrl(coast, vex));

    const agility = await screen.findByLabelText('Agility');
    expect(
      within(agility)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['−1', '0', '+1', '+2']);
    fireEvent.change(agility, { target: { value: '2' } });

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ traits: { ...TRAITS, agility: 2 } }]);
    });
  });

  it('saves a new experience once it has a name, as the whole list', async () => {
    const { coast, vex, fetchMock } = gmWorld();
    renderAt(sheetUrl(coast, vex));

    fireEvent.click(await screen.findByRole('button', { name: 'Add experience' }));
    expect(screen.getByText('Give it a name to save it.')).toBeDefined();

    const name = screen.getByRole('textbox', { name: 'Experience 1 name' });
    fireEvent.change(name, { target: { value: 'Sailor' } });
    fireEvent.change(screen.getByLabelText('Experience 1 bonus'), { target: { value: '2' } });
    fireEvent.blur(name);

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([
        { experiences: [{ name: 'Sailor', bonus: 2 }] },
      ]);
    });
  });

  it('links an inventory row to an Item record, filling a blank name', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const key = record({ type: 'item', name: 'Brass Key' });
    const vex = characterSheet({ name: 'Vex', traits: TRAITS });
    const fetchMock = mockApi(MIRA, [coast], {
      campaignData: { [coast.id]: { characters: [vex], records: [key] } },
    });
    renderAt(sheetUrl(coast, vex));

    fireEvent.click(await screen.findByRole('button', { name: 'Add item' }));
    const picker = await screen.findByRole('combobox', { name: 'Item 1 Item record' });
    fireEvent.focus(picker);
    fireEvent.mouseDown(
      within(screen.getByRole('listbox', { name: 'Item 1 Item record' })).getByRole('option', {
        name: /Brass Key/,
      }),
    );

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([
        { inventory: [{ name: 'Brass Key', detail: '', recordId: key.id }] },
      ]);
    });
    expect(screen.getByRole('textbox', { name: 'Item 1 name' })).toHaveProperty(
      'value',
      'Brass Key',
    );
    expect(screen.getByRole('link', { name: 'Brass Key' })).toHaveProperty(
      'href',
      expect.stringContaining(`/campaigns/${coast.id}/records/${key.id}`),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Unlink Brass Key from Item 1' }));
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')[1]).toEqual({
        inventory: [{ name: 'Brass Key', detail: '' }],
      });
    });
  });

  it('removes the armor with null', async () => {
    const { coast, vex, fetchMock } = gmWorld();
    renderAt(sheetUrl(coast, vex));

    expect(await screen.findByRole('textbox', { name: 'Armor name' })).toHaveProperty(
      'value',
      'Oilskin',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove armor' }));

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ armor: null }]);
    });
    expect(screen.getByRole('button', { name: 'Add armor' })).toBeDefined();
  });

  it('adds a primary weapon and shows the rule for bad damage dice', async () => {
    const { coast, vex, fetchMock } = gmWorld();
    renderAt(sheetUrl(coast, vex));

    fireEvent.click(await screen.findByRole('button', { name: 'Add primary weapon' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Primary weapon name' }), {
      target: { value: 'Harpoon' },
    });
    fireEvent.change(screen.getByLabelText('Primary weapon trait'), {
      target: { value: 'finesse' },
    });
    const dice = screen.getByRole('textbox', { name: 'Primary weapon damage dice' });
    fireEvent.change(dice, { target: { value: '1d7' } });

    expect(await screen.findByText('Use dice like 1d8 or 2d6+3')).toBeDefined();

    fireEvent.change(dice, { target: { value: '1d10+2' } });
    fireEvent.blur(dice);
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH').at(-1)).toEqual({
        weapons: {
          primary: {
            name: 'Harpoon',
            trait: 'finesse',
            range: '',
            damageDice: '1d10+2',
            damageType: '',
            feature: '',
          },
          secondary: null,
          inventory: [],
        },
      });
    });
    expect(screen.queryByText('Use dice like 1d8 or 2d6+3')).toBeNull();
  });

  it('deletes the PC and leaves its player without one', async () => {
    const { coast, vex } = gmWorld();
    renderAt(sheetUrl(coast, vex));

    await screen.findByRole('textbox', { name: 'Character name' });
    openMenu('Character settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Jun stays in the campaign without a PC/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${coast.id}`);
    });
    const roster = await screen.findByRole('list', { name: 'Members' });
    expect(await within(roster).findByText('No PC yet')).toBeDefined();
  });

  it('is read-only while the campaign is archived', async () => {
    const { coast, vex } = gmWorld({ archivedAt: '2026-11-01T10:00:00.000Z' });
    renderAt(sheetUrl(coast, vex));

    expect(await screen.findByText(/archived, so its sheets are read-only/)).toBeDefined();
    expect(screen.getByLabelText('Evasion')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Agility')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Character settings' })).toBeNull();
  });

  it('shows "not found" for an unknown PC', async () => {
    const { coast } = gmWorld();
    renderAt(`/campaigns/${coast.id}/characters/00000000-0000-4000-8000-999999999999`);
    expect(await screen.findByText('Character not found')).toBeDefined();
  });
});

describe('Characters on the campaign page', () => {
  it('lists every PC with its player, assigned or not', async () => {
    const { coast, vex } = gmWorld();
    renderAt(`/campaigns/${coast.id}`);

    const list = await screen.findByRole('list', { name: 'Characters' });
    await within(list).findByText('Played by Jun');
    expect(within(list).getByText('Unassigned')).toBeDefined();
    expect(within(list).getByRole('link', { name: /Vex/ })).toHaveProperty(
      'href',
      expect.stringContaining(sheetUrl(coast, vex)),
    );
  });

  it('creates a PC and opens its sheet', async () => {
    const { coast } = gmWorld();
    renderAt(`/campaigns/${coast.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'New PC' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Character name'), {
      target: { value: 'Nyx' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create PC' }));

    await waitFor(() => {
      expect(currentUrl()).toMatch(new RegExp(`^/campaigns/${coast.id}/characters/.+`));
    });
    expect(await screen.findByText('Not assigned to a player')).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveProperty('value', 'Nyx');
  });
});

describe('A player’s own sheet', () => {
  /** Mira plays Vex in someone else's campaign; Rook belongs to another player. */
  function playerWorld({ withPc = true } = {}) {
    const coast = campaign({ name: 'Shattered Coast', role: 'player' });
    const vex = characterSheet({
      name: 'Vex',
      level: 3,
      className: 'Ranger',
      assignedToUserId: withPc ? MIRA.id : null,
      traits: TRAITS,
      hpMax: 6,
      hpCurrent: 5,
      hope: 2,
      experiences: [{ name: 'Sailor', bonus: 2 }],
    });
    const other = member('Jun');
    const rook = characterSheet({ name: 'Rook', assignedToUserId: other.userId });
    const fetchMock = mockApi(MIRA, [coast], {
      campaignData: { [coast.id]: { members: [other], characters: [vex, rook] } },
    });
    return { coast, vex, rook, fetchMock };
  }

  it('opens from the campaign page and is read-only', async () => {
    const { coast } = playerWorld();
    renderAt(`/campaigns/${coast.id}`);

    expect(await screen.findByRole('heading', { name: 'Your character' })).toBeDefined();
    fireEvent.click(await screen.findByRole('link', { name: 'Open sheet' }));

    expect(await screen.findByRole('heading', { name: 'Vex', level: 1 })).toBeDefined();
    expect(screen.getByText('Level 3 Ranger')).toBeDefined();
    expect(screen.getByText('5 of 6')).toBeDefined();
    expect(screen.getByText('2 of 6')).toBeDefined();
    expect(screen.getByText('Sailor')).toBeDefined();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByText('GM notes')).toBeNull();
    // Empty groups are left out.
    expect(screen.queryByRole('heading', { name: 'Armor' })).toBeNull();
  });

  it('shows an inventory row without its Item record', async () => {
    const coast = campaign({ name: 'Shattered Coast', role: 'player' });
    const key = record({ type: 'item', name: 'Brass Key' });
    const vex = characterSheet({
      name: 'Vex',
      assignedToUserId: MIRA.id,
      traits: TRAITS,
      inventory: [{ name: 'Odd key', detail: 'Hums', recordId: key.id }],
    });
    mockApi(MIRA, [coast], {
      campaignData: { [coast.id]: { characters: [vex], records: [key] } },
    });
    renderAt(sheetUrl(coast, vex));

    expect(await screen.findByText(/Odd key/)).toBeDefined();
    expect(screen.queryByText(/Brass Key/)).toBeNull();
    expect(document.body.innerHTML).not.toContain(key.id);
  });

  it("shows another player's PC as not found", async () => {
    const { coast, rook } = playerWorld();
    renderAt(sheetUrl(coast, rook));
    expect(await screen.findByText('Character not found')).toBeDefined();
  });

  it('says so when the GM has not given them a PC', async () => {
    const { coast } = playerWorld({ withPc: false });
    renderAt(`/campaigns/${coast.id}`);
    expect(await screen.findByText("The GM hasn't given you a PC yet.")).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Open sheet' })).toBeNull();
  });
});
