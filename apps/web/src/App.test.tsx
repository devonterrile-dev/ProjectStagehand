import type { MeResponse } from '@stagehand/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

const MIRA: MeResponse = {
  id: '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11',
  displayName: 'Mira',
  hasCustomDisplayName: false,
  discordUsername: 'mira',
  avatarUrl: null,
};

/** Fakes the Stagehand API: `me` is the signed-in user, or null for signed out. */
function mockApi(me: MeResponse | null) {
  const respond = (url: string, init?: RequestInit): Response => {
    if (url.endsWith('/api/me') && (init?.method ?? 'GET') === 'GET') {
      return me === null
        ? Response.json({ error: 'Unauthorized' }, { status: 401 })
        : Response.json(me);
    }
    if (url.endsWith('/api/me') && init?.method === 'PATCH' && typeof init.body === 'string') {
      const body = JSON.parse(init.body) as { displayName: string | null };
      return Response.json({
        ...MIRA,
        displayName: body.displayName ?? MIRA.displayName,
        hasCustomDisplayName: body.displayName !== null,
      });
    }
    return new Response('not mocked', { status: 500 });
  };

  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) =>
      Promise.resolve(respond(input instanceof Request ? input.url : String(input), init)),
    );
}

/** Exposes the router's current URL so tests can assert on it. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const currentUrl = () => screen.getByTestId('location').textContent;

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
