import type { Campaign, ImportDetail } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { importPolling } from '@/lib/queries';
import {
  campaign,
  currentUrl,
  MIRA,
  mockApi,
  record,
  renderAt,
  type FakeWorld,
} from '@/test/app-harness';
import {
  BUSY_WORD,
  createProposal,
  FAIL_WORD,
  importDetail,
  IMPORT_RUNNING_MESSAGE,
  linkProposal,
  NO_KEY_MESSAGE,
  NOTHING_ACCEPTED_MESSAGE,
  proposedRefs,
  refsOf,
  updateProposal,
} from '@/test/imports-world';

type FetchMock = ReturnType<typeof mockApi>;

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const KEY = {
  provider: 'anthropic',
  lastFour: 'abcd',
  createdAt: '2026-11-01T09:00:00.000Z',
} as const;

/** The parsed JSON bodies of every request to a URL ending in `suffix` with `method`. */
function bodiesTo(fetchMock: FetchMock, suffix: string, method: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => urlOf(input).endsWith(suffix) && init?.method === method)
    .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));
}

async function confirm(label: string) {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
}

const card = (name: string) => screen.getByRole('article', { name });
const findCard = (name: string) => screen.findByRole('article', { name });

/** A campaign with an Area, an NPC (revealed to players) and a Faction. */
function world(extra: FakeWorld = {}, overrides: Partial<Campaign> = {}) {
  const coast = campaign({ name: 'Shattered Coast', ...overrides });
  const harbor = record({ type: 'area', name: 'Harbor District' });
  const vex = record({
    type: 'npc',
    name: 'Captain Vex',
    revealedAt: '2026-11-10T10:00:00.000Z',
    fields: { appearance: 'Tall, salt-stained coat', status: 'alive' },
  });
  const fleet = record({ type: 'faction', name: 'Iron Fleet' });
  const records = [vex, harbor, fleet];
  const fetchMock = mockApi(MIRA, [coast], {
    credentials: [KEY],
    campaignData: { [coast.id]: { records } },
    ...extra,
  });
  return { coast, harbor, vex, fleet, records, fetchMock };
}

const importUrl = (c: Campaign) => `/campaigns/${c.id}/import`;
const reviewUrl = (c: Campaign, detail: ImportDetail) => `/campaigns/${c.id}/imports/${detail.id}`;

beforeAll(() => {
  importPolling.intervalMs = 20;
});
afterAll(() => {
  importPolling.intervalMs = 2000;
});

