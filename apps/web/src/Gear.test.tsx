import { noGearBonuses, type Campaign } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { campaign, currentUrl, MIRA, mockApi, renderAt } from '@/test/app-harness';

type FetchMock = ReturnType<typeof mockApi>;
const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const GREATSWORD = '00000000-0000-4000-a600-000000000001';
const DAGGER = '00000000-0000-4000-a600-000000000002';
const SHIELD = '00000000-0000-4000-a600-000000000003';
const LONGBOW = '00000000-0000-4000-a600-000000000004';
const CHAINMAIL = '00000000-0000-4000-a600-000000000011';
const PLATE = '00000000-0000-4000-a600-000000000012';

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

/** A campaign with four weapons over two tiers and two pieces of armor. */
function world(overrides: Partial<Campaign> = {}) {
  const coast = campaign({ name: 'Shattered Coast', ...overrides });
  const fetchMock = mockApi(MIRA, [coast], {
    weapons: {
      [coast.id]: [
        {
          id: GREATSWORD,
          name: 'Greatsword',
          trait: 'strength',
          damageDie: 10,
          damageBonus: 3,
          burden: 'two_handed',
          featureName: 'Massive',
          featureText: '−1 to Evasion',
          bonuses: { ...noGearBonuses(), evasion: -1 },
        },
        { id: DAGGER, name: 'Dagger', trait: 'finesse', damageDie: 8, damageBonus: 1 },
        { id: SHIELD, name: 'Round shield', slot: 'secondary', damageDie: 4 },
        { id: LONGBOW, name: 'Longbow', tier: 2, range: 'far', damageDie: 8 },
      ],
    },
    armor: {
      [coast.id]: [
        { id: CHAINMAIL, name: 'Chainmail', baseMajorThreshold: 7, baseSevereThreshold: 15 },
        { id: PLATE, name: 'Plate', tier: 3, baseScore: 6, featureName: 'Very heavy' },
      ],
    },
  });
  return { coast, fetchMock };
}

const gameplayUrl = (c: Campaign) => `/campaigns/${c.id}/gameplay`;
const weaponsUrl = (c: Campaign) => `${gameplayUrl(c)}/weapons`;
const armorUrl = (c: Campaign) => `${gameplayUrl(c)}/armor`;

describe('Gear on the gameplay page (F4.4)', () => {
  it('lists weapons and armor with their counts, for players too', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(gameplayUrl(coast));
    const gear = within(await screen.findByRole('list', { name: 'Gear' }));
    await waitFor(() => {
      expect(gear.getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Weapons4 weapons',
        'Armor2 pieces',
      ]);
    });
    fireEvent.click(gear.getByRole('link', { name: /Weapons/ }));
    expect(await screen.findByRole('heading', { name: 'Weapons' })).toBeDefined();
    expect(currentUrl()).toBe(weaponsUrl(coast));
  });
});

describe('The weapons list', () => {
  it('groups by tier, then primary and secondary, as tables', async () => {
    const { coast } = world();
    renderAt(weaponsUrl(coast));
    const primary = within(await screen.findByRole('table', { name: 'Tier 1 primary weapons' }));
    const rows = primary.getAllByRole('row').map((row) => row.textContent);
    expect(rows).toEqual([
      'NameTraitRangeDamageBurdenFeature',
      'DaggerFinesseMeleed8+1 physicalOne-handed',
      'GreatswordStrengthMeleed10+3 physicalTwo-handedMassive',
    ]);
    expect(
      within(screen.getByRole('table', { name: 'Tier 1 secondary weapons' })).getByText(
        'Round shield',
      ),
    ).toBeDefined();
    expect(
      within(screen.getByRole('table', { name: 'Tier 2 primary weapons' })).getByText('Far'),
    ).toBeDefined();
  });

  it('lets the GM add a weapon and opens it', async () => {
    const { coast } = world();
    renderAt(weaponsUrl(coast));
    fireEvent.click(await screen.findByRole('button', { name: 'New weapon' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Rapier' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create weapon' }));
    expect(await screen.findByRole('textbox', { name: 'Weapon name' })).toHaveProperty(
      'value',
      'Rapier',
    );
    expect(currentUrl()).toMatch(new RegExp(`^${weaponsUrl(coast)}/.+`));
  });

  it('gives players no way to add', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(weaponsUrl(coast));
    expect(await screen.findByRole('table', { name: 'Tier 1 primary weapons' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'New weapon' })).toBeNull();
  });
});

