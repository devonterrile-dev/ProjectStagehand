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
import {
  assetSummary,
  COMPARE_FIRST_MESSAGE,
  FAIL_VISUAL_WORD,
  NO_OPENROUTER_KEY_MESSAGE,
  UNPROCESSED_VISUAL_WORD,
} from '@/test/visuals-world';

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

  it('makes a prop image in one click, then shows it with its cost for review', async () => {
    const bell = record({ type: 'prop', name: 'Harbour Bell' });
    const { coast, fetchMock } = world([bell]);
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    expect(await within(card).findByText(/No visual yet/)).toBeDefined();
    expect(within(card).getByText(/About \$0\.07 an image/)).toBeDefined();
    fireEvent.click(await within(card).findByRole('button', { name: 'Generate visual' }));

    expect(await within(card).findByText('Making the image…')).toBeDefined();
    expect(bodiesTo(fetchMock, `/records/${bell.id}/visuals`, 'POST')).toEqual([{}]);

    // The stage version, with its post-processing version in the URL (F2.4).
    const image = await within(card).findByRole('img', { name: 'Harbour Bell, prop visual' });
    expect(image.getAttribute('src')).toMatch(/\/api\/campaigns\/.+\/assets\/.+\/image\?p=1$/);
    expect(within(card).getByText('Cost $0.06')).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Use this' })).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Discard' })).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Regenerate with notes' })).toBeDefined();
    // A new draft must be used or discarded before another is made.
    expect(within(card).queryByRole('button', { name: /Generate/ })).toBeNull();
  });

  it('switches between the stage version and the original', async () => {
    const bell = record({ type: 'prop', name: 'Harbour Bell' });
    const { coast } = world([bell], { visuals: { [bell.id]: [assetSummary({ kind: 'prop' })] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    await within(card).findByRole('img', { name: 'Harbour Bell, prop visual' });
    fireEvent.click(within(card).getByRole('button', { name: 'Show the original' }));

    const original = await within(card).findByRole('img', {
      name: 'Harbour Bell, prop visual, original',
    });
    expect(original.getAttribute('src')).toMatch(/\/image\?v=original$/);
    fireEvent.click(within(card).getByRole('button', { name: 'Show the stage version' }));
    expect(
      (await within(card).findByRole('img', { name: 'Harbour Bell, prop visual' })).getAttribute(
        'src',
      ),
    ).toMatch(/\/image\?p=1$/);
  });

  it('has no original switch on a backdrop: its stage version is the same picture', async () => {
    const area = record({ type: 'area', name: 'Saltreach' });
    const dock = record({ type: 'spot', name: 'Fish Market', parentId: area.id });
    const { coast } = world([area, dock], {
      visuals: { [dock.id]: [assetSummary({ kind: 'backdrop' })] },
    });
    renderAt(recordPath(coast, dock));

    const card = await visualCard();
    await within(card).findByRole('img', { name: 'Fish Market, backdrop visual' });
    expect(within(card).queryByRole('button', { name: 'Show the original' })).toBeNull();
  });

  it('opens an image large when it is clicked, and closes again', async () => {
    const bell = record({ type: 'prop', name: 'Harbour Bell' });
    const asset = assetSummary({ kind: 'prop', revisionNotes: 'bigger clapper' });
    const { coast } = world([bell], { visuals: { [bell.id]: [asset] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    fireEvent.click(
      await within(card).findByRole('button', { name: 'Enlarge Harbour Bell, prop visual' }),
    );
    const viewer = await screen.findByRole('dialog', { name: 'Harbour Bell' });
    const large = within(viewer).getByRole('img', { name: 'Harbour Bell, prop visual' });
    expect(large.getAttribute('src')).toContain(asset.id);
    expect(within(viewer).getByText('Notes: bigger clapper')).toBeDefined();
    expect(within(viewer).queryByRole('group', { name: 'Compare' })).toBeNull();

    fireEvent.click(within(viewer).getByRole('button', { name: 'Show the original' }));
    expect(
      within(viewer)
        .getByRole('img', { name: 'Harbour Bell, prop visual, original' })
        .getAttribute('src'),
    ).toMatch(/\?v=original$/);

    fireEvent.click(within(viewer).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('flips between the two images of a pair in the large view', async () => {
    const current = assetSummary({ status: 'approved', createdAt: '2026-11-13T08:00:00.000Z' });
    const draft = assetSummary({ createdAt: '2026-11-13T09:00:00.000Z' });
    const bell = record({ type: 'prop', name: 'Two Bells', visualAssetId: current.id });
    const { coast } = world([bell], { visuals: { [bell.id]: [current, draft] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    fireEvent.click(
      await within(card).findByRole('button', { name: 'Enlarge Two Bells, prop visual, new' }),
    );
    const viewer = await screen.findByRole('dialog', { name: 'Two Bells, New' });
    const compare = within(viewer).getByRole('group', { name: 'Compare' });
    expect(within(compare).getByRole('button', { name: 'New' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(within(viewer).getByRole('img').getAttribute('src')).toContain(draft.id);

    fireEvent.click(within(compare).getByRole('button', { name: 'Current' }));
    expect(
      within(await screen.findByRole('dialog', { name: 'Two Bells, Current' }))
        .getByRole('img', { name: 'Two Bells, prop visual, current' })
        .getAttribute('src'),
    ).toContain(current.id);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    expect(
      within(await screen.findByRole('dialog', { name: 'Two Bells, New' }))
        .getByRole('img')
        .getAttribute('src'),
    ).toContain(draft.id);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
    expect(await screen.findByRole('dialog', { name: 'Two Bells, Current' })).toBeDefined();
  });

  it('says when an image is not ready for the stage yet, and shows the original', async () => {
    const lamp = record({ type: 'item', name: `${UNPROCESSED_VISUAL_WORD} Lamp` });
    const { coast } = world([lamp]);
    renderAt(recordPath(coast, lamp));

    const card = await visualCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'Generate visual' }));

    const image = await within(card).findByRole('img', { name: 'Raw Lamp, prop visual' });
    expect(image.getAttribute('src')).toMatch(/\/image$/);
    expect(within(card).getByText(/Not ready for the stage yet/)).toBeDefined();
    expect(within(card).queryByRole('button', { name: 'Show the original' })).toBeNull();
  });

  it('asks whether an NPC is a humanoid or a monster, and sends the choice', async () => {
    const gnarl = record({ type: 'npc', name: 'Old Gnarl' });
    const { coast, fetchMock } = world([gnarl]);
    renderAt(recordPath(coast, gnarl));

    const card = await visualCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'Generate visual' }));
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

    // Once it's discarded, the next try starts on the last choice.
    fireEvent.click(within(card).getByRole('button', { name: 'Discard' }));
    fireEvent.click(await within(card).findByRole('button', { name: 'Generate visual' }));
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

    fireEvent.click(await within(card).findByRole('button', { name: 'Generate visual' }));
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
    fireEvent.click(await within(card).findByRole('button', { name: 'Generate visual' }));
    expect(await within(card).findByText(/OpenRouter refused this request/)).toBeDefined();
    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));
    expect(await within(card).findByText(/No visual yet/)).toBeDefined();
    expect(within(card).queryByText(/OpenRouter refused this request/)).toBeNull();
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

  it('shows the image in use first, with Regenerate with notes and Generate new', async () => {
    const current = assetSummary({ status: 'approved', createdAt: '2026-11-13T08:00:00.000Z' });
    const bell = record({ type: 'prop', name: 'Chosen Bell', visualAssetId: current.id });
    const { coast } = world([bell], { visuals: { [bell.id]: [current] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    const image = await within(card).findByRole('img', { name: 'Chosen Bell, prop visual' });
    expect(image.getAttribute('src')).toContain(`/assets/${current.id}/image`);
    expect(within(card).getByText('In use')).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Regenerate with notes' })).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Generate new' })).toBeDefined();
    expect(within(card).queryByRole('button', { name: 'Use this' })).toBeNull();
  });

  it('uses a draft: Use this makes it the visual in use', async () => {
    const draft = assetSummary();
    const bell = record({ type: 'prop', name: 'Fresh Bell' });
    const { coast, fetchMock } = world([bell], { visuals: { [bell.id]: [draft] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'Use this' }));
    expect(await within(card).findByText('In use')).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Generate new' })).toBeDefined();
    expect(bodiesTo(fetchMock, `/records/${bell.id}/visual`, 'PUT')).toEqual([
      { assetId: draft.id },
    ]);
  });

  it('shows a new draft beside the image in use: Replace swaps them', async () => {
    const current = assetSummary({ status: 'approved', createdAt: '2026-11-13T08:00:00.000Z' });
    const draft = assetSummary({ createdAt: '2026-11-13T09:00:00.000Z' });
    const bell = record({ type: 'prop', name: 'Two Bells', visualAssetId: current.id });
    const { coast, fetchMock } = world([bell], { visuals: { [bell.id]: [current, draft] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    const before = await within(card).findByRole('img', {
      name: 'Two Bells, prop visual, current',
    });
    expect(before.getAttribute('src')).toContain(current.id);
    const after = within(card).getByRole('img', { name: 'Two Bells, prop visual, new' });
    expect(after.getAttribute('src')).toContain(draft.id);
    expect(within(card).queryByRole('button', { name: 'Generate new' })).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'Replace' }));
    const replaced = await within(card).findByRole('img', { name: 'Two Bells, prop visual' });
    expect(replaced.getAttribute('src')).toContain(draft.id);
    expect(within(card).queryByRole('img', { name: /current/ })).toBeNull();
    expect(bodiesTo(fetchMock, `/records/${bell.id}/visual`, 'PUT')).toEqual([
      { assetId: draft.id },
    ]);
  });

  it('Keep current discards the new draft', async () => {
    const current = assetSummary({ status: 'approved', createdAt: '2026-11-13T08:00:00.000Z' });
    const draft = assetSummary({ createdAt: '2026-11-13T09:00:00.000Z' });
    const bell = record({ type: 'prop', name: 'Kept Bell', visualAssetId: current.id });
    const { coast, fetchMock } = world([bell], { visuals: { [bell.id]: [current, draft] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'Keep current' }));
    const kept = await within(card).findByRole('img', { name: 'Kept Bell, prop visual' });
    expect(kept.getAttribute('src')).toContain(current.id);
    expect(bodiesTo(fetchMock, `/records/${bell.id}/visuals/${draft.id}`, 'DELETE')).toHaveLength(
      1,
    );
  });

  it('Regenerate with notes sends the notes, then Keep new keeps the change', async () => {
    const draft = assetSummary();
    const bell = record({ type: 'prop', name: 'Revised Bell' });
    const { coast, fetchMock } = world([bell], { visuals: { [bell.id]: [draft] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'Regenerate with notes' }));
    const notes = within(card).getByRole('textbox', { name: 'What should change?' });
    const send = within(card).getByRole('button', { name: 'Regenerate' });
    expect(send).toHaveProperty('disabled', true);
    expect(within(card).getByText(/about \$0\.05, on your OpenRouter key/)).toBeDefined();
    fireEvent.change(notes, { target: { value: '  bigger clapper ' } });
    fireEvent.click(send);

    expect(await within(card).findByText('Making the new version…')).toBeDefined();
    expect(bodiesTo(fetchMock, `/visuals/${draft.id}/revise`, 'POST')).toEqual([
      { notes: 'bigger clapper' },
    ]);

    const old = await within(card).findByRole('img', { name: 'Revised Bell, prop visual, before' });
    expect(old.getAttribute('src')).toContain(draft.id);
    expect(
      within(card).getByRole('img', { name: 'Revised Bell, prop visual, after' }),
    ).toBeDefined();
    expect(within(card).getByText('Notes: bigger clapper')).toBeDefined();
    expect(within(card).queryByRole('button', { name: 'Use this' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Regenerate with notes' })).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'Keep new' }));
    expect(await within(card).findByRole('button', { name: 'Use this' })).toBeDefined();
    const kept = within(card).getByRole('img', { name: 'Revised Bell, prop visual' });
    expect(kept.getAttribute('src')).not.toContain(draft.id);
    expect(bodiesTo(fetchMock, `/visuals/${draft.id}`, 'DELETE')).toHaveLength(1);
  });

  it('Go back discards the new version', async () => {
    const base = assetSummary({ createdAt: '2026-11-13T08:00:00.000Z' });
    const change = assetSummary({
      revisedFromId: base.id,
      revisionNotes: 'add a rope',
      createdAt: '2026-11-13T09:00:00.000Z',
    });
    const bell = record({ type: 'prop', name: 'Compared Bell' });
    const { coast, fetchMock } = world([bell], { visuals: { [bell.id]: [base, change] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'Go back' }));
    const back = await within(card).findByRole('img', { name: 'Compared Bell, prop visual' });
    expect(back.getAttribute('src')).toContain(base.id);
    expect(bodiesTo(fetchMock, `/visuals/${change.id}`, 'DELETE')).toHaveLength(1);
    expect(COMPARE_FIRST_MESSAGE).toMatch(/Keep the new version/);
  });

  it('regenerates the image in use, then offers Replace or Keep current', async () => {
    const current = assetSummary({ status: 'approved', createdAt: '2026-11-13T08:00:00.000Z' });
    const bell = record({ type: 'prop', name: 'Retouched Bell', visualAssetId: current.id });
    const { coast, fetchMock } = world([bell], { visuals: { [bell.id]: [current] } });
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'Regenerate with notes' }));
    fireEvent.change(within(card).getByRole('textbox', { name: 'What should change?' }), {
      target: { value: 'shinier' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Regenerate' }));

    expect(
      await within(card).findByRole('img', { name: 'Retouched Bell, prop visual, new' }),
    ).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Replace' })).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Keep current' })).toBeDefined();
    expect(bodiesTo(fetchMock, `/visuals/${current.id}/revise`, 'POST')).toEqual([
      { notes: 'shinier' },
    ]);
  });

  it('only shows the images on an archived campaign', async () => {
    const bell = record({ type: 'prop', name: 'Shelved Bell' });
    const { coast } = world(
      [bell],
      { visuals: { [bell.id]: [assetSummary()] } },
      { archivedAt: '2026-11-13T10:00:00.000Z' },
    );
    renderAt(recordPath(coast, bell));

    const card = await visualCard();
    await within(card).findByRole('img', { name: 'Shelved Bell, prop visual' });
    for (const name of ['Use this', 'Discard', /Generate/, 'Regenerate with notes']) {
      expect(within(card).queryByRole('button', { name })).toBeNull();
    }
  });
});
