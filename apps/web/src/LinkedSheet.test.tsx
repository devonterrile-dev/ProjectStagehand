import { noGearBonuses, type Campaign, type CharacterSheet } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { campaign, characterSheet, member, MIRA, mockApi, renderAt } from '@/test/app-harness';

type FetchMock = ReturnType<typeof mockApi>;
const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const GRACE = '00000000-0000-4000-a900-000000000001';
const BLADE = '00000000-0000-4000-a900-000000000002';
const BARD = '00000000-0000-4000-a900-000000000011';
const TROUBADOUR = '00000000-0000-4000-a900-000000000012';
const FAERIE = '00000000-0000-4000-a900-000000000021';
const ORC = '00000000-0000-4000-a900-000000000022';
const RAPIER = '00000000-0000-4000-a900-000000000031';
const CHAINMAIL = '00000000-0000-4000-a900-000000000041';
const INSPIRE = '00000000-0000-4000-a900-000000000051';
const WHIRL = '00000000-0000-4000-a900-000000000052';

/** Every body sent with `method` to a path ending in `suffix`, in order. */
function sentTo(fetchMock: FetchMock, method: string, suffix: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => init?.method === method && urlOf(input).endsWith(suffix))
    .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));
}

/** A campaign with gameplay records to link, and Vex (level 3, Mira's when `role` is player). */
function world(
  role: Campaign['role'],
  vexOverrides: Partial<CharacterSheet> = {},
  extraCards: string[] = [],
) {
  const coast = campaign({ name: 'Shattered Coast', role });
  const jun = member('Jun');
  const vex = characterSheet({
    name: 'Vex',
    level: 3,
    proficiency: 2,
    stressMax: 6,
    assignedToUserId: role === 'player' ? MIRA.id : jun.userId,
    ...vexOverrides,
  });
  const fetchMock = mockApi(MIRA, [coast], {
    campaignData: { [coast.id]: { members: role === 'player' ? [] : [jun], characters: [vex] } },
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
        ...extraCards.map((id, n) => ({ id, domainId: GRACE, name: `Song ${String(n + 1)}` })),
      ],
    },
    classes: {
      [coast.id]: [
        {
          id: BARD,
          name: 'Bard',
          domainIds: [GRACE, null],
          hopeFeature: { name: 'Make a Scene', cost: 3, text: 'Distract a target.' },
          classFeatures: [{ name: 'Rally', text: 'Give Rally Dice.' }],
        },
      ],
    },
    subclasses: {
      [coast.id]: [
        {
          id: TROUBADOUR,
          classId: BARD,
          name: 'Troubadour',
          foundation: [{ name: 'Gifted Performer', text: '' }],
        },
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
        {
          id: ORC,
          name: 'Orc',
          features: [
            { name: 'Sturdy', text: '' },
            { name: 'Tusks', text: '' },
          ],
        },
      ],
    },
    weapons: {
      [coast.id]: [
        {
          id: RAPIER,
          name: 'Rapier',
          trait: 'presence',
          damageDie: 8,
          damageBonus: 1,
          bonuses: { ...noGearBonuses(), evasion: 1 },
        },
      ],
    },
    armor: {
      [coast.id]: [
        {
          id: CHAINMAIL,
          name: 'Chainmail',
          baseMajorThreshold: 7,
          baseSevereThreshold: 15,
          baseScore: 4,
        },
      ],
    },
    heldCards: {
      [vex.id]: [
        { cardId: WHIRL, place: 'vault' as const },
        ...extraCards.map((cardId) => ({ cardId, place: 'loadout' as const })),
      ],
    },
  });
  return { coast, vex, fetchMock };
}

const sheetUrl = (c: Campaign, pc: CharacterSheet) => `/campaigns/${c.id}/characters/${pc.id}`;