describe('A weapon', () => {
  it('lets the GM set its numbers, feature and bonuses', async () => {
    const { coast, fetchMock } = world();
    renderAt(`${weaponsUrl(coast)}/${DAGGER}`);

    fireEvent.change(await screen.findByLabelText('Tier'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Trait'), { target: { value: 'agility' } });
    fireEvent.change(screen.getByLabelText('Range'), { target: { value: 'very_close' } });
    fireEvent.change(screen.getByLabelText('Damage die'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Damage type'), { target: { value: 'magic' } });
    fireEvent.change(screen.getByLabelText('Burden'), { target: { value: 'two_handed' } });
    const bonus = screen.getByLabelText('Damage bonus');
    fireEvent.change(bonus, { target: { value: '-1' } });
    fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'Quick' } });
    fireEvent.change(screen.getByLabelText('What it does'), {
      target: { value: '+1 to Evasion; −1 Strength' },
    });
    fireEvent.change(screen.getByLabelText('Evasion bonus'), { target: { value: '1' } });
    const strength = screen.getByLabelText('Strength');
    fireEvent.change(strength, { target: { value: '-1' } });
    fireEvent.blur(strength);

    await waitFor(() => {
      expect(patchedAt(fetchMock, `/weapons/${DAGGER}`)).toEqual({
        tier: 2,
        trait: 'agility',
        range: 'very_close',
        damageDie: 12,
        kind: 'magic',
        burden: 'two_handed',
        damageBonus: -1,
        featureName: 'Quick',
        featureText: '+1 to Evasion; −1 Strength',
        bonuses: { ...noGearBonuses(), evasion: 1, traits: { strength: -1 } },
      });
    });
  });

  it('hides the burden of a secondary weapon, which is one-handed', async () => {
    const { coast, fetchMock } = world();
    renderAt(`${weaponsUrl(coast)}/${GREATSWORD}`);
    expect(await screen.findByLabelText('Burden')).toHaveProperty('value', 'two_handed');
    fireEvent.change(screen.getByLabelText('Slot'), { target: { value: 'secondary' } });
    expect(screen.queryByLabelText('Burden')).toBeNull();
    await waitFor(() => {
      expect(patchedAt(fetchMock, `/weapons/${GREATSWORD}`)).toEqual({ slot: 'secondary' });
    });
  });

  it('deletes and goes back to the list', async () => {
    const { coast } = world();
    renderAt(`${weaponsUrl(coast)}/${SHIELD}`);
    await screen.findByRole('textbox', { name: 'Weapon name' });
    openMenu('Weapon settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete weapon' }));
    await waitFor(() => {
      expect(currentUrl()).toBe(weaponsUrl(coast));
    });
    expect(await screen.findByText('Dagger')).toBeDefined();
    expect(screen.queryByText('Round shield')).toBeNull();
  });

  it('shows players the weapon as a card, with what it changes', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(`${weaponsUrl(coast)}/${GREATSWORD}`);
    const card = within(
      await screen.findByRole('article', { name: 'Greatsword, a tier 1 primary weapon' }),
    );
    expect(card.getByText('Tier 1 · Primary weapon')).toBeDefined();
    expect(card.getByText('d10+3 physical')).toBeDefined();
    expect(card.getByText('Two-handed')).toBeDefined();
    expect(card.getByText('While equipped: −1 Evasion')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('Armor', () => {
  it('lists by tier with thresholds and score', async () => {
    const { coast } = world();
    renderAt(armorUrl(coast));
    const tier1 = within(await screen.findByRole('table', { name: 'Tier 1 armor' }));
    expect(tier1.getAllByRole('row').map((row) => row.textContent)).toEqual([
      'NameThresholdsScoreFeature',
      'Chainmail7 / 150',
    ]);
    expect(
      within(screen.getByRole('table', { name: 'Tier 3 armor' })).getByText('Very heavy'),
    ).toBeDefined();
  });

  it('lets the GM set the thresholds and warns while severe is below major', async () => {
    const { coast, fetchMock } = world();
    renderAt(`${armorUrl(coast)}/${CHAINMAIL}`);
    const severe = await screen.findByLabelText('Severe threshold');
    fireEvent.change(severe, { target: { value: '5' } });
    expect(
      await screen.findByText('The severe threshold is usually at least the major threshold.'),
    ).toBeDefined();
    fireEvent.change(severe, { target: { value: '16' } });
    fireEvent.change(screen.getByLabelText('Armor score'), { target: { value: '4' } });
    fireEvent.blur(severe);
    await waitFor(() => {
      expect(patchedAt(fetchMock, `/armor/${CHAINMAIL}`)).toEqual({
        baseSevereThreshold: 16,
        baseScore: 4,
      });
    });
    expect(
      screen.queryByText('The severe threshold is usually at least the major threshold.'),
    ).toBeNull();
  });

  it('shows players the armor as a card', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(`${armorUrl(coast)}/${CHAINMAIL}`);
    const card = within(await screen.findByRole('article', { name: 'Chainmail, tier 1 armor' }));
    expect(card.getByText('7 / 15')).toBeDefined();
    expect(card.getByText('No feature.')).toBeDefined();
  });
});
