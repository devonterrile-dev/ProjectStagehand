import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { currentUrl, MIRA, mockApi, renderAt } from '@/test/app-harness';

describe('App', () => {
  it('offers Sign in with Discord when signed out', async () => {
    mockApi(null);
    renderAt('/');

    expect(await screen.findByRole('button', { name: 'Sign in with Discord' })).toBeDefined();
  });

  it('shows a failed sign-in once and removes the error from the URL', async () => {
    mockApi(null);
    renderAt('/?error=state_not_found&keep=1');

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      "Sign-in didn't complete. Please try again.",
    );
    await waitFor(() => {
      expect(currentUrl()).toBe('/?keep=1');
    });
    // Still shown after the URL is cleaned: it was read once, on arrival.
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('ignores a leftover sign-in error when already signed in', async () => {
    mockApi(MIRA);
    renderAt('/?error=state_not_found');

    expect(await screen.findByRole('heading', { name: 'Welcome, Mira' })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => {
      expect(currentUrl()).toBe('/');
    });
  });

  it('welcomes a signed-in user by display name', async () => {
    mockApi(MIRA);
    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Welcome, Mira' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Your profile' })).toBeDefined();
  });

  it('sends signed-out visitors from /profile to sign-in', async () => {
    mockApi(null);
    renderAt('/profile');

    expect(await screen.findByRole('button', { name: 'Sign in with Discord' })).toBeDefined();
  });

  it('saves a trimmed display name from the profile page', async () => {
    const fetchMock = mockApi(MIRA);
    renderAt('/profile');

    const input = await screen.findByLabelText('Display name');
    fireEvent.change(input, { target: { value: '  Captain Vex  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/me',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ displayName: 'Captain Vex' }),
        }),
      );
    });
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Saved.');
  });

  it('validates the display name before sending', async () => {
    const fetchMock = mockApi(MIRA);
    renderAt('/profile');

    fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Display name cannot be empty',
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
