import type { Campaign, LevelUpEntry } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  campaign,
  characterSheet,
  currentUrl,
  member,
  MIRA,
  mockApi,
  renderAt,
} from '@/test/app-harness';

type FetchMock = ReturnType<typeof mockApi>;
const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** Every body sent with `method` to a path ending in `suffix`, in order. */
function sentTo(fetchMock: FetchMock, method: string, suffix: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => init?.method === method && urlOf(input).endsWith(suffix))
    .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));
}

const GRACE = '00000000-0000-4000-a920-000000000001';
const CODEX = '00000000-0000-4000-a920-000000000002';
const BLADE = '00000000-0000-4000-a920-000000000003';
const BARD = '00000000-0000-4000-a920-000000000011';
const TROUBADOUR = '00000000-0000-4000-a920-000000000012';
const HOLD = '00000000-0000-4000-a920-000000000051';
const TOME = '00000000-0000-4000-a920-000000000052';
const ANTHEM = '00000000-0000-4000-a920-000000000053';
const WHIRL = '00000000-0000-4000-a920-000000000054';
const TRAITS = { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 };

beforeEach(() => {
  window.localStorage.clear();
});

/** Vex, a level-`level` Bard holding Hold; Mira's when `role` is player, Jun's otherwise. */
function world(
  role: Campaign['role'],
  {
    level = 1,
    granted = true,
    history = [],
    linked = true,
  }: { level?: number; granted?: boolean; history?: LevelUpEntry[]; linked?: boolean } = {},
) {
  const coast = campaign({ name: 'Shattered Coast', role });
  const jun = member('Jun');
  const vex = characterSheet({
    name: 'Vex',
    level,
    proficiency: 1,
    traits: TRAITS,
    hpMax: 6,
    hpCurrent: 6,
    evasion: 10,
    assignedToUserId: role === 'player' ? MIRA.id : jun.userId,
    links: {
      classId: linked ? BARD : null,
      subclassId: linked ? TROUBADOUR : null,
      subclassCards: 1,
      speciesIds: [null, null],
      primaryWeaponId: null,
      secondaryWeaponId: null,
      armorId: null,
      spareWeaponIds: [],
    },
    levelUp: { granted, history },
  });
  const fetchMock = mockApi(MIRA, [coast], {
    campaignData: { [coast.id]: { members: role === 'player' ? [] : [jun], characters: [vex] } },
    domains: {
      [coast.id]: [
        { id: GRACE, name: 'Grace' },
        { id: CODEX, name: 'Codex' },
        { id: BLADE, name: 'Blade' },
      ],
    },
    domainCards: {
      [coast.id]: [
        { id: HOLD, domainId: GRACE, name: 'Hold', level: 1 },
        { id: TOME, domainId: CODEX, name: 'Tome', level: 2 },
        { id: ANTHEM, domainId: GRACE, name: 'Anthem', level: 3 },
        { id: WHIRL, domainId: BLADE, name: 'Whirlwind', level: 1 },
      ],
    },
    classes: { [coast.id]: [{ id: BARD, name: 'Bard', domainIds: [GRACE, CODEX] }] },
    subclasses: { [coast.id]: [{ id: TROUBADOUR, classId: BARD, name: 'Troubadour' }] },
    heldCards: { [vex.id]: [{ cardId: HOLD, place: 'loadout' as const }] },
  });
  const sheetUrl = `/campaigns/${coast.id}/characters/${vex.id}`;
  return { coast, vex, fetchMock, sheetUrl, levelUpUrl: `${sheetUrl}/level-up` };
}

const next = () => screen.getByRole('button', { name: 'Next' });

