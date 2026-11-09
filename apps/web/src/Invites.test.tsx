import type { InvitePreview } from '@stagehand/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  campaign,
  currentUrl,
  inviteCode,
  member,
  MIRA,
  mockApi,
  renderAt,
  uuid,
} from '@/test/app-harness';

function calledWith(fetchMock: ReturnType<typeof mockApi>, url: string, method: string) {
  return fetchMock.mock.calls.some(
    ([input, init]) => input === url && (init?.method ?? 'GET') === method,
  );
}

/** Clicks the confirm button inside the open "Are you sure?" dialog. */
async function confirm(label: string) {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
}

describe('Joining through an invite link', () => {
  const code = inviteCode('join');
  const preview: InvitePreview = {
    campaignId: uuid(),
    campaignName: 'Shattered Coast',
    gmDisplayName: 'Gamemaster',
    alreadyMember: false,
  };

  it('asks signed-out visitors to sign in first', async () => {
    mockApi(null);
    renderAt(`/join/${code}`);

    expect(
      await screen.findByRole('heading', { name: "You've been invited to a campaign" }),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign in with Discord' })).toBeDefined();
  });

  it('shows the campaign, joins, and opens it', async () => {
    const fetchMock = mockApi(MIRA, [], { invites: { [code]: preview } });
    renderAt(`/join/${code}`);

    expect(await screen.findByRole('heading', { name: 'Shattered Coast' })).toBeDefined();
    expect(screen.getByText('Run by Gamemaster')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Join campaign' }));

    await waitFor(() => {
      expect(currentUrl()).toBe(`/campaigns/${preview.campaignId}`);
    });
    expect(calledWith(fetchMock, `/api/invites/${code}/accept`, 'POST')).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Shattered Coast' })).toBeDefined();
  });

  it('offers to open the campaign for existing members', async () => {
    mockApi(MIRA, [], { invites: { [code]: { ...preview, alreadyMember: true } } });
    renderAt(`/join/${code}`);

    expect(await screen.findByText("You're already in this campaign.")).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open campaign' })).toHaveProperty(
      'href',
      expect.stringContaining(`/campaigns/${preview.campaignId}`),
    );
    expect(screen.queryByRole('button', { name: 'Join campaign' })).toBeNull();
  });

  it('explains when a link no longer works', async () => {
    mockApi(MIRA);
    renderAt(`/join/${inviteCode('dead')}`);

    expect(
      await screen.findByRole('heading', { name: "This invite link doesn't work" }),
    ).toBeDefined();
  });
});

describe('Invite links (GM)', () => {
  it('creates, copies and revokes a link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const coast = campaign({ name: 'Shattered Coast' });
    const fetchMock = mockApi(MIRA, [coast]);
    renderAt(`/campaigns/${coast.id}`);

    expect(await screen.findByText('No active invite links.')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Link expires'), { target: { value: 'never' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    const links = await screen.findByRole('list', { name: 'Invite links' });
    const url = `${window.location.origin}/join/${inviteCode('new0')}`;
    expect(within(links).getByText(url)).toBeDefined();
    expect(within(links).getByText('Never expires')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/campaigns/${coast.id}/invites`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ expiresIn: 'never' }) }),
    );

    fireEvent.click(within(links).getByRole('button', { name: 'Copy link' }));
    expect(await within(links).findByRole('status')).toHaveProperty('textContent', 'Copied');
    expect(writeText).toHaveBeenCalledWith(url);

    fireEvent.click(within(links).getByRole('button', { name: 'Revoke' }));
    await confirm('Revoke');
    expect(await screen.findByText('No active invite links.')).toBeDefined();
  });

  it('is hidden while the campaign is archived', async () => {
    const old = campaign({ archivedAt: '2026-11-01T10:00:00.000Z' });
    mockApi(MIRA, [old]);
    renderAt(`/campaigns/${old.id}`);

    expect(await screen.findByRole('list', { name: 'Members' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Invite players' })).toBeNull();
  });
});

describe('Members and PCs', () => {
  it('creates a PC for a player, then moves it to another player', async () => {
    const coast = campaign();
    const tomas = member('Tomas');
    const ana = member('Ana');
    const fetchMock = mockApi(MIRA, [coast], {
      campaignData: { [coast.id]: { members: [ana, tomas] } },
    });
    renderAt(`/campaigns/${coast.id}`);

    const roster = await screen.findByRole('list', { name: 'Members' });
    expect(within(roster).getByText('Mira')).toBeDefined();
    fireEvent.click(within(roster).getByRole('button', { name: 'Set PC for Tomas' }));

    fireEvent.change(await screen.findByLabelText('New PC name'), { target: { value: ' Vex ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save PC' }));

    expect(await within(roster).findByText('Plays Vex')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/campaigns/${coast.id}/characters`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Vex', assignToUserId: tomas.userId }),
      }),
    );

    fireEvent.click(within(roster).getByRole('button', { name: 'Set PC for Ana' }));
    const choice = await screen.findByLabelText('Character');
    const vex = await within(choice).findByRole('option', { name: 'Vex (moves from Tomas)' });
    fireEvent.change(choice, { target: { value: (vex as HTMLOptionElement).value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save PC' }));

    await waitFor(() => {
      expect(within(roster).getAllByText('No PC yet')).toHaveLength(1);
    });
    expect(within(roster).getByText('Plays Vex')).toBeDefined();
  });

  it('checks a new PC name before sending', async () => {
    const coast = campaign();
    const tomas = member('Tomas');
    const fetchMock = mockApi(MIRA, [coast], {
      campaignData: { [coast.id]: { members: [tomas] } },
    });
    renderAt(`/campaigns/${coast.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Set PC for Tomas' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save PC' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Character name cannot be empty',
    );
    expect(calledWith(fetchMock, `/api/campaigns/${coast.id}/characters`, 'POST')).toBe(false);
  });

  it('lets the GM remove a player after confirming', async () => {
    const coast = campaign();
    const tomas = member('Tomas');
    const fetchMock = mockApi(MIRA, [coast], {
      campaignData: { [coast.id]: { members: [tomas] } },
    });
    renderAt(`/campaigns/${coast.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Tomas' }));
    await confirm('Remove');

    await waitFor(() => {
      expect(screen.queryByText('Tomas')).toBeNull();
    });
    expect(
      calledWith(fetchMock, `/api/campaigns/${coast.id}/members/${tomas.userId}`, 'DELETE'),
    ).toBe(true);
  });

  it('shows players the roster without GM tools, and lets them leave', async () => {
    const shared = campaign({ name: 'Iron Vale', role: 'player' });
    const gm = member('Gamemaster', 'gm');
    mockApi(MIRA, [shared], { campaignData: { [shared.id]: { members: [gm] } } });
    renderAt(`/campaigns/${shared.id}`);

    const roster = await screen.findByRole('list', { name: 'Members' });
    expect(within(roster).getByText('Gamemaster')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Set PC for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Invite players' })).toBeNull();

    fireEvent.click(within(roster).getByRole('button', { name: 'Leave campaign' }));
    await confirm('Leave');

    await waitFor(() => {
      expect(currentUrl()).toBe('/');
    });
    expect(await screen.findByText(/No active campaigns yet/)).toBeDefined();
  });
});
