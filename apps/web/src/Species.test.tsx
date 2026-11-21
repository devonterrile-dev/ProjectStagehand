import { type Campaign } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { campaign, currentUrl, MIRA, mockApi, renderAt } from '@/test/app-harness';

type FetchMock = ReturnType<typeof mockApi>;
const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const FAERIE = '00000000-0000-4000-a800-000000000001';
const ORC = '00000000-0000-4000-a800-000000000002';

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

/** A campaign with two species. */
function world(overrides: Partial<Campaign> = {}) {
  const coast = campaign({ name: 'Shattered Coast', ...overrides });
  const fetchMock = mockApi(MIRA, [coast], {
    species: {
      [coast.id]: [
        {
          id: FAERIE,
          name: 'Faerie',
          description: 'Winged folk. They glow faintly.',
          features: [
            { name: 'Luckbender', text: 'Spend 3 Hope to reroll.' },
            { name: 'Wings', text: 'You can fly.' },
          ],
        },
        { id: ORC, name: 'Orc' },
      ],
    },
  });
  return { coast, fetchMock };
}

const gameplayUrl = (c: Campaign) => `/campaigns/${c.id}/gameplay`;
const speciesUrl = (c: Campaign, id: string) => `${gameplayUrl(c)}/species/${id}`;

describe('Species on the gameplay page (F4.6)', () => {
  it('lists species with a line of description and their features, for players too', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(gameplayUrl(coast));
    const list = within(await screen.findByRole('list', { name: 'Species' }));
    expect(list.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'FaerieWinged folk.2 features',
      'Orc0 features',
    ]);
    expect(screen.queryByRole('button', { name: 'New species' })).toBeNull();
  });

  it('lets the GM add a species and opens it', async () => {
    const { coast } = world();
    renderAt(gameplayUrl(coast));
    fireEvent.click(await screen.findByRole('button', { name: 'New species' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Katari' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create species' }));
    expect(await screen.findByRole('textbox', { name: 'Species name' })).toHaveProperty(
      'value',
      'Katari',
    );
    expect(currentUrl()).toMatch(new RegExp(`^${gameplayUrl(coast)}/species/[0-9a-f-]+$`));
  });
});

describe('A species', () => {
  it('lets the GM set its description and features, in order', async () => {
    const { coast, fetchMock } = world();
    renderAt(speciesUrl(coast, ORC));
    fireEvent.change(await screen.findByLabelText('Description'), {
      target: { value: 'Strong folk.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feature' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Feature 1 name' }), {
      target: { value: 'Sturdy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feature' }));
    const second = screen.getByRole('textbox', { name: 'Feature 2 name' });
    fireEvent.change(second, { target: { value: 'Tusks' } });
    fireEvent.blur(second);
    await waitFor(() => {
      expect(patchedAt(fetchMock, `/species/${ORC}`)).toEqual({
        description: 'Strong folk.',
        features: [
          { name: 'Sturdy', text: '' },
          { name: 'Tusks', text: '' },
        ],
      });
    });
  });

  it('deletes and goes back to the gameplay page', async () => {
    const { coast } = world();
    renderAt(speciesUrl(coast, ORC));
    await screen.findByRole('textbox', { name: 'Species name' });
    openMenu('Species settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete species' }));
    await waitFor(() => {
      expect(currentUrl()).toBe(gameplayUrl(coast));
    });
    const list = within(await screen.findByRole('list', { name: 'Species' }));
    expect(list.queryByText('Orc')).toBeNull();
  });

  it('shows players the species as a card', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(speciesUrl(coast, FAERIE));
    const card = within(await screen.findByRole('article', { name: 'Faerie, a species' }));
    expect(card.getByText('Winged folk. They glow faintly.')).toBeDefined();
    const features = card.getByRole('region', { name: 'Features' });
    expect(
      within(features)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Luckbender: Spend 3 Hope to reroll.', 'Wings: You can fly.']);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
