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
const BONE = '00000000-0000-4000-a920-000000000004';
const RANGER = '00000000-0000-4000-a920-000000000021';
const BEASTBOUND = '00000000-0000-4000-a920-000000000022';
const TRACK = '00000000-0000-4000-a920-000000000055';
const POUNCE = '00000000-0000-4000-a920-000000000056';
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
    multiclassed = false,
  }: {
    level?: number;
    granted?: boolean;
    history?: LevelUpEntry[];
    linked?: boolean;
    multiclassed?: boolean;
  } = {},
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
      multiclassClassId: multiclassed ? RANGER : null,
      multiclassDomainId: multiclassed ? BONE : null,
      multiclassSubclassId: multiclassed ? BEASTBOUND : null,
      multiclassSubclassCards: 1,
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
        { id: BONE, name: 'Bone' },
      ],
    },
    domainCards: {
      [coast.id]: [
        { id: HOLD, domainId: GRACE, name: 'Hold', level: 1 },
        { id: TOME, domainId: CODEX, name: 'Tome', level: 2 },
        { id: ANTHEM, domainId: GRACE, name: 'Anthem', level: 3 },
        { id: WHIRL, domainId: BLADE, name: 'Whirlwind', level: 1 },
        { id: TRACK, domainId: BONE, name: 'Track', level: 3 },
        { id: POUNCE, domainId: BONE, name: 'Pounce', level: 4 },
      ],
    },
    classes: {
      [coast.id]: [
        { id: BARD, name: 'Bard', domainIds: [GRACE, CODEX] },
        {
          id: RANGER,
          name: 'Ranger',
          domainIds: [BONE, CODEX],
          classFeatures: [{ name: 'Ranger’s Focus', text: 'Mark a target.' }],
        },
      ],
    },
    subclasses: {
      [coast.id]: [
        { id: TROUBADOUR, classId: BARD, name: 'Troubadour' },
        {
          id: BEASTBOUND,
          classId: RANGER,
          name: 'Beastbound',
          foundation: [{ name: 'Companion', text: '' }],
        },
      ],
    },
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
        name: 'Take Multiclass: take a second class (two marks) from tier 3',
      }),
    ).toHaveProperty('disabled', false);
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

