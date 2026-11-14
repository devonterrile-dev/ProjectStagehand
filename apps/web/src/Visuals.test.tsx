import type { Campaign, CampaignRecord } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { visualPolling } from '@/lib/queries';
import {
  campaign,
  characterSheet,
  MIRA,
  mockApi,
  record,
  renderAt,
  type FakeWorld,
} from '@/test/app-harness';
import { assetSummary, FAIL_VISUAL_WORD, NO_OPENROUTER_KEY_MESSAGE } from '@/test/visuals-world';

type FetchMock = ReturnType<typeof mockApi>;

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const OPENROUTER = {
  provider: 'openrouter',
  lastFour: 'wxyz',
  createdAt: '2026-11-13T09:00:00.000Z',
} as const;

/** The parsed JSON bodies of every request to a URL ending in `suffix` with `method`. */
function bodiesTo(fetchMock: FetchMock, suffix: string, method: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => urlOf(input).endsWith(suffix) && init?.method === method)
    .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));
}

const visualCard = () => screen.findByRole('region', { name: 'Visual' });

function world(
  records: CampaignRecord[],
  extra: FakeWorld = {},
  overrides: Partial<Campaign> = {},
) {
  const coast = campaign({ name: 'Painted Coast', ...overrides });
  const pc = characterSheet({ name: 'Wren', className: 'Ranger' });
  const fetchMock = mockApi(MIRA, [coast], {
    credentials: [OPENROUTER],
    campaignData: { [coast.id]: { records, characters: [pc] } },
    ...extra,
  });
  return { coast, pc, fetchMock };
}

const recordPath = (c: Campaign, r: { id: string }) => `/campaigns/${c.id}/records/${r.id}`;

