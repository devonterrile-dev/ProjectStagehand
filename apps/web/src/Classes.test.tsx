import { type Campaign } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { campaign, currentUrl, MIRA, mockApi, renderAt } from '@/test/app-harness';

type FetchMock = ReturnType<typeof mockApi>;
const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const BLADE = '00000000-0000-4000-a700-000000000001';
const BONE = '00000000-0000-4000-a700-000000000002';
const VALOR = '00000000-0000-4000-a700-000000000003';
const WARRIOR = '00000000-0000-4000-a700-000000000011';
const GUARDIAN = '00000000-0000-4000-a700-000000000012';
const CALL = '00000000-0000-4000-a700-000000000021';
const STALWART = '00000000-0000-4000-a700-000000000022';
const SWORD = '00000000-0000-4000-a700-000000000031';
const AXE = '00000000-0000-4000-a700-000000000032';
const SHIELD = '00000000-0000-4000-a700-000000000033';
const BIG_SWORD = '00000000-0000-4000-a700-000000000034';
const MAIL = '00000000-0000-4000-a700-000000000041';
const PLATE = '00000000-0000-4000-a700-000000000042';

/** Opens a Radix dropdown menu from the keyboard (jsdom has no real pointer events). */
function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
}

/** Every PATCH body sent to a path ending in `suffix`, merged in order. */
function patchedAt(fetchMock: FetchMock, suffix: string): Record<string, unknown> {
  return Object.assign(
    {},
    ...fetchMock.mock.calls
      .filter(([input, init]) => init?.method === 'PATCH' && urlOf(input).endsWith(suffix))
      .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : {})),
  ) as Record<string, unknown>;
}

/** A campaign with three domains, two classes (one with two subclasses) and some tier 1 gear. */
function world(overrides: Partial<Campaign> = {}) {
  const coast = campaign({ name: 'Shattered Coast', ...overrides });
  const fetchMock = mockApi(MIRA, [coast], {
    domains: {
      [coast.id]: [
        { id: BLADE, name: 'Blade' },
        { id: BONE, name: 'Bone' },
        { id: VALOR, name: 'Valor' },
      ],
    },
    weapons: {
      [coast.id]: [
        { id: SWORD, name: 'Broadsword' },
        { id: AXE, name: 'Battleaxe', burden: 'two_handed' },
        { id: SHIELD, name: 'Round shield', slot: 'secondary' },
        { id: BIG_SWORD, name: 'Tier 2 sword', tier: 2 },
      ],
    },
    armor: {
      [coast.id]: [
        { id: MAIL, name: 'Chainmail' },
        { id: PLATE, name: 'Plate', tier: 3 },
      ],
    },
    classes: {
      [coast.id]: [
        {
          id: WARRIOR,
          name: 'Warrior',
          description: 'Fighters of the front line.',
          domainIds: [BLADE, BONE],
          startingEvasion: 11,
          hopeFeature: { name: 'No Mercy', cost: 3, text: '+1 to attack rolls.' },
          classFeatures: [{ name: 'Combat Training', text: 'Ignore burden.' }],
          suggestedTraits: {
            agility: 2,
            strength: 1,
            finesse: 0,
            instinct: 1,
            presence: -1,
            knowledge: 0,
          },
          suggestedPrimaryWeaponId: SWORD,
          suggestedSecondaryWeaponId: SHIELD,
        },
        { id: GUARDIAN, name: 'Guardian', domainIds: [VALOR, null] },
      ],
    },
    subclasses: {
      [coast.id]: [
        {
          id: CALL,
          classId: WARRIOR,
          name: 'Call of the Brave',
          foundation: [{ name: 'Courage', text: 'Gain a Hope when you fail with Fear.' }],
        },
        { id: STALWART, classId: WARRIOR, name: 'Call of the Slayer', spellcastTrait: null },
      ],
    },
  });
  return { coast, fetchMock };
}

const gameplayUrl = (c: Campaign) => `/campaigns/${c.id}/gameplay`;
const classUrl = (c: Campaign, id: string) => `${gameplayUrl(c)}/classes/${id}`;