describe('The GM granting levels (F4.9)', () => {
  it('grants the next level, shows who is levelling up, and withdraws it', async () => {
    const { vex, fetchMock, sheetUrl } = world('gm', { granted: false });
    renderAt(sheetUrl);
    fireEvent.click(await screen.findByRole('button', { name: 'Grant a level (to 2)' }));
    expect(await screen.findByText(/Level 2 granted: waiting for Jun to level up/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Run the level-up for them' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByRole('button', { name: 'Grant a level (to 2)' })).toBeDefined();
    expect(sentTo(fetchMock, 'POST', `/characters/${vex.id}/grant-level`)).toEqual([
      { granted: true },
      { granted: false },
    ]);
  });

  it('asks for a linked class before a level can be granted', async () => {
    const { sheetUrl } = world('gm', { granted: false, linked: false });
    renderAt(sheetUrl);
    expect(await screen.findByText(/Link a class .* to level up with the guide/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Grant a level/ })).toBeNull();
  });

  it('undoes the latest level-up from the settings menu', async () => {
    const { vex, fetchMock, sheetUrl } = world('gm', {
      level: 2,
      granted: false,
      history: [
        {
          level: 2,
          picks: [
            { tier: 2, option: 'hp' },
            { tier: 2, option: 'evasion' },
          ],
        },
      ],
    });
    renderAt(sheetUrl);
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Character settings' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Undo level-up to 2…' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/The cards it added are removed/)).toBeDefined();
    fireEvent.click(dialog.getByRole('button', { name: 'Undo level-up' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/characters/${vex.id}/level-ups/undo`)).toHaveLength(1);
    });
  });
});

describe('The level-up guide (F4.9)', () => {
  it('shows the player a granted level on the campaign page and the sheet', async () => {
    const { coast, levelUpUrl, sheetUrl } = world('player');
    const page = renderAt(`/campaigns/${coast.id}`);
    expect(await screen.findByRole('link', { name: 'Level up to 2' })).toHaveProperty(
      'href',
      expect.stringContaining(levelUpUrl),
    );
    page.unmount();
    renderAt(sheetUrl);
    expect(await screen.findByText('Your GM has granted level 2.')).toBeDefined();
  });

  it('takes two options and a new card, reviews them, and levels up', async () => {
    const { coast, vex, fetchMock, levelUpUrl } = world('player');
    renderAt(levelUpUrl);

    expect(await screen.findByText(/Level 2 starts tier 2: proficiency \+1/)).toBeDefined();
    const tier2 = within(screen.getByRole('region', { name: 'Tier 2 options' }));
    expect(screen.queryByRole('region', { name: 'Tier 3 options' })).toBeNull();
    fireEvent.click(
      tier2.getByRole('button', {
        name: 'Take +1 to two unmarked traits, and mark them from tier 2',
      }),
    );
    expect(next()).toHaveProperty('disabled', true);
    fireEvent.click(tier2.getByRole('button', { name: 'Take One more HP slot from tier 2' }));
    expect(screen.getByText('Pick two different traits to raise')).toBeDefined();
    fireEvent.change(screen.getByLabelText('First trait'), { target: { value: 'agility' } });
    fireEvent.change(screen.getByLabelText('Second trait'), { target: { value: 'strength' } });
    // Two picks taken: no more can be added.
    expect(tier2.getByRole('button', { name: 'Take +1 Evasion from tier 2' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(next());

    const newCard = within(await screen.findByRole('region', { name: 'New card' }));
    expect(newCard.queryByRole('radio', { name: /Anthem/ })).toBeNull();
    expect(newCard.queryByRole('radio', { name: /Whirlwind/ })).toBeNull();
    expect(newCard.queryByRole('radio', { name: /Hold/ })).toBeNull();
    fireEvent.click(newCard.getByRole('radio', { name: 'Take Tome (level 2)' }));
    fireEvent.click(next());

    await screen.findByRole('heading', { name: 'Review', level: 2 });
    const value = (label: string) => screen.getByText(label).nextSibling?.textContent;
    expect(value('Level')).toBe('1 → 2');
    expect(value('Proficiency')).toBe('1 → 2');
    expect(value('HP slots')).toBe('6 → 7');
    expect(value('Agility')).toBe('+2 → +3');
    expect(value('Domain cards')).toBe('New: Tome');
    fireEvent.click(screen.getByRole('button', { name: 'Level up to 2' }));

    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/characters/${vex.id}/level-up`)).toEqual([
        {
          picks: [
            { tier: 2, option: 'traits', traits: ['agility', 'strength'] },
            { tier: 2, option: 'hp' },
          ],
          cardId: TOME,
          extraCardId: null,
          swap: null,
        },
      ]);
    });
    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${coast.id}/characters/${vex.id}`);
    });
    expect(await screen.findByText('Level 2 Bard · tier 2')).toBeDefined();
  });

  it('keeps marked traits from being raised again, and flags a half-marked option', async () => {
    const { levelUpUrl } = world('player', {
      level: 6,
      history: [
        {
          level: 6,
          picks: [
            { tier: 3, option: 'traits', traits: ['agility', 'strength'] },
            { tier: 3, option: 'proficiency' },
          ],
        },
      ],
    });
    renderAt(levelUpUrl);
    const tier3 = within(await screen.findByRole('region', { name: 'Tier 3 options' }));
    expect(tier3.getByText('(half marked: this pick completes it)')).toBeDefined();
    expect(
      tier3.getByRole('button', {
        name: 'Take Multiclass (two marks): coming with F4.10 from tier 3',
      }),
    ).toHaveProperty('disabled', true);
    fireEvent.click(
      tier3.getByRole('button', {
        name: 'Take +1 to two unmarked traits, and mark them from tier 3',
      }),
    );
    const first = screen.getByLabelText('First trait');
    expect(within(first).getByRole('option', { name: 'Agility +2 (marked)' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(within(first).getByRole('option', { name: 'Finesse +1' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('takes a two-mark option twice at one level-up for the reward at once', async () => {
    const { vex, fetchMock, levelUpUrl } = world('player', { level: 4 });
    renderAt(levelUpUrl);
    const tier3 = within(await screen.findByRole('region', { name: 'Tier 3 options' }));
    const proficiency = () =>
      tier3.getByRole('button', { name: 'Take +1 Proficiency (two marks) from tier 3' });
    fireEvent.click(proficiency());
    expect(proficiency()).toHaveProperty('disabled', false);
    fireEvent.click(proficiency());
    expect(proficiency()).toHaveProperty('disabled', true);
    fireEvent.click(next());
    fireEvent.click(
      within(await screen.findByRole('region', { name: 'New card' })).getByRole('radio', {
        name: 'Take Tome (level 2)',
      }),
    );
    fireEvent.click(next());
    await screen.findByRole('heading', { name: 'Review', level: 2 });
    // Entering tier 3 adds one, and the completed option another.
    expect(screen.getByText('Proficiency').nextSibling?.textContent).toBe('1 → 3');
    fireEvent.click(screen.getByRole('button', { name: 'Level up to 5' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/characters/${vex.id}/level-up`)).toEqual([
        {
          picks: [
            { tier: 3, option: 'proficiency' },
            { tier: 3, option: 'proficiency' },
          ],
          cardId: TOME,
          extraCardId: null,
          swap: null,
        },
      ]);
    });
  });

  it('swaps a held card for one of the same level or lower', async () => {
    const { vex, fetchMock, levelUpUrl } = world('player', { level: 2, granted: true });
    renderAt(levelUpUrl);
    const tier2 = within(await screen.findByRole('region', { name: 'Tier 2 options' }));
    fireEvent.click(tier2.getByRole('button', { name: 'Take One more Stress slot from tier 2' }));
    fireEvent.click(tier2.getByRole('button', { name: 'Take +1 Evasion from tier 2' }));
    fireEvent.click(next());
    fireEvent.click(
      within(await screen.findByRole('region', { name: 'New card' })).getByRole('radio', {
        name: 'Take Anthem (level 3)',
      }),
    );
    fireEvent.change(screen.getByLabelText('Card to give up'), { target: { value: HOLD } });
    const swap = within(screen.getByRole('region', { name: 'Swap a card' }));
    expect(swap.queryByRole('radio', { name: /Tome/ })).toBeNull();
    expect(swap.getByText(/No cards of your class's domains fit/)).toBeDefined();
    fireEvent.change(screen.getByLabelText('Card to give up'), { target: { value: '' } });
    fireEvent.click(next());
    fireEvent.click(await screen.findByRole('button', { name: 'Level up to 3' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/characters/${vex.id}/level-up`)).toEqual([
        {
          picks: [
            { tier: 2, option: 'stress' },
            { tier: 2, option: 'evasion' },
          ],
          cardId: ANTHEM,
          extraCardId: null,
          swap: null,
        },
      ]);
    });
  });

  it('says so when no level is granted', async () => {
    const { levelUpUrl } = world('player', { granted: false });
    renderAt(levelUpUrl);
    expect(await screen.findByText(/No level is granted right now/)).toBeDefined();
  });
});