describe('Generate visual', () => {
  beforeAll(() => {
    visualPolling.intervalMs = 20;
  });
  afterAll(() => {
    visualPolling.intervalMs = 2000;
  });

  it('makes a prop image in one click, then shows it with its cost', async () => {
    const bell = record({ type: 'prop', name: 'Harbour Bell' });
    const { coast, fetchMock } = world([bell]);
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    expect(await within(card).findByText(/No visual yet/)).toBeDefined();
    expect(within(card).getByText(/About \$0\.07 an image/)).toBeDefined();
    fireEvent.click(within(card).getByRole('button', { name: 'Generate visual' }));

    expect(await within(card).findByText('Making the image…')).toBeDefined();
    expect(bodiesTo(fetchMock, `/records/${bell.id}/visuals`, 'POST')).toEqual([{}]);

    const image = await within(card).findByRole('img', { name: 'Harbour Bell, prop visual' });
    expect(image.getAttribute('src')).toMatch(/\/api\/campaigns\/.+\/assets\/.+\/image$/);
    expect(within(card).getByText('Cost $0.06')).toBeDefined();
    expect(within(card).getByText(/background is removed later/)).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Generate another' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('asks whether an NPC is a humanoid or a monster, and sends the choice', async () => {
    const gnarl = record({ type: 'npc', name: 'Old Gnarl' });
    const { coast, fetchMock } = world([gnarl]);
    renderAt(recordPath(coast, gnarl));

    const card = await visualCard();
    fireEvent.click(within(card).getByRole('button', { name: 'Generate visual' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Is Old Gnarl a humanoid or a monster?',
    });
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: /Humanoid/ }).checked).toBe(
      true,
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: /Monster/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await within(card).findByRole('img', { name: 'Old Gnarl, monster visual' });
    expect(bodiesTo(fetchMock, `/records/${gnarl.id}/visuals`, 'POST')).toEqual([
      { kind: 'monster' },
    ]);

    // The next try starts on the last choice.
    fireEvent.click(within(card).getByRole('button', { name: 'Generate another' }));
    const again = await screen.findByRole('dialog');
    expect(within(again).getByRole<HTMLInputElement>('radio', { name: /Monster/ }).checked).toBe(
      true,
    );
    fireEvent.click(within(again).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(bodiesTo(fetchMock, `/records/${gnarl.id}/visuals`, 'POST')).toHaveLength(1);
  });

  it("draws a PC as a humanoid in one click, between the sheet's Identity and Traits", async () => {
    const { coast, pc, fetchMock } = world([]);
    renderAt(`/campaigns/${coast.id}/characters/${pc.id}`);

    const card = await visualCard();
    const identity = screen.getByRole('heading', { name: 'Identity' });
    const traits = screen.getByRole('heading', { name: 'Traits' });
    const follows = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(identity, card)).toBe(true);
    expect(follows(card, traits)).toBe(true);

    fireEvent.click(within(card).getByRole('button', { name: 'Generate visual' }));
    await within(card).findByRole('img', { name: 'Wren, humanoid visual' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bodiesTo(fetchMock, `/characters/${pc.id}/visuals`, 'POST')).toEqual([{}]);
  });

  it('shows the card only on NPCs, Props, Items and Spots', async () => {
    const lore = record({ type: 'lore', name: 'The Drowning' });
    const lantern = record({ type: 'item', name: 'Green Lantern' });
    const { coast } = world([lore, lantern]);
    const { unmount } = renderAt(recordPath(coast, lore));
    await screen.findByRole('generic', { name: 'Backlinks' });
    expect(screen.queryByRole('region', { name: 'Visual' })).toBeNull();
    unmount();

    renderAt(recordPath(coast, lantern));
    expect(await visualCard()).toBeDefined();
  });

  it("says why a try failed, in the server's words", async () => {
    const cursed = record({ type: 'spot', name: `${FAIL_VISUAL_WORD} Crypt` });
    const { coast } = world([cursed]);
    renderAt(recordPath(coast, cursed));

    const card = await visualCard();
    fireEvent.click(within(card).getByRole('button', { name: 'Generate visual' }));
    expect(await within(card).findByText(/OpenRouter refused this request/)).toBeDefined();
  });

  it('sends a GM without an OpenRouter key to Settings', async () => {
    const bell = record({ type: 'prop', name: 'Unpaid Bell' });
    const { coast } = world([bell], { credentials: [] });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    expect(await within(card).findByText(/Add your OpenRouter key in Settings/)).toBeDefined();
    expect(within(card).getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe(
      '/settings',
    );
    expect(within(card).queryByRole('button', { name: 'Generate visual' })).toBeNull();
    expect(NO_OPENROUTER_KEY_MESSAGE).toContain('Settings');
  });

  it('uses a chosen try, and lets earlier tries be picked', async () => {
    const bell = record({ type: 'prop', name: 'Chosen Bell' });
    const older = assetSummary({ createdAt: '2026-11-13T08:00:00.000Z' });
    const newer = assetSummary({ createdAt: '2026-11-13T09:00:00.000Z' });
    const { coast, fetchMock } = world([bell], { visuals: { [bell.id]: [newer, older] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    const tries = await within(card).findByRole('list', { name: 'Tries' });
    expect(within(tries).getByRole('button', { name: 'Try 2' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(tries).getByRole('button', { name: 'Try 1' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Use this one' }));

    expect(await within(card).findByText('In use')).toBeDefined();
    expect(within(tries).getByRole('button', { name: 'Try 1, in use' })).toBeDefined();
    expect(within(card).queryByRole('button', { name: 'Use this one' })).toBeNull();
    expect(bodiesTo(fetchMock, `/records/${bell.id}/visual`, 'PUT')).toEqual([
      { assetId: older.id },
    ]);
  });

  it('only shows the tries on an archived campaign', async () => {
    const bell = record({ type: 'prop', name: 'Shelved Bell' });
    const { coast } = world(
      [bell],
      { visuals: { [bell.id]: [assetSummary()] } },
      { archivedAt: '2026-11-13T10:00:00.000Z' },
    );
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    await within(card).findByRole('img', { name: 'Shelved Bell, prop visual' });
    expect(within(card).queryByRole('button', { name: 'Use this one' })).toBeNull();
    expect(within(card).queryByRole('button', { name: /Generate/ })).toBeNull();
  });
});
