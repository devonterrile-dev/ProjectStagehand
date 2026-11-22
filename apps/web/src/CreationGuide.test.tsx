import { noGearBonuses, type Campaign, type StartingGear } from '@stagehand/shared';
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

const GRACE = '00000000-0000-4000-a910-000000000001';
const CODEX = '00000000-0000-4000-a910-000000000002';
const BLADE = '00000000-0000-4000-a910-000000000003';
const BARD = '00000000-0000-4000-a910-000000000011';
const TROUBADOUR = '00000000-0000-4000-a910-000000000012';
const FAERIE = '00000000-0000-4000-a910-000000000021';
const ORC = '00000000-0000-4000-a910-000000000022';
const RAPIER = '00000000-0000-4000-a910-000000000031';
const GREATSWORD = '00000000-0000-4000-a910-000000000032';
const DAGGER = '00000000-0000-4000-a910-000000000033';
const HALBERD = '00000000-0000-4000-a910-000000000034';
const LEATHER = '00000000-0000-4000-a910-000000000041';
const PLATE = '00000000-0000-4000-a910-000000000042';
const INSPIRE = '00000000-0000-4000-a910-000000000051';
const TOME = '00000000-0000-4000-a910-000000000052';
const MESMERIZE = '00000000-0000-4000-a910-000000000053';
const WHIRL = '00000000-0000-4000-a910-000000000054';
const SPREAD = { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 };

beforeEach(() => {
  window.localStorage.clear();
});

/** A campaign with records to build from, and Vex waiting for the guide. */
function world(
  role: Campaign['role'] = 'player',
  { startingGear, needsGuide = true }: { startingGear?: StartingGear; needsGuide?: boolean } = {},
) {
  const coast = campaign({ name: 'Shattered Coast', role });
  const jun = member('Jun');
  const vex = characterSheet({
    name: 'Vex',
    needsGuide,
    assignedToUserId: role === 'player' ? MIRA.id : jun.userId,
    inventory: [{ name: 'Old coin', detail: '' }],
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
        { id: INSPIRE, domainId: GRACE, name: 'Inspire', level: 1 },
        { id: TOME, domainId: CODEX, name: 'Tome', level: 1 },
        { id: MESMERIZE, domainId: GRACE, name: 'Mesmerize', level: 2 },
        { id: WHIRL, domainId: BLADE, name: 'Whirlwind', level: 1 },
      ],
    },
    classes: {
      [coast.id]: [
        {
          id: BARD,
          name: 'Bard',
          domainIds: [GRACE, CODEX],
          startingEvasion: 9,
          startingHp: 5,
          suggestedTraits: SPREAD,
          suggestedPrimaryWeaponId: RAPIER,
          suggestedArmorId: LEATHER,
        },
      ],
    },
    subclasses: { [coast.id]: [{ id: TROUBADOUR, classId: BARD, name: 'Troubadour' }] },
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
        { id: RAPIER, name: 'Rapier', damageDie: 8, bonuses: noGearBonuses() },
        { id: GREATSWORD, name: 'Greatsword', burden: 'two_handed', damageDie: 10 },
        { id: DAGGER, name: 'Parrying dagger', slot: 'secondary' },
        { id: HALBERD, name: 'Halberd', tier: 2 },
      ],
    },
    armor: {
      [coast.id]: [
        {
          id: LEATHER,
          name: 'Leather',
          baseMajorThreshold: 6,
          baseSevereThreshold: 13,
          baseScore: 3,
        },
        { id: PLATE, name: 'Plate', tier: 2 },
      ],
    },
    ...(startingGear === undefined ? {} : { startingGear: { [coast.id]: startingGear } }),
  });
  return { coast, vex, fetchMock, buildUrl: `/campaigns/${coast.id}/characters/${vex.id}/build` };
}

const next = () => screen.getByRole('button', { name: 'Next' });
const step = (name: string) => screen.findByRole('heading', { name, level: 2 });