describe('Classes on the gameplay page (F4.5)', () => {
  it('lists classes with their domains and subclasses, for players too', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(gameplayUrl(coast));
    const list = within(await screen.findByRole('list', { name: 'Classes' }));
    expect(list.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'GuardianValor0 subclasses',
      'WarriorBlade & Bone2 subclasses',
    ]);
    expect(screen.queryByRole('button', { name: 'New class' })).toBeNull();
  });

  it('lets the GM add a class and opens it', async () => {
    const { coast } = world();
    renderAt(gameplayUrl(coast));
    fireEvent.click(await screen.findByRole('button', { name: 'New class' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Bard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create class' }));
    expect(await screen.findByRole('textbox', { name: 'Class name' })).toHaveProperty(
      'value',
      'Bard',
    );
    expect(currentUrl()).toMatch(new RegExp(`^${gameplayUrl(coast)}/classes/[0-9a-f-]+$`));
  });
});

describe('A class', () => {
  it('lets the GM set its domains, numbers, Hope feature and features', async () => {
    const { coast, fetchMock } = world();
    renderAt(classUrl(coast, GUARDIAN));
    const second = await screen.findByLabelText('Second domain');
    await within(second).findByRole('option', { name: 'Blade' });
    // The first domain's pick isn't offered again in the second.
    expect(within(second).queryByRole('option', { name: 'Valor' })).toBeNull();
    fireEvent.change(second, { target: { value: BLADE } });
    fireEvent.change(screen.getByLabelText('Starting HP'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Hope feature name'), {
      target: { value: 'Frontline Tank' },
    });
    fireEvent.change(screen.getByLabelText('Hope cost'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add class feature' }));
    const featureName = screen.getByRole('textbox', { name: 'Class feature 1 name' });
    fireEvent.change(featureName, { target: { value: 'Unstoppable' } });
    fireEvent.blur(featureName);

    await waitFor(() => {
      expect(patchedAt(fetchMock, `/classes/${GUARDIAN}`)).toEqual({
        domainIds: [VALOR, BLADE],
        startingHp: 7,
        hopeFeature: { name: 'Frontline Tank', cost: 3, text: '' },
        classFeatures: [{ name: 'Unstoppable', text: '' }],
      });
    });
  });

  it('warns while the suggested traits are not the creation spread', async () => {
    const { coast } = world();
    renderAt(classUrl(coast, WARRIOR));
    const warning = /Suggested traits are usually one \+2/;
    const knowledge = await screen.findByLabelText('Knowledge');
    expect(screen.queryByText(warning)).toBeNull();
    fireEvent.change(knowledge, { target: { value: '2' } });
    expect(await screen.findByText(warning)).toBeDefined();
  });

  it('offers only tier 1 gear of the slot, and a two-handed primary clears the secondary', async () => {
    const { coast, fetchMock } = world();
    renderAt(classUrl(coast, WARRIOR));
    const primary = await screen.findByLabelText('Primary weapon');
    await within(primary).findByRole('option', { name: 'Battleaxe' });
    expect(
      within(primary)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['None', 'Battleaxe', 'Broadsword']);
    expect(
      within(screen.getByLabelText('Armor'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['None', 'Chainmail']);

    fireEvent.change(primary, { target: { value: AXE } });
    const secondary = screen.getByLabelText('Secondary weapon');
    expect(secondary).toHaveProperty('disabled', true);
    expect(secondary).toHaveProperty('value', '');
    await waitFor(() => {
      expect(patchedAt(fetchMock, `/classes/${WARRIOR}`)).toEqual({
        suggestedPrimaryWeaponId: AXE,
        suggestedSecondaryWeaponId: null,
      });
    });
  });

  it('says its subclasses go with it when deleted', async () => {
    const { coast } = world();
    renderAt(classUrl(coast, WARRIOR));
    await screen.findByRole('textbox', { name: 'Class name' });
    openMenu('Class settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    expect(
      await screen.findByText("This deletes its 2 subclasses too, and can't be undone."),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Delete class' }));
    await waitFor(() => {
      expect(currentUrl()).toBe(gameplayUrl(coast));
    });
    const list = within(await screen.findByRole('list', { name: 'Classes' }));
    expect(list.queryByText('Warrior')).toBeNull();
  });

  it('keeps a domain it uses from being deleted', async () => {
    const { coast } = world();
    renderAt(`${gameplayUrl(coast)}/domains/${VALOR}`);
    await screen.findByRole('textbox', { name: 'Domain name' });
    openMenu('Domain settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete domain' }));
    expect(await screen.findByText('Used by Guardian. Change or delete them first.')).toBeDefined();
  });

  it('shows players the class as a card, with its subclasses', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(classUrl(coast, WARRIOR));
    const card = within(await screen.findByRole('article', { name: 'Warrior, a class' }));
    expect(card.getByText('Blade & Bone')).toBeDefined();
    expect(card.getByText('No Mercy (3 Hope)')).toBeDefined();
    expect(card.getByText('Combat Training')).toBeDefined();
    expect(
      card.getByText('Agility +2, Strength +1, Finesse 0, Instinct +1, Presence −1, Knowledge 0'),
    ).toBeDefined();
    expect(card.getByText('Broadsword, Round shield')).toBeDefined();
    const subclasses = within(screen.getByRole('list', { name: 'Warrior subclasses' }));
    expect(subclasses.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Call of the BraveNo spellcasting',
      'Call of the SlayerNo spellcasting',
    ]);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New subclass' })).toBeNull();
  });
});

describe('A subclass', () => {
  it('lets the GM add one from the class page and fill it in', async () => {
    const { coast, fetchMock } = world();
    renderAt(classUrl(coast, GUARDIAN));
    fireEvent.click(await screen.findByRole('button', { name: 'New subclass' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Stalwart' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create subclass' }));
    const spellcast = await screen.findByLabelText('Spellcast trait');
    expect(screen.getByText('A subclass of Guardian.')).toBeDefined();
    const subclassUrl = currentUrl();
    expect(subclassUrl).toMatch(new RegExp(`^${classUrl(coast, GUARDIAN)}/subclasses/`));

    fireEvent.change(spellcast, { target: { value: 'strength' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add mastery feature' }));
    const name = screen.getByRole('textbox', { name: 'Mastery feature 1 name' });
    fireEvent.change(name, { target: { value: 'Undaunted' } });
    fireEvent.blur(name);
    const id = subclassUrl.split('/').at(-1) ?? '';
    await waitFor(() => {
      expect(patchedAt(fetchMock, `/subclasses/${id}`)).toEqual({
        spellcastTrait: 'strength',
        mastery: [{ name: 'Undaunted', text: '' }],
      });
    });
  });

  it('shows players the subclass as a card', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(`${classUrl(coast, WARRIOR)}/subclasses/${CALL}`);
    const card = within(
      await screen.findByRole('article', { name: 'Call of the Brave, a Warrior subclass' }),
    );
    expect(card.getByText('Courage')).toBeDefined();
    expect(card.getByRole('region', { name: 'Mastery' }).textContent).toContain('None yet.');
    expect(screen.getByRole('link', { name: '← Warrior' })).toBeDefined();
  });
});
