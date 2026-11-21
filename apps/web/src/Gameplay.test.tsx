import { type Campaign } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { campaign, currentUrl, MIRA, mockApi, renderAt, statBlock } from '@/test/app-harness';
import type { DomainCardSeed, DomainSeed } from '@/test/gameplay-world';

type FetchMock = ReturnType<typeof mockApi>;
const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const TIDE = '00000000-0000-4000-a500-000000000001';
const EMBER = '00000000-0000-4000-a500-000000000002';
const UNDERTOW = '00000000-0000-4000-a500-000000000011';
const CREST = '00000000-0000-4000-a500-000000000012';

const FEATURE = {
  type: 'doc' as const,
  content: [
    { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Pull a foe under.' }] },
  ],
};

/** Opens a Radix dropdown menu from the keyboard (jsdom has no real pointer events). */
function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
}

/** The parsed JSON bodies of every request with `method` to a path ending in `suffix`. */
function bodiesOf(fetchMock: FetchMock, method: string, suffix: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => init?.method === method && urlOf(input).endsWith(suffix))
    .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));
}

/** A campaign with a Tide domain (two cards) and an empty Ember domain. */
function world(overrides: Partial<Campaign> = {}) {
  const coast = campaign({ name: 'Shattered Coast', ...overrides });
  const domains: DomainSeed[] = [
    { id: TIDE, name: 'Tide', description: 'The sea and its pull. Second sentence.' },
    { id: EMBER, name: 'Ember', description: '' },
  ];
  const cards: DomainCardSeed[] = [
    { id: UNDERTOW, domainId: TIDE, name: 'Undertow', level: 1, type: 'spell', feature: FEATURE },
    { id: CREST, domainId: TIDE, name: 'Crest', level: 3, recallCost: 2 },
  ];
  const fetchMock = mockApi(MIRA, [coast], {
    domains: { [coast.id]: domains },
    domainCards: { [coast.id]: cards },
  });
  return { coast, fetchMock };
}

const gameplayUrl = (c: Campaign) => `/campaigns/${c.id}/gameplay`;
const domainUrl = (c: Campaign, id: string) => `/campaigns/${c.id}/gameplay/domains/${id}`;
const cardUrl = (c: Campaign, id: string) => `/campaigns/${c.id}/gameplay/domain-cards/${id}`;

describe('The gameplay section (F4.3)', () => {
  it('is reached from the campaign page, with the domains and the GM’s stat blocks', async () => {
    const { coast } = world();
    renderAt(`/campaigns/${coast.id}`);
    fireEvent.click(await screen.findByRole('link', { name: 'Open gameplay' }));

    const list = within(await screen.findByRole('list', { name: 'Domains' }));
    expect(list.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Ember0 cards',
      'TideThe sea and its pull.2 cards',
    ]);
    expect(screen.getByRole('link', { name: 'Open stat blocks' })).toBeDefined();
  });

  it('starts a fresh campaign with the ten default domains', async () => {
    const coast = campaign({ name: 'Fresh' });
    mockApi(MIRA, [coast]);
    renderAt(gameplayUrl(coast));
    const list = within(await screen.findByRole('list', { name: 'Domains' }));
    expect(list.getAllByRole('link')).toHaveLength(10);
    expect(list.getByText('Arcana')).toBeDefined();
    expect(list.getByText('Arcana is the domain of innate and instinctual magic.')).toBeDefined();
  });

  it('shows players the domains, with no stat blocks and no way to add', async () => {
    const { coast, fetchMock } = world({ role: 'player' });
    renderAt(gameplayUrl(coast));
    expect(await screen.findByRole('list', { name: 'Domains' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Open stat blocks' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New domain' })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith('/stat-blocks'))).toBe(
      false,
    );
  });

  it('lets the GM add a domain and opens it', async () => {
    const { coast } = world();
    renderAt(gameplayUrl(coast));
    fireEvent.click(await screen.findByRole('button', { name: 'New domain' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Reef' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create domain' }));
    expect(await screen.findByRole('textbox', { name: 'Domain name' })).toHaveProperty(
      'value',
      'Reef',
    );
    expect(currentUrl()).toMatch(new RegExp(`^${gameplayUrl(coast)}/domains/.+`));
  });
});