/** Picks the Bard and its Troubadour, and moves on. */
async function classStep() {
  await step('Class');
  fireEvent.click(await screen.findByRole('radio', { name: /^Bard/ }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Troubadour' }));
  fireEvent.click(next());
}

/** Picks a Faerie, the class's traits as suggested, and moves on to Equipment. */
async function toEquipment() {
  await classStep();
  await step('Species');
  fireEvent.click(screen.getByRole('radio', { name: /^Faerie/ }));
  await waitFor(() => {
    expect(next()).toHaveProperty('disabled', false);
  });
  fireEvent.click(next());
  await step('Traits');
  fireEvent.click(next());
  await step('Equipment');
}

describe('The creation guide (F4.8)', () => {
  it('walks a player through every step and builds the character on Finish', async () => {
    const { coast, vex, fetchMock, buildUrl } = world();
    renderAt(buildUrl);

    await step('Class');
    expect(next()).toHaveProperty('disabled', true);
    expect(screen.getByText('Pick a class')).toBeDefined();
    fireEvent.click(await screen.findByRole('radio', { name: /^Bard/ }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Troubadour' }));
    fireEvent.click(next());

    await step('Species');
    fireEvent.click(screen.getByRole('radio', { name: /^Faerie/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Mixed ancestry/ }));
    expect(next()).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Second species'), { target: { value: ORC } });
    const features = within(
      await screen.findByRole('region', { name: "Your ancestry's features" }),
    );
    expect(await features.findByText('Luckbender (Faerie)')).toBeDefined();
    expect(features.getByText('Tusks (Orc)')).toBeDefined();
    expect(features.queryByText(/Wings|Sturdy/)).toBeNull();
    fireEvent.click(next());

    // The class's suggested traits are filled in.
    await step('Traits');
    expect(screen.getByText(/All placed/)).toBeDefined();
    fireEvent.change(screen.getByLabelText('Agility'), { target: { value: '1' } });
    expect(next()).toHaveProperty('disabled', true);
    expect(screen.getByText(/Still to place: \+2/)).toBeDefined();
    fireEvent.change(screen.getByLabelText('Agility'), { target: { value: '2' } });
    fireEvent.click(next());

    // The class's suggested gear is picked; only tier 1 gear is offered.
    await step('Equipment');
    const primary = screen.getByLabelText('Primary weapon');
    expect(primary).toHaveProperty('value', RAPIER);
    expect(within(primary).queryByRole('option', { name: 'Halberd' })).toBeNull();
    expect(screen.getByLabelText('Armor')).toHaveProperty('value', LEATHER);
    expect(screen.getByText('Pick a potion')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Secondary weapon (optional)'), {
      target: { value: DAGGER },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Minor Stamina Potion/ }));
    fireEvent.click(next());

    // Only level-1 cards of the class's two domains, two of them.
    await step('Domain cards');
    expect(screen.queryByRole('checkbox', { name: 'Take Mesmerize' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Take Whirlwind' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Take Inspire' }));
    expect(next()).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Take Tome' }));
    fireEvent.click(next());

    await step('Name');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'Vex');
    expect(screen.getByText(/Your GM's picture of them is drawn from this/)).toBeDefined();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Vex the Bold' },
    });
    fireEvent.click(next());

    await step('Review');
    const value = (label: string) => screen.getByText(label).nextSibling?.textContent;
    expect(value('Evasion')).toBe('9');
    expect(value('HP')).toBe('5');
    expect(value('Thresholds (major / severe)')).toBe('7 / 14');
    expect(value('Ancestry')).toBe('Faerie and Orc');
    expect(value('Domain cards')).toBe('Inspire, Tome');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/characters/${vex.id}/build`)).toEqual([
        {
          name: 'Vex the Bold',
          publicDescription: vex.publicDescription,
          classId: BARD,
          subclassId: TROUBADOUR,
          speciesIds: [FAERIE, ORC],
          traits: SPREAD,
          gear: {
            primaryWeaponId: RAPIER,
            secondaryWeaponId: DAGGER,
            armorId: LEATHER,
            potion: 'stamina',
          },
          cardIds: [INSPIRE, TOME],
        },
      ]);
    });
    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${coast.id}/characters/${vex.id}`);
    });
    expect(await screen.findByRole('heading', { name: 'Vex the Bold', level: 1 })).toBeDefined();
    expect(screen.getByText('Level 1 Bard · tier 1')).toBeDefined();
  });

  it('keeps a two-handed primary from taking a secondary', async () => {
    const { buildUrl } = world();
    renderAt(buildUrl);
    await toEquipment();
    fireEvent.change(screen.getByLabelText('Primary weapon'), { target: { value: GREATSWORD } });
    expect(screen.getByLabelText('Secondary weapon (optional)')).toHaveProperty('disabled', true);
    expect(screen.getByText(/Greatsword is two-handed/)).toBeDefined();
  });

  it("shows the GM's kit in the Set mode, and nothing to pick in None", async () => {
    const kit = {
      primaryWeaponId: GREATSWORD,
      secondaryWeaponId: null,
      armorId: null,
      items: [{ name: 'Lute', detail: '' }],
      gold: { handfuls: 0, bags: 1, chests: 0 },
    };
    const { buildUrl } = world('player', { startingGear: { mode: 'set', kit } });
    renderAt(buildUrl);
    await toEquipment();
    const list = within(screen.getByRole('list', { name: 'Starting gear' }));
    expect(list.getByText('Greatsword')).toBeDefined();
    expect(list.getByText('Lute')).toBeDefined();
    expect(list.getByText('1 bag of gold')).toBeDefined();
    expect(next()).toHaveProperty('disabled', false);
  });

  it('says there is nothing to pick when the starting gear is None', async () => {
    const { buildUrl } = world('player', {
      startingGear: {
        mode: 'none',
        kit: {
          primaryWeaponId: null,
          secondaryWeaponId: null,
          armorId: null,
          items: [],
          gold: { handfuls: 0, bags: 0, chests: 0 },
        },
      },
    });
    renderAt(buildUrl);
    await toEquipment();
    expect(screen.getByText(/Your GM hands out gear in play/)).toBeDefined();
  });

  it('keeps the picks in this browser when the page is opened again', async () => {
    const { buildUrl } = world();
    const first = renderAt(buildUrl);
    await classStep();
    await step('Species');
    first.unmount();

    renderAt(buildUrl);
    expect(await step('Species')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '1. Class' }));
    expect(await screen.findByRole('radio', { name: /^Bard/ })).toHaveProperty('checked', true);
  });
});