describe('Linking a sheet to gameplay records (F4.7)', () => {
  it('links armor and works out the thresholds and score from it', async () => {
    const { coast, vex, fetchMock } = world('gm');
    renderAt(sheetUrl(coast, vex));
    const armor = await screen.findByLabelText('Armor from the records');
    await within(armor).findByRole('option', { name: 'Chainmail (tier 1)' });
    fireEvent.change(armor, { target: { value: CHAINMAIL } });

    await waitFor(() => {
      expect(sentTo(fetchMock, 'PATCH', `/characters/${vex.id}`)).toContainEqual({
        armorId: CHAINMAIL,
      });
    });
    expect(await screen.findByText('10 / 18')).toBeDefined();
    expect(screen.queryByLabelText('Minor threshold')).toBeNull();
    expect(screen.queryByLabelText('Armor score')).toBeNull();
  });

  it('links a class, its subclass and a mixed ancestry, and shows their cards', async () => {
    const { coast, vex, fetchMock } = world('gm');
    renderAt(sheetUrl(coast, vex));
    const cls = await screen.findByLabelText('Class', { selector: 'select' });
    await within(cls).findByRole('option', { name: 'Bard' });
    fireEvent.change(cls, { target: { value: BARD } });
    const sub = await screen.findByLabelText('Subclass');
    await within(sub).findByRole('option', { name: 'Troubadour' });
    fireEvent.change(sub, { target: { value: TROUBADOUR } });
    const first = screen.getByLabelText('Species');
    fireEvent.change(first, { target: { value: FAERIE } });
    fireEvent.change(screen.getByLabelText('Mixed ancestry (optional)'), {
      target: { value: ORC },
    });

    await waitFor(() => {
      expect(sentTo(fetchMock, 'PATCH', `/characters/${vex.id}`)).toEqual([
        { classId: BARD },
        { subclassId: TROUBADOUR },
        { speciesIds: [FAERIE, null] },
        { speciesIds: [FAERIE, ORC] },
      ]);
    });
    const cards = await screen.findByRole('article', { name: 'Bard, the class' });
    expect(within(cards).getByText('Make a Scene (3 Hope)')).toBeDefined();
    expect(screen.getByRole('article', { name: 'Troubadour, the subclass' })).toBeDefined();
    const orc = screen.getByRole('article', { name: 'Orc, half of a mixed ancestry' });
    expect(within(orc).getByText('Tusks')).toBeDefined();
    expect(within(orc).queryByText('Sturdy')).toBeNull();
    expect(
      screen.getByText("Replaced by Bard's Hope feature and class features (in Feature cards)."),
    ).toBeDefined();
  });

  it('lets the GM add a domain card, and warns about one outside the class’s domains', async () => {
    const { coast, vex, fetchMock } = world('gm', {
      links: {
        classId: BARD,
        subclassId: null,
        subclassCards: 1,
        speciesIds: [null, null],
        primaryWeaponId: null,
        secondaryWeaponId: null,
        armorId: null,
        spareWeaponIds: [],
      },
    });
    renderAt(sheetUrl(coast, vex));
    const add = await screen.findByLabelText('Add a domain card');
    await within(add).findByRole('option', { name: 'Inspirational Words (level 1)' });
    fireEvent.change(add, { target: { value: INSPIRE } });
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/characters/${vex.id}/domain-cards`)).toEqual([
        { cardId: INSPIRE },
      ]);
    });
    const loadout = within(await screen.findByRole('region', { name: 'Loadout' }));
    expect(await loadout.findByText('Inspirational Words')).toBeDefined();
    const vault = within(screen.getByRole('region', { name: 'Vault' }));
    expect(vault.getByText("Blade isn't one of Bard's domains.")).toBeDefined();
  });
});

describe('A player’s linked sheet (F4.7)', () => {
  const NO_LINKS = {
    classId: null,
    subclassId: null,
    subclassCards: 1,
    speciesIds: [null, null] as [string | null, string | null],
    primaryWeaponId: null,
    secondaryWeaponId: null,
    armorId: null,
    spareWeaponIds: [],
  };

  it('shows the built values, with no weapon or armor card, and recalls a card for Stress', async () => {
    const { coast, vex, fetchMock } = world('player', {
      links: { ...NO_LINKS, primaryWeaponId: RAPIER, armorId: CHAINMAIL },
      evasion: 10,
    });
    renderAt(sheetUrl(coast, vex));
    expect(await screen.findByText('2d8+1 physical', { exact: false })).toBeDefined();
    expect(screen.getByLabelText('Major threshold: 10')).toBeDefined();
    expect(screen.getByLabelText('Severe threshold: 18')).toBeDefined();
    expect(screen.queryByLabelText(/Minor threshold/)).toBeNull();
    expect(screen.getByLabelText('Evasion: 11')).toBeDefined();
    expect(screen.getByLabelText('Armor: 4')).toBeDefined();
    expect(screen.queryByRole('article', { name: 'Chainmail, tier 1 armor' })).toBeNull();
    expect(screen.queryByRole('article', { name: /Rapier/ })).toBeNull();

    const vault = within(screen.getByRole('region', { name: 'Vault' }));
    expect(vault.getByRole('article', { name: 'Whirlwind, a Blade card' })).toBeDefined();
    fireEvent.click(
      vault.getByRole('button', {
        name: 'Bring Whirlwind to the loadout (2 Stress, free during Rest)',
      }),
    );
    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/domain-cards/${WHIRL}/move`)).toEqual([{ to: 'loadout' }]);
    });
    const loadout = within(await screen.findByRole('region', { name: 'Loadout' }));
    expect(await loadout.findByRole('article', { name: 'Whirlwind, a Blade card' })).toBeDefined();
    expect(loadout.getByText('1 of 5')).toBeDefined();
    expect(await screen.findByLabelText('Stress: 2 of 6')).toBeDefined();
  });

  it('puts the class features on the sheet and the subclass and ancestry cards beside it', async () => {
    const { coast, vex } = world('player', {
      links: { ...NO_LINKS, classId: BARD, subclassId: TROUBADOUR, speciesIds: [FAERIE, ORC] },
    });
    renderAt(sheetUrl(coast, vex));
    const sheetGroups = await screen.findAllByRole('heading', { level: 2 });
    const titles = sheetGroups.map((heading) => heading.textContent);
    expect(titles).toContain('Class features');
    expect(titles).not.toContain('Feature cards');
    expect(titles).not.toContain('Domain cards');
    expect(screen.getByText('Make a Scene (3 Hope)')).toBeDefined();
    expect(screen.queryByRole('article', { name: 'Bard, the class' })).toBeNull();

    const side = within(screen.getByRole('complementary', { name: 'Subclass and ancestry' }));
    expect(side.getByRole('article', { name: 'Troubadour, the subclass' })).toBeDefined();
    const ancestry = within(side.getByRole('article', { name: 'Faerie / Orc, a mixed ancestry' }));
    expect(ancestry.getByText('Luckbender (Faerie)')).toBeDefined();
    expect(ancestry.getByText('Tusks (Orc)')).toBeDefined();
    expect(ancestry.queryByText(/Wings|Sturdy/)).toBeNull();
  });

  it('turns through a pile one card at a time', async () => {
    const songs = ['1', '2', '3'].map((n) => `00000000-0000-4000-a900-00000000006${n}`);
    const { coast, vex } = world('player', {}, songs);
    renderAt(sheetUrl(coast, vex));
    const loadout = within(await screen.findByRole('region', { name: 'Loadout' }));
    expect(loadout.getByRole('article', { name: 'Song 1, a Grace card' })).toBeDefined();
    expect(loadout.getByText('3 of 5')).toBeDefined();
    // A loadout card only goes to the vault to make room for one coming back.
    expect(loadout.queryByRole('button', { name: /in the vault/ })).toBeNull();

    fireEvent.click(loadout.getByRole('button', { name: 'Next card in the loadout' }));
    expect(loadout.getByRole('article', { name: 'Song 2, a Grace card' })).toBeDefined();
    fireEvent.click(loadout.getByRole('article', { name: 'Song 2, a Grace card' }));
    expect(loadout.getByRole('article', { name: 'Song 3, a Grace card' })).toBeDefined();
    fireEvent.click(loadout.getByRole('button', { name: 'Next card in the loadout' }));
    expect(loadout.getByRole('article', { name: 'Song 1, a Grace card' })).toBeDefined();
    expect(loadout.queryByRole('article', { name: 'Song 2, a Grace card' })).toBeNull();
  });

  it('asks which card goes to the vault when the loadout is full', async () => {
    const songs = ['1', '2', '3', '4', '5'].map((n) => `00000000-0000-4000-a900-00000000006${n}`);
    const { coast, vex, fetchMock } = world('player', {}, songs);
    renderAt(sheetUrl(coast, vex));
    const vault = within(await screen.findByRole('region', { name: 'Vault' }));
    fireEvent.click(
      vault.getByRole('button', {
        name: 'Bring Whirlwind to the loadout (2 Stress, free during Rest)',
      }),
    );
    const room = within(vault.getByRole('group', { name: 'Make room for Whirlwind' }));
    expect(sentTo(fetchMock, 'POST', `/domain-cards/${WHIRL}/move`)).toEqual([]);
    fireEvent.click(room.getByRole('button', { name: 'Put Song 3 in the vault' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/domain-cards/${WHIRL}/move`)).toEqual([
        { to: 'loadout', swapOut: songs[2] },
      ]);
    });
    expect(await vault.findByRole('article', { name: 'Song 3, a Grace card' })).toBeDefined();
  });
});

describe('A player marking their own tracks (D-67)', () => {
  it('sets HP, Stress, Hope and armor slots from the bubbles', async () => {
    const { coast, vex, fetchMock } = world('player', {
      hpMax: 6,
      hpCurrent: 6,
      hope: 2,
      links: {
        classId: null,
        subclassId: null,
        subclassCards: 1,
        speciesIds: [null, null],
        primaryWeaponId: null,
        secondaryWeaponId: null,
        armorId: CHAINMAIL,
        spareWeaponIds: [],
      },
    });
    renderAt(sheetUrl(coast, vex));
    const tracks = () => sentTo(fetchMock, 'POST', `/characters/${vex.id}/tracks`);

    expect(await screen.findByLabelText('HP: 6 of 6')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Set HP to 4' }));
    expect(await screen.findByLabelText('HP: 4 of 6')).toBeDefined();
    // The last filled bubble lowers it by one.
    fireEvent.click(screen.getByRole('button', { name: 'Lower HP to 3' }));
    expect(await screen.findByLabelText('HP: 3 of 6')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Raise Stress' }));
    expect(await screen.findByLabelText('Stress: 1 of 6')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Lower Hope' }));
    expect(await screen.findByLabelText('Hope: 1 of 6')).toBeDefined();
    // Chainmail gives four slots.
    fireEvent.click(screen.getByRole('button', { name: 'Set Armor slots to 2' }));
    expect(await screen.findByLabelText('Armor slots: 2 of 4')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Raise Hope' })).toHaveProperty('disabled', false);

    expect(tracks()).toEqual([
      { hpCurrent: 4 },
      { hpCurrent: 3 },
      { stressCurrent: 1 },
      { hope: 1 },
      { armorSlotsMarked: 2 },
    ]);
  });

  it('shows the thresholds as damage boxes', async () => {
    const { coast, vex } = world('player', {
      minorThreshold: 3,
      majorThreshold: 7,
      severeThreshold: 14,
    });
    renderAt(sheetUrl(coast, vex));
    const strip = within(await screen.findByRole('group', { name: 'Damage thresholds' }));
    expect(strip.getByText('Minor damage')).toBeDefined();
    expect(strip.getByText('Mark 3 HP')).toBeDefined();
    expect(strip.getByLabelText('Minor threshold: 3')).toBeDefined();
    expect(strip.getByLabelText('Major threshold: 7')).toBeDefined();
  });
});