describe('A domain', () => {
  it('lists its cards by level, and the GM edits its name and description', async () => {
    const { coast, fetchMock } = world();
    renderAt(domainUrl(coast, TIDE));

    expect(
      within(await screen.findByRole('list', { name: 'Level 1' })).getByText('Undertow'),
    ).toBeDefined();
    expect(within(screen.getByRole('list', { name: 'Level 3' })).getByText('Crest')).toBeDefined();
    expect(screen.getByText('Spell · recall 0')).toBeDefined();

    const description = screen.getByLabelText('Description');
    fireEvent.change(description, { target: { value: 'Line one.\nLine two.' } });
    fireEvent.blur(description);
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PATCH', `/domains/${TIDE}`)).toEqual([
        { description: 'Line one.\nLine two.' },
      ]);
    });
  });

  it('says why it can’t be deleted while it has cards', async () => {
    const { coast } = world();
    renderAt(domainUrl(coast, TIDE));
    await screen.findByRole('textbox', { name: 'Domain name' });
    openMenu('Domain settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete domain' }));
    expect(
      await screen.findByText('Used by Undertow, Crest. Move or delete them first.'),
    ).toBeDefined();
    expect(currentUrl()).toBe(domainUrl(coast, TIDE));
  });

  it('deletes an empty one and goes back to gameplay', async () => {
    const { coast } = world();
    renderAt(domainUrl(coast, EMBER));
    await screen.findByRole('textbox', { name: 'Domain name' });
    openMenu('Domain settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete domain' }));
    await waitFor(() => {
      expect(currentUrl()).toBe(gameplayUrl(coast));
    });
  });

  it('lets the GM add a card to it', async () => {
    const { coast } = world();
    renderAt(domainUrl(coast, EMBER));
    fireEvent.click(await screen.findByRole('button', { name: 'New card' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Kindle' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create card' }));
    expect(await screen.findByRole('textbox', { name: 'Card name' })).toHaveProperty(
      'value',
      'Kindle',
    );
  });

  it('shows players the description as text, with nothing to edit', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(domainUrl(coast, TIDE));
    expect(await screen.findByRole('heading', { name: 'Tide' })).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New card' })).toBeNull();
  });
});

describe('A domain card', () => {
  it('lets the GM set its level, recall cost, type and domain', async () => {
    const { coast, fetchMock } = world();
    renderAt(cardUrl(coast, CREST));

    const level = await screen.findByLabelText('Level');
    fireEvent.change(level, { target: { value: '11' } });
    fireEvent.blur(level);
    expect(await screen.findByText('Level must be 10 or less')).toBeDefined();
    fireEvent.change(level, { target: { value: '4' } });
    const recall = screen.getByLabelText('Recall cost');
    fireEvent.change(recall, { target: { value: '1' } });
    fireEvent.blur(recall);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'grimoire' } });
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: EMBER } });

    await waitFor(() => {
      expect(Object.assign({}, ...bodiesOf(fetchMock, 'PATCH', `/domain-cards/${CREST}`))).toEqual({
        level: 4,
        recallCost: 1,
        type: 'grimoire',
        domainId: EMBER,
      });
    });
  });

  it('shows a player the card, drawn as a card', async () => {
    const { coast } = world({ role: 'player' });
    renderAt(cardUrl(coast, UNDERTOW));
    const card = within(await screen.findByRole('article', { name: 'Undertow, a Tide card' }));
    expect(card.getByText('Level 1')).toBeDefined();
    expect(card.getByText('Spell · Recall cost 0')).toBeDefined();
    expect(card.getByText('Pull a foe under.')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('A new campaign’s gameplay records (19.14)', () => {
  it('starts fresh, or copies from a campaign the GM runs', async () => {
    const mine = campaign({ name: 'Shattered Coast' });
    const played = campaign({ name: 'Their Game', role: 'player' });
    const fetchMock = mockApi(MIRA, [mine, played], {
      domains: { [mine.id]: [{ id: TIDE, name: 'Tide' }] },
      campaignData: { [mine.id]: { statBlocks: [statBlock({ name: 'Reef Shark' })] } },
    });
    renderAt('/');

    fireEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Campaign name'), { target: { value: 'Sequel' } });
    fireEvent.click(dialog.getByLabelText(/Copy from another campaign/));
    const from = dialog.getByLabelText('Copy gameplay records from');
    expect(
      within(from)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Shattered Coast']);
    fireEvent.click(dialog.getByRole('button', { name: 'Create campaign' }));

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'POST', '/api/campaigns')).toEqual([
        { name: 'Sequel', copyGameplayFrom: mine.id },
      ]);
    });
    await waitFor(() => {
      expect(currentUrl()).toMatch(/^\/campaigns\/[^/]+$/);
    });
    fireEvent.click(await screen.findByRole('link', { name: 'Open gameplay' }));
    const list = within(await screen.findByRole('list', { name: 'Domains' }));
    expect(list.getAllByRole('link').map((link) => link.textContent)).toEqual(['Tide0 cards']);
  });

  it('offers no choice to someone who runs no other campaign', async () => {
    mockApi(MIRA, [campaign({ name: 'Their Game', role: 'player' })]);
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.queryByText('Gameplay records')).toBeNull();
  });
});