describe('Getting to the guide (F4.8)', () => {
  it('sends the player from the campaign page and the sheet page to build their PC', async () => {
    const { coast, vex } = world();
    const page = renderAt(`/campaigns/${coast.id}`);
    expect(await screen.findByText('Vex: waiting for you to build them.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Build your character' })).toHaveProperty(
      'href',
      expect.stringContaining(`/characters/${vex.id}/build`),
    );

    page.unmount();
    renderAt(`/campaigns/${coast.id}/characters/${vex.id}`);
    expect(await screen.findByText(/given you this character to build/)).toBeDefined();
  });

  it('shows the GM who is building, and lets them take the guide back or send a PC through it', async () => {
    const { coast, vex, fetchMock } = world('gm');
    renderAt(`/campaigns/${coast.id}/characters/${vex.id}`);
    expect(await screen.findByText(/Waiting for Jun to build this character/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Run the guide for them' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Fill it in by hand instead…' }));
    const skip = within(await screen.findByRole('alertdialog'));
    expect(skip.getByText(/won't get the creation guide for this character/)).toBeDefined();
    fireEvent.click(skip.getByRole('button', { name: 'Fill it in by hand' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/characters/${vex.id}/guide`)).toEqual([
        { needsGuide: false },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByText(/Waiting for Jun/)).toBeNull();
    });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Character settings' }), {
      key: 'Enter',
    });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Send through the creation guide…' }),
    );
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(
      dialog.getByText(/Experiences, combat options, spare weapons and your notes stay/),
    ).toBeDefined();
    fireEvent.click(dialog.getByRole('button', { name: 'Send through the guide' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, 'POST', `/characters/${vex.id}/guide`)).toEqual([
        { needsGuide: false },
        { needsGuide: true },
      ]);
    });
    expect(await screen.findByText(/Waiting for Jun/)).toBeDefined();
  });
});

describe('The starting gear on the Gameplay page (F4.8)', () => {
  it('lets the GM pick the mode and set a kit', async () => {
    const { coast, fetchMock } = world('gm', { needsGuide: false });
    renderAt(`/campaigns/${coast.id}/gameplay`);
    expect(await screen.findByRole('heading', { name: 'Starting gear' })).toBeDefined();
    expect(await screen.findByRole('radio', { name: /^Default/ })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: /^Set/ }));
    await waitFor(() => {
      expect(sentTo(fetchMock, 'PUT', '/starting-gear')).toHaveLength(1);
    });
    const kit = within(await screen.findByRole('region', { name: 'Starting kit' }));
    const primary = kit.getByLabelText('Primary weapon');
    await within(primary).findByRole('option', { name: 'Halberd (tier 2)' });
    fireEvent.change(primary, { target: { value: HALBERD } });
    expect(kit.getByText(/Halberd: above tier 1/)).toBeDefined();
    fireEvent.click(kit.getByRole('button', { name: 'Add item' }));
    fireEvent.change(kit.getByLabelText('Item 1'), { target: { value: 'Lute' } });
    fireEvent.change(kit.getByLabelText('Bags of gold'), { target: { value: '2' } });
    fireEvent.click(kit.getByRole('button', { name: 'Save kit' }));
    await waitFor(() => {
      expect(sentTo(fetchMock, 'PUT', '/starting-gear').at(-1)).toEqual({
        mode: 'set',
        kit: {
          primaryWeaponId: HALBERD,
          secondaryWeaponId: null,
          armorId: null,
          items: [{ name: 'Lute', detail: '' }],
          gold: { handfuls: 0, bags: 2, chests: 0 },
        },
      });
    });
  });
});
