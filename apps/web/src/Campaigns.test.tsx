import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { campaign, currentUrl, MIRA, mockApi, renderAt } from '@/test/app-harness';

/** Opens a Radix dropdown menu from the keyboard (jsdom has no real pointer events). */
function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
}

function calledWith(fetchMock: ReturnType<typeof mockApi>, url: string, method: string) {
  return fetchMock.mock.calls.some(
    ([input, init]) => input === url && (init?.method ?? 'GET') === method,
  );
}

describe('Campaign list (home)', () => {
  it('shows active campaigns with roles, and folds archived ones away', async () => {
    mockApi(MIRA, [
      campaign({ name: 'Shattered Coast', role: 'gm' }),
      campaign({ name: 'Iron Vale', role: 'player' }),
      campaign({ name: 'Old One-shot', archivedAt: '2026-11-01T10:00:00.000Z' }),
    ]);
    renderAt('/');

    const active = await screen.findByRole('list', { name: 'Active campaigns' });
    expect(within(active).getByRole('link', { name: /Shattered Coast/ }).textContent).toContain(
      'GM',
    );
    expect(within(active).getByRole('link', { name: /Iron Vale/ }).textContent).toContain('Player');
    expect(within(active).queryByText('Old One-shot')).toBeNull();

    expect(screen.getByText('Archived (1)')).toBeDefined();
    const archived = screen.getByRole('list', { name: 'Archived campaigns', hidden: true });
    expect(within(archived).getByText('Old One-shot')).toBeDefined();
  });

  it('unarchives a campaign back into the active list', async () => {
    const old = campaign({ name: 'Old One-shot', archivedAt: '2026-11-01T10:00:00.000Z' });
    const fetchMock = mockApi(MIRA, [old]);
    renderAt('/');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Unarchive Old One-shot', hidden: true }),
    );

    const active = await screen.findByRole('list', { name: 'Active campaigns' });
    expect(within(active).getByText('Old One-shot')).toBeDefined();
    expect(calledWith(fetchMock, `/api/campaigns/${old.id}/unarchive`, 'POST')).toBe(true);
  });

  it('suggests creating one when there are none', async () => {
    mockApi(MIRA, []);
    renderAt('/');

    expect(await screen.findByText(/No active campaigns yet/)).toBeDefined();
  });

  it('creates a campaign and opens it', async () => {
    const fetchMock = mockApi(MIRA, []);
    renderAt('/');

    fireEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    fireEvent.change(await screen.findByLabelText('Campaign name'), {
      target: { value: '  Shattered Coast  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));

    expect(await screen.findByRole('heading', { name: 'Shattered Coast' })).toBeDefined();
    expect(currentUrl()).toMatch(/^\/campaigns\/[0-9a-f-]{36}$/);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/campaigns',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Shattered Coast' }),
      }),
    );
  });

  it('validates the name before sending', async () => {
    const fetchMock = mockApi(MIRA, []);
    renderAt('/');

    fireEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    fireEvent.change(await screen.findByLabelText('Campaign name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Campaign name cannot be empty',
    );
    expect(calledWith(fetchMock, '/api/campaigns', 'POST')).toBe(false);
  });
});

describe('Campaign page', () => {
  it('renames the campaign from the settings menu', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const fetchMock = mockApi(MIRA, [coast]);
    renderAt(`/campaigns/${coast.id}`);

    expect(await screen.findByRole('heading', { name: 'Shattered Coast' })).toBeDefined();
    openMenu('Campaign settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }));

    const input = await screen.findByLabelText('Campaign name');
    expect(input).toHaveProperty('value', 'Shattered Coast');
    fireEvent.change(input, { target: { value: 'The Shattered Coast' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByRole('heading', { name: 'The Shattered Coast' })).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/campaigns/${coast.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'The Shattered Coast' }),
      }),
    );
  });

  it('archives the campaign, shows it read-only, and unarchives it', async () => {
    const coast = campaign({ name: 'Shattered Coast' });
    const fetchMock = mockApi(MIRA, [coast]);
    renderAt(`/campaigns/${coast.id}`);

    await screen.findByRole('heading', { name: 'Shattered Coast' });
    openMenu('Campaign settings');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));

    expect(await screen.findByText(/archived, so it's read-only/)).toBeDefined();
    expect(calledWith(fetchMock, `/api/campaigns/${coast.id}/archive`, 'POST')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => {
      expect(screen.queryByText(/archived, so it's read-only/)).toBeNull();
    });
  });

  it('hides GM settings from players', async () => {
    const shared = campaign({ name: 'Iron Vale', role: 'player' });
    mockApi(MIRA, [shared]);
    renderAt(`/campaigns/${shared.id}`);

    expect(await screen.findByRole('heading', { name: 'Iron Vale' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Campaign settings' })).toBeNull();
  });

  it("says so when the campaign doesn't exist or isn't yours", async () => {
    mockApi(MIRA, []);
    renderAt('/campaigns/00000000-0000-4000-8000-ffffffffffff');

    expect(await screen.findByRole('heading', { name: 'Campaign not found' })).toBeDefined();
  });

  it('sends signed-out visitors to sign-in', async () => {
    mockApi(null);
    renderAt('/campaigns/00000000-0000-4000-8000-ffffffffffff');

    expect(await screen.findByRole('button', { name: 'Sign in with Discord' })).toBeDefined();
  });
});