describe('Starting an AI import', () => {
  it('is reached from the campaign, records and record pages', async () => {
    const { coast, vex } = world();
    renderAt(`/campaigns/${coast.id}`);
    fireEvent.click(await screen.findByRole('link', { name: 'Open AI import' }));
    expect(await screen.findByRole('heading', { name: 'AI import' })).toBeDefined();
    expect(currentUrl()).toBe(importUrl(coast));

    renderAt(`/campaigns/${coast.id}/records`);
    expect(
      (await screen.findAllByRole('link', { name: 'AI import' })).at(-1)?.getAttribute('href'),
    ).toBe(importUrl(coast));

    renderAt(`/campaigns/${coast.id}/records/${vex.id}`);
    expect(
      (await screen.findByRole('link', { name: 'Fill in with AI' })).getAttribute('href'),
    ).toBe(`${importUrl(coast)}?mode=fill&record=${vex.id}`);
  });

  it('asks for an Anthropic key first when there is none', async () => {
    const { coast } = world({ credentials: [] });
    renderAt(importUrl(coast));

    expect(await screen.findByText('Add your Anthropic API key first')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe(
      '/settings',
    );
    expect(screen.queryByRole('button', { name: /Send to Claude/ })).toBeNull();
  });

  it('offers starting a campaign only while it has no records', async () => {
    const empty = campaign({ name: 'Blank Slate' });
    mockApi(MIRA, [empty], { credentials: [KEY] });
    renderAt(importUrl(empty));
    const bootstrap = await screen.findByRole<HTMLInputElement>('radio', {
      name: /Start a campaign/,
    });
    expect(bootstrap.checked).toBe(true);
    expect(screen.queryByRole('radio', { name: /Fill in a record/ })).toBeNull();
  });

  it('offers adding and filling in once the campaign has records', async () => {
    const { coast } = world();
    renderAt(importUrl(coast));
    const add = await screen.findByRole<HTMLInputElement>('radio', { name: /Add to campaign/ });
    expect(add.checked).toBe(true);
    expect(screen.getByRole('radio', { name: /Fill in a record/ })).toBeDefined();
    expect(screen.queryByRole('radio', { name: /Start a campaign/ })).toBeNull();
  });

  it('checks the cost only when asked, and forgets it when the notes change', async () => {
    const { coast, fetchMock } = world();
    renderAt(importUrl(coast));
    const notes = await screen.findByLabelText('Your notes');
    fireEvent.change(notes, { target: { value: 'Old Mags runs the tavern.' } });
    expect(bodiesTo(fetchMock, '/imports/estimate', 'POST')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Check cost' }));
    expect(await screen.findByText(/About \$0\.04, at most \$1\.29\./)).toBeDefined();
    expect(bodiesTo(fetchMock, '/imports/estimate', 'POST')).toEqual([
      { mode: 'add', text: 'Old Mags runs the tavern.' },
    ]);
    expect(bodiesTo(fetchMock, '/imports', 'POST')).toHaveLength(0);

    fireEvent.change(notes, { target: { value: 'Old Mags runs the tavern. She is a spy.' } });
    expect(screen.queryByText(/About \$0\.04/)).toBeNull();
  });

  it('refuses empty notes before sending anything', async () => {
    const { coast, fetchMock } = world();
    renderAt(importUrl(coast));
    fireEvent.click(await screen.findByRole('button', { name: /Send to Claude/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Write some notes to import');
    expect(bodiesTo(fetchMock, '/imports', 'POST')).toHaveLength(0);
  });

  it("shows the server's refusal, with a link to Settings for key problems", async () => {
    const { coast } = world();
    renderAt(importUrl(coast));
    fireEvent.change(await screen.findByLabelText('Your notes'), {
      target: { value: `Still ${BUSY_WORD} with the last one` },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send to Claude/ }));
    expect((await screen.findByRole('alert')).textContent).toContain(IMPORT_RUNNING_MESSAGE);
    expect(screen.queryByRole('link', { name: 'Open Settings' })).toBeNull();
  });

  it('links to Settings when the server has no key to use', async () => {
    const { coast, fetchMock } = world();
    renderAt(importUrl(coast));
    await screen.findByLabelText('Your notes');
    // The key was removed in another tab after the page loaded.
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input, init) =>
      urlOf(input).endsWith('/imports') && init?.method === 'POST'
        ? Promise.resolve(
            Response.json({ statusCode: 409, message: NO_KEY_MESSAGE }, { status: 409 }),
          )
        : (original?.(input, init) ?? Promise.reject(new Error('not mocked'))),
    );
    fireEvent.change(screen.getByLabelText('Your notes'), { target: { value: 'Notes' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to Claude/ }));
    expect((await screen.findByRole('alert')).textContent).toContain(NO_KEY_MESSAGE);
    expect(screen.getByRole('link', { name: 'Open Settings' })).toBeDefined();
  });

  it('fills in a record from its page', async () => {
    const { coast, vex, fetchMock } = world();
    renderAt(`/campaigns/${coast.id}/records/${vex.id}`);
    fireEvent.click(await screen.findByRole('link', { name: 'Fill in with AI' }));

    const fill = await screen.findByRole<HTMLInputElement>('radio', { name: /Fill in a record/ });
    expect(fill.checked).toBe(true);
    expect(screen.getByText('Captain Vex')).toBeDefined();
    expect(screen.queryByRole('group', { name: 'Only create' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Send to Claude/ }));

    await waitFor(() => {
      expect(currentUrl()).toMatch(/\/imports\/[0-9a-f-]+$/);
    });
    expect(bodiesTo(fetchMock, '/imports', 'POST')).toEqual([
      { mode: 'fill', text: '', recordId: vex.id },
    ]);
  });

  it('sends the type filter', async () => {
    const { coast, fetchMock } = world();
    renderAt(importUrl(coast));
    fireEvent.change(await screen.findByLabelText('Your notes'), {
      target: { value: 'Three new villains.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'NPCs' }));
    fireEvent.click(screen.getByRole('button', { name: /Send to Claude/ }));
    await waitFor(() => {
      expect(bodiesTo(fetchMock, '/imports', 'POST')).toEqual([
        { mode: 'add', text: 'Three new villains.', targetTypes: ['npc'] },
      ]);
    });
  });

  it('lists past imports with their cost', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const past = importDetail(coast.id, {
      status: 'committed',
      textPreview: 'The smugglers of the north pier',
      estimatedCostUsd: 0.12,
      proposals: [createProposal({ type: 'npc', name: 'Old Mags' })],
    });
    mockApi(MIRA, [coast], { credentials: [KEY], imports: { [coast.id]: [past] } });
    renderAt(importUrl(coast));

    expect(await screen.findByText('The smugglers of the north pier')).toBeDefined();
    expect(screen.getByText(/1 new · 7,000 tokens · \$0\.12/)).toBeDefined();
    expect(screen.getByText('Saved')).toBeDefined();
  });

  it('shows players only the players note', async () => {
    const coast = campaign({ name: 'Shattered Coast', role: 'player' });
    mockApi(MIRA, [coast]);
    renderAt(importUrl(coast));
    expect(await screen.findByText(/Records are the GM's workshop/)).toBeDefined();
    expect(screen.queryByLabelText('Your notes')).toBeNull();
  });
});

describe('Waiting for and reviewing an import', () => {
  it('waits for Claude, then shows the questions and the proposals grouped by kind', async () => {
    const { coast, vex, harbor } = world({
      importResult: () => {
        const npc = createProposal({ type: 'npc', name: 'Old Mags' }, { position: 0 });
        const area = createProposal({ type: 'area', name: 'North Pier' }, { position: 1 });
        const spot = createProposal(
          {
            type: 'spot',
            name: 'Smugglers Den',
            parentId: area.action === 'create' ? area.payload.id : null,
          },
          { position: 2 },
        );
        const proposals = [
          npc,
          area,
          spot,
          updateProposal(vex, { fields: { appearance: 'Missing an eye' } }, { position: 3 }),
          linkProposal(
            {
              fromId: vex.id,
              fromType: 'npc',
              toId: harbor.id,
              fieldKey: null,
              label: 'patrols',
            },
            { position: 4 },
          ),
        ];
        return {
          proposals,
          refs: { ...proposedRefs(proposals), ...refsOf([vex, harbor]) },
          questions: ['Is Old Mags related to Captain Vex?'],
        };
      },
    });
    renderAt(importUrl(coast));
    fireEvent.change(await screen.findByLabelText('Your notes'), {
      target: { value: 'Old Mags hides in a den on the north pier.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send to Claude/ }));

    expect(await screen.findByText('Claude is reading your notes…')).toBeDefined();
    expect(currentUrl()).toMatch(new RegExp(`/campaigns/${coast.id}/imports/`));

    expect(await screen.findByText('Is Old Mags related to Captain Vex?')).toBeDefined();
    const created = screen.getByRole('region', { name: 'New records' });
    expect(
      within(created)
        .getAllByRole('article')
        .map((article) => article.getAttribute('aria-label')),
    ).toEqual(['New Area: North Pier', 'New Spot: Smugglers Den', 'New NPC: Old Mags']);
    expect(within(card('New Spot: Smugglers Den')).getByText('North Pier')).toBeDefined();
    expect(
      within(screen.getByRole('region', { name: 'Changes to existing records' })).getByRole(
        'article',
        { name: 'Change to NPC: Captain Vex' },
      ),
    ).toBeDefined();
    expect(
      within(screen.getByRole('region', { name: 'Links' })).getByText(/patrols →/),
    ).toBeDefined();
    expect(screen.getByText('0 accepted · 0 rejected · 5 pending')).toBeDefined();
  });

  it('accepts, rejects and undoes a proposal', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const detail = importDetail(coast.id, {
      proposals: [createProposal({ type: 'npc', name: 'Old Mags' })],
    });
    detail.refs = proposedRefs(detail.proposals);
    mockApi(MIRA, [coast], { credentials: [KEY], imports: { [coast.id]: [detail] } });
    renderAt(reviewUrl(coast, detail));

    const mags = await findCard('New NPC: Old Mags');
    fireEvent.click(within(mags).getByRole('button', { name: 'Accept' }));
    expect(await within(mags).findByText('Accepted')).toBeDefined();
    expect(screen.getByText('1 accepted · 0 rejected · 0 pending')).toBeDefined();

    fireEvent.click(within(mags).getByRole('button', { name: 'Reject' }));
    expect(await within(mags).findByText('Rejected')).toBeDefined();

    fireEvent.click(within(mags).getByRole('button', { name: 'Undo' }));
    expect(await within(mags).findByText('Pending')).toBeDefined();
  });

  it('edits a new record, saves it as accepted, then restores the original', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const fleet = record({ type: 'faction', name: 'Iron Fleet' });
    const mags = createProposal({
      type: 'npc',
      name: 'Old Mags',
      tags: ['smuggler'],
      fields: { appearance: 'Grey braids' },
      links: { factions: [fleet.id] },
    });
    const detail = importDetail(coast.id, {
      proposals: [mags],
      refs: { ...proposedRefs([mags]), ...refsOf([fleet]) },
    });
    const fetchMock = mockApi(MIRA, [coast], {
      credentials: [KEY],
      campaignData: { [coast.id]: { records: [fleet] } },
      imports: { [coast.id]: [detail] },
    });
    renderAt(reviewUrl(coast, detail));

    const view = await findCard('New NPC: Old Mags');
    expect(within(view).getByText('Grey braids')).toBeDefined();
    expect(within(view).getByRole('link', { name: 'Iron Fleet' })).toBeDefined();
    fireEvent.click(within(view).getByRole('button', { name: 'Edit' }));

    fireEvent.change(within(view).getByLabelText('Name'), { target: { value: 'Mother Mags' } });
    fireEvent.change(within(view).getByLabelText('Appearance'), {
      target: { value: 'Grey braids, one gold tooth' },
    });
    fireEvent.click(within(view).getByRole('button', { name: 'Remove Iron Fleet' }));
    fireEvent.click(within(view).getByRole('button', { name: 'Save and accept' }));

    const edited = await findCard('New NPC: Mother Mags');
    expect(within(edited).getByText('Edited')).toBeDefined();
    expect(within(edited).getByText('Grey braids, one gold tooth')).toBeDefined();
    expect(within(edited).queryByText('Iron Fleet')).toBeNull();
    const [body] = bodiesTo(fetchMock, `/proposals/${mags.id}`, 'PATCH') as {
      reviewState: string;
      payload: { name: string; links: Record<string, string[]>; fields: object };
    }[];
    expect(body?.reviewState).toBe('accepted');
    expect(body?.payload.name).toBe('Mother Mags');
    expect(body?.payload.links).toEqual({ factions: [] });
    expect(body?.payload.fields).toEqual({ appearance: 'Grey braids, one gold tooth' });

    fireEvent.click(within(edited).getByRole('button', { name: 'Restore original' }));
    const restored = await findCard('New NPC: Old Mags');
    expect(within(restored).getByText('Accepted')).toBeDefined();
    expect(within(restored).queryByRole('button', { name: 'Restore original' })).toBeNull();
  });

  it('cancels an edit without sending it', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const detail = importDetail(coast.id, {
      proposals: [createProposal({ type: 'npc', name: 'Old Mags' })],
    });
    detail.refs = proposedRefs(detail.proposals);
    const fetchMock = mockApi(MIRA, [coast], {
      credentials: [KEY],
      imports: { [coast.id]: [detail] },
    });
    renderAt(reviewUrl(coast, detail));

    const view = await findCard('New NPC: Old Mags');
    fireEvent.click(within(view).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(view).getByLabelText('Name'), { target: { value: '' } });
    fireEvent.click(within(view).getByRole('button', { name: 'Save and accept' }));
    expect(within(view).getByRole('alert').textContent).toMatch(/name/i);
    fireEvent.click(within(view).getByRole('button', { name: 'Cancel' }));
    expect(within(card('New NPC: Old Mags')).getByText('Pending')).toBeDefined();
    expect(bodiesTo(fetchMock, '/proposals/', 'PATCH')).toHaveLength(0);
  });

  it('shows a change as a diff against the record, and can drop part of it', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const vex = record({
      type: 'npc',
      name: 'Captain Vex',
      revealedAt: '2026-11-10T10:00:00.000Z',
      tags: ['captain'],
      fields: { appearance: 'Tall, salt-stained coat', status: 'alive' },
    });
    const change = updateProposal(vex, {
      fields: { appearance: 'Missing an eye', status: 'missing' },
      addTags: ['wanted'],
    });
    const detail = importDetail(coast.id, { proposals: [change], refs: refsOf([vex]) });
    const fetchMock = mockApi(MIRA, [coast], {
      credentials: [KEY],
      campaignData: { [coast.id]: { records: [vex] } },
      imports: { [coast.id]: [detail] },
    });
    renderAt(reviewUrl(coast, detail));

    const view = await findCard('Change to NPC: Captain Vex');
    expect(within(view).getByText('Revealed to players')).toBeDefined();
    expect(within(view).getByText('Tall, salt-stained coat')).toBeDefined();
    expect(within(view).getByText('Missing an eye')).toBeDefined();
    expect(within(view).getByText('Alive')).toBeDefined();
    expect(within(view).getByText('Missing')).toBeDefined();
    expect(within(view).getByText('wanted')).toBeDefined();

    fireEvent.click(within(view).getByRole('button', { name: 'Edit' }));
    const status = within(view).getByText('Status').closest('div.rounded-md');
    expect(status).not.toBeNull();
    fireEvent.click(
      within(status as HTMLElement).getByRole('button', { name: 'Drop this change' }),
    );
    fireEvent.click(within(view).getByRole('button', { name: 'Save and accept' }));

    await waitFor(() => {
      expect(within(card('Change to NPC: Captain Vex')).getByText('Edited')).toBeDefined();
    });
    const [body] = bodiesTo(fetchMock, `/proposals/${change.id}`, 'PATCH') as {
      payload: { fields: object; addTags: string[] };
    }[];
    expect(body?.payload.fields).toEqual({ appearance: 'Missing an eye' });
    expect(body?.payload.addTags).toEqual(['wanted']);
  });

  it('says when the record of a change was deleted', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const gone = record({ type: 'npc', name: 'Captain Vex' });
    const detail = importDetail(coast.id, {
      proposals: [updateProposal(gone, { name: 'Admiral Vex' }, { before: null })],
    });
    mockApi(MIRA, [coast], { credentials: [KEY], imports: { [coast.id]: [detail] } });
    renderAt(reviewUrl(coast, detail));

    expect(
      await screen.findByText(/This record was deleted after Claude proposed the change/),
    ).toBeDefined();
  });

  it('shows a link with the field it fills and the record it replaces', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const vex = record({ type: 'npc', name: 'Captain Vex' });
    const den = record({ type: 'spot', name: 'Smugglers Den' });
    const pier = record({ type: 'spot', name: 'North Pier' });
    const detail = importDetail(coast.id, {
      proposals: [
        linkProposal(
          { fromId: vex.id, fromType: 'npc', toId: den.id, fieldKey: 'homeSpot', label: null },
          { replaces: { id: pier.id, type: 'spot', name: 'North Pier' } },
        ),
      ],
      refs: refsOf([vex, den]),
    });
    mockApi(MIRA, [coast], { credentials: [KEY], imports: { [coast.id]: [detail] } });
    renderAt(reviewUrl(coast, detail));

    const view = await findCard('Link: Captain Vex → Smugglers Den');
    expect(within(view).getByText('Home spot →')).toBeDefined();
    expect(within(view).getByText(/Replaces/).textContent).toContain('North Pier');
    // A link field's link can be accepted or rejected, not edited.
    expect(within(view).queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('flags a possible duplicate with a link to the existing record', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const vex = record({ type: 'npc', name: 'Captain Vex' });
    const detail = importDetail(coast.id, {
      proposals: [
        createProposal(
          { type: 'npc', name: 'Capt. Vex' },
          { possibleDuplicates: [{ id: vex.id, type: 'npc', name: 'Captain Vex' }] },
        ),
      ],
    });
    detail.refs = proposedRefs(detail.proposals);
    mockApi(MIRA, [coast], { credentials: [KEY], imports: { [coast.id]: [detail] } });
    renderAt(reviewUrl(coast, detail));

    const view = await findCard('New NPC: Capt. Vex');
    expect(within(view).getByRole('note').textContent).toContain('Possible duplicate of');
    expect(within(view).getByRole('link', { name: 'Captain Vex' }).getAttribute('href')).toBe(
      `/campaigns/${coast.id}/records/${vex.id}`,
    );
  });
});

describe('Saving or dropping an import', () => {
  function readyImport() {
    const coast = campaign({ name: 'Shattered Coast' });
    const proposals = [
      createProposal({ type: 'npc', name: 'Old Mags' }, { position: 0 }),
      createProposal({ type: 'lore', name: 'The Drowned Bell' }, { position: 1 }),
    ];
    const detail = importDetail(coast.id, { proposals, refs: proposedRefs(proposals) });
    const fetchMock = mockApi(MIRA, [coast], {
      credentials: [KEY],
      imports: { [coast.id]: [detail] },
    });
    return { coast, detail, fetchMock };
  }

  it('warns about pending proposals, saves the accepted ones and lists them', async () => {
    const { coast, detail } = readyImport();
    renderAt(reviewUrl(coast, detail));

    const mags = await findCard('New NPC: Old Mags');
    fireEvent.click(within(mags).getByRole('button', { name: 'Accept' }));
    await within(mags).findByText('Accepted');
    fireEvent.click(screen.getByRole('button', { name: 'Save accepted' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain("1 proposal is still pending and won't be saved");
    await confirm('Save accepted');

    const saved = await screen.findByRole('status', { name: 'Saved' });
    expect(within(saved).getByText('Created 1 record')).toBeDefined();
    const link = within(saved).getByRole('link', { name: 'Old Mags' });
    expect(screen.queryByRole('button', { name: 'Save accepted' })).toBeNull();

    fireEvent.click(link);
    expect(await screen.findByDisplayValue('Old Mags')).toBeDefined();
    renderAt(`/campaigns/${coast.id}/records`);
    expect(await screen.findByRole('link', { name: /Old Mags/ })).toBeDefined();
    expect(screen.queryByRole('link', { name: /The Drowned Bell/ })).toBeNull();
  });

  it('accepts all, then saves without asking', async () => {
    const { coast, detail, fetchMock } = readyImport();
    renderAt(reviewUrl(coast, detail));

    await findCard('New NPC: Old Mags');
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(await screen.findByText('2 accepted · 0 rejected · 0 pending')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Save accepted' }));

    expect(await screen.findByText('Created 2 records')).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(bodiesTo(fetchMock, '/commit', 'POST')).toHaveLength(1);
  });

  it("shows the server's reason when nothing can be saved", async () => {
    const { coast, detail } = readyImport();
    renderAt(reviewUrl(coast, detail));

    await findCard('New NPC: Old Mags');
    fireEvent.click(screen.getByRole('button', { name: 'Save accepted' }));
    await confirm('Save accepted');
    expect(
      await within(await screen.findByRole('alertdialog')).findByText(NOTHING_ACCEPTED_MESSAGE),
    ).toBeDefined();
  });

  it('discards an import', async () => {
    const { coast, detail } = readyImport();
    renderAt(reviewUrl(coast, detail));

    await findCard('New NPC: Old Mags');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await confirm('Discard');
    expect(
      await screen.findByText(/Discarded\. Nothing from this import was saved\./),
    ).toBeDefined();
    expect(within(card('New NPC: Old Mags')).queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('shows why an import failed and tries again with the notes kept', async () => {
    const { coast } = world();
    renderAt(importUrl(coast));
    const notes = `The ${FAIL_WORD} chronicles of the Iron Fleet.`;
    fireEvent.change(await screen.findByLabelText('Your notes'), { target: { value: notes } });
    fireEvent.click(screen.getByRole('button', { name: /Send to Claude/ }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      "Claude's answer didn't fit the record shapes",
    );
    expect(screen.getByText('creates.0.fields.status: Invalid option')).toBeDefined();
    fireEvent.click(screen.getByRole('link', { name: 'Try again' }));

    expect(await screen.findByDisplayValue(notes)).toBeDefined();
    expect(currentUrl()).toMatch(/\/import\?from=/);
  });
});

describe('AI usage in Settings', () => {
  it('shows totals and each import', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    mockApi(MIRA, [coast], {
      credentials: [KEY],
      imports: {
        [coast.id]: [
          importDetail(coast.id, { estimatedCostUsd: 0.25 }),
          importDetail(coast.id, { mode: 'bootstrap', status: 'committed', estimatedCostUsd: 0.5 }),
        ],
      },
    });
    renderAt('/settings');

    expect(await screen.findByRole('heading', { name: 'AI import usage' })).toBeDefined();
    expect(await screen.findByText('$0.75')).toBeDefined();
    expect(screen.getByText('10,000')).toBeDefined();
    expect(screen.getAllByText(/Shattered Coast/)).toHaveLength(2);
  });

  it('says when there are no imports yet', async () => {
    mockApi(MIRA, [], { credentials: [KEY] });
    renderAt('/settings');
    expect(await screen.findByText('No imports yet.')).toBeDefined();
  });
});