describe('Multiclassing (F4.10)', () => {
  it('takes Multiclass twice, picks the second class, and limits its domain’s cards', async () => {
    const { vex, fetchMock, levelUpUrl } = world('player', { level: 4 });
    renderAt(levelUpUrl);
    const tier3 = within(await screen.findByRole('region', { name: 'Tier 3 options' }));
    const take = () =>
      tier3.getByRole('button', {
        name: 'Take Multiclass: take a second class (two marks) from tier 3',
      });
    fireEvent.click(take());
    fireEvent.click(take());
    const choice = within(await screen.findByRole('region', { name: 'Multiclass' }));
    expect(
      screen.getByText('Pick your second class, one of its domains and a subclass'),
    ).toBeDefined();
    const cls = choice.getByLabelText('Second class');
    expect(within(cls).queryByRole('option', { name: 'Bard' })).toBeNull();
    fireEvent.change(cls, { target: { value: RANGER } });
    const domain = choice.getByLabelText('Its domain');
    await within(domain).findByRole('option', { name: 'Bone' });
    expect(within(domain).getByRole('option', { name: 'Codex (already yours)' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.change(domain, { target: { value: BONE } });
    fireEvent.change(choice.getByLabelText('Its subclass'), { target: { value: BEASTBOUND } });
    fireEvent.click(next());

    const newCard = within(await screen.findByRole('region', { name: 'New card' }));
    expect(newCard.getByText(/multiclass domain go up to level 3/)).toBeDefined();
    expect(newCard.queryByRole('radio', { name: /Pounce/ })).toBeNull();
    fireEvent.click(newCard.getByRole('radio', { name: 'Take Track (level 3)' }));
    fireEvent.click(next());

    await screen.findByRole('heading', { name: 'Review', level: 2 });
    expect(screen.getByText('Second class').nextSibling?.textContent).toBe(
      'Ranger, Bone, Beastbound',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Level up to 5' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/characters/${vex.id}/level-up`)).toEqual([
        {
          picks: [
            { tier: 3, option: 'multiclass' },
            { tier: 3, option: 'multiclass' },
          ],
          cardId: TRACK,
          extraCardId: null,
          swap: null,
          multiclass: { classId: RANGER, domainId: BONE, subclassId: BEASTBOUND },
        },
      ]);
    });
  });

  it('crosses out Multiclass once taken, and lets the player upgrade either subclass', async () => {
    const { vex, fetchMock, levelUpUrl } = world('player', { level: 7, multiclassed: true });
    renderAt(levelUpUrl);
    const tier4 = within(await screen.findByRole('region', { name: 'Tier 4 options' }));
    expect(tier4.getAllByText('(crossed out by multiclassing)')).toHaveLength(1);
    expect(
      tier4.getByRole('button', {
        name: 'Take Multiclass: take a second class (two marks) from tier 4',
      }),
    ).toHaveProperty('disabled', true);
    fireEvent.click(
      tier4.getByRole('button', {
        name: 'Take Upgrade your subclass card (specialization, then mastery) from tier 4',
      }),
    );
    fireEvent.click(tier4.getByRole('button', { name: 'Take One more HP slot from tier 4' }));
    fireEvent.change(screen.getByLabelText('Upgrade which subclass'), {
      target: { value: 'multiclass' },
    });
    fireEvent.click(next());
    fireEvent.click(
      within(await screen.findByRole('region', { name: 'New card' })).getByRole('radio', {
        name: 'Take Anthem (level 3)',
      }),
    );
    fireEvent.click(next());
    await screen.findByRole('heading', { name: 'Review', level: 2 });
    expect(screen.getByText('Multiclass subclass cards').nextSibling?.textContent).toBe('1 → 2');
    fireEvent.click(screen.getByRole('button', { name: 'Level up to 8' }));
    await waitFor(() => {
      const [body] = sentTo(fetchMock, 'POST', `/characters/${vex.id}/level-up`);
      expect(body).toMatchObject({
        picks: [
          { tier: 4, option: 'subclass', target: 'multiclass' },
          { tier: 4, option: 'hp' },
        ],
      });
    });
  });

  it('shows both classes on the player’s sheet, with the second subclass card', async () => {
    const { sheetUrl } = world('player', { level: 5, granted: false, multiclassed: true });
    renderAt(sheetUrl);
    expect(await screen.findByText('Level 5 Bard / Ranger · tier 3')).toBeDefined();
    expect(screen.getByRole('region', { name: 'Ranger (multiclass)' })).toBeDefined();
    expect(screen.getByText('Ranger’s Focus')).toBeDefined();
    expect(
      screen.getByRole('article', { name: 'Beastbound, a Ranger subclass (multiclass)' }),
    ).toBeDefined();
  });

  it('lets the GM set a second class by hand', async () => {
    const { vex, fetchMock, sheetUrl } = world('gm', { granted: false });
    renderAt(sheetUrl);
    const multiclass = await screen.findByLabelText('Multiclass');
    await within(multiclass).findByRole('option', { name: 'Ranger' });
    expect(within(multiclass).queryByRole('option', { name: 'Bard' })).toBeNull();
    fireEvent.change(multiclass, { target: { value: RANGER } });
    const domain = await screen.findByLabelText('Multiclass domain');
    await within(domain).findByRole('option', { name: 'Bone' });
    expect(within(domain).queryByRole('option', { name: 'Codex' })).toBeNull();
    fireEvent.change(domain, { target: { value: BONE } });
    fireEvent.change(screen.getByLabelText('Multiclass subclass'), {
      target: { value: BEASTBOUND },
    });
    await waitFor(() => {
      expect(sentTo(fetchMock, 'PATCH', `/characters/${vex.id}`)).toEqual([
        { multiclassClassId: RANGER },
        { multiclassDomainId: BONE },
        { multiclassSubclassId: BEASTBOUND },
      ]);
    });
  });
});
