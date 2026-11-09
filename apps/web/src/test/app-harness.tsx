/**
 * Renders the whole app against a fake Stagehand API (a `fetch` spy with an in-memory
 * campaign store), so tests drive real pages, routes and queries.
 */
import type { Campaign, MeResponse } from '@stagehand/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';

import { App } from '@/App';

export const MIRA: MeResponse = {
  id: '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11',
  displayName: 'Mira',
  hasCustomDisplayName: false,
  discordUsername: 'mira',
  avatarUrl: null,
};

/** The JSON bodies the app sends (PATCH /api/me, campaign create and rename). */
interface RequestBody {
  displayName?: string | null;
  name?: string;
}

let nextId = 0;

/** A campaign fixture with a fresh, valid id. */
export function campaign(overrides: Partial<Campaign> = {}): Campaign {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    name: `Campaign ${String(nextId)}`,
    role: 'gm',
    archivedAt: null,
    createdAt: '2026-11-09T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * Fakes the Stagehand API: `me` is the signed-in user (null = signed out), `campaigns` the
 * campaigns they belong to. Writes change that list, like the real server.
 */
export function mockApi(me: MeResponse | null, campaigns: Campaign[] = []) {
  const store = new Map(campaigns.map((c) => [c.id, { ...c }]));

  const respond = (url: string, init?: RequestInit): Response => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as RequestBody) : {};

    if (url.endsWith('/api/me') && method === 'GET') {
      return me === null
        ? Response.json({ error: 'Unauthorized' }, { status: 401 })
        : Response.json(me);
    }
    if (url.endsWith('/api/me') && method === 'PATCH') {
      const displayName = body.displayName ?? null;
      return Response.json({
        ...MIRA,
        displayName: displayName ?? MIRA.displayName,
        hasCustomDisplayName: displayName !== null,
      });
    }

    if (url === '/api/campaigns' && method === 'GET') {
      return Response.json({ campaigns: [...store.values()] });
    }
    if (url === '/api/campaigns' && method === 'POST') {
      const created = campaign({ name: String(body.name) });
      store.set(created.id, created);
      return Response.json(created, { status: 201 });
    }

    const match = /^\/api\/campaigns\/([^/]+)(?:\/(archive|unarchive))?$/.exec(url);
    if (match) {
      const [, id = '', action] = match;
      const found = store.get(decodeURIComponent(id));
      if (found === undefined) {
        return Response.json(
          { error: 'Not Found', message: 'Campaign not found' },
          { status: 404 },
        );
      }
      if (method === 'GET') return Response.json(found);
      if (method === 'PATCH') {
        if (found.archivedAt !== null) {
          return Response.json({ message: 'Campaign is archived' }, { status: 409 });
        }
        found.name = String(body.name);
        return Response.json(found);
      }
      if (method === 'POST' && action === 'archive') {
        found.archivedAt ??= '2026-11-09T12:00:00.000Z';
        return Response.json(found);
      }
      if (method === 'POST' && action === 'unarchive') {
        found.archivedAt = null;
        return Response.json(found);
      }
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
// eslint-disable-next-line react-refresh/only-export-components -- test-only helper, never hot-reloaded
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

export function renderAt(path: string) {
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

export const currentUrl = () => screen.getByTestId('location').textContent;
