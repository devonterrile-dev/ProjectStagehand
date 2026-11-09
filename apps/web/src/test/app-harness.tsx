/**
 * Renders the whole app against a fake Stagehand API (a `fetch` spy with in-memory
 * campaigns, members, PCs and invites), so tests drive real pages, routes and queries.
 */
import type {
  Campaign,
  CampaignRole,
  Character,
  Invite,
  InvitePreview,
  Member,
  MeResponse,
} from '@stagehand/shared';
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

/** The JSON bodies the app sends. */
interface RequestBody {
  displayName?: string | null;
  name?: string;
  characterId?: string | null;
  assignToUserId?: string;
  expiresIn?: string;
}

let nextId = 0;

/** A fresh, valid uuid for fixtures. */
export function uuid(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
}

/** A campaign fixture with a fresh id. */
export function campaign(overrides: Partial<Campaign> = {}): Campaign {
  const id = uuid();
  return {
    id,
    name: `Campaign ${id.slice(-4)}`,
    role: 'gm',
    archivedAt: null,
    createdAt: '2026-11-09T10:00:00.000Z',
    ...overrides,
  };
}

/** A campaign member fixture (no PC unless given). */
export function member(displayName: string, role: CampaignRole = 'player'): Member {
  return {
    userId: uuid(),
    displayName,
    avatarUrl: null,
    role,
    character: null,
    joinedAt: '2026-11-09T10:00:00.000Z',
  };
}

/** An invite code fixture: 22 base64url characters. */
export function inviteCode(seed: string): string {
  return seed.padEnd(22, 'x').slice(0, 22);
}

interface CampaignData {
  members: Member[];
  characters: { id: string; name: string }[];
  invites: Invite[];
}

export interface FakeWorld {
  /** Extra members, PCs and invites per campaign id. Each campaign also has `me` as a member. */
  campaignData?: Record<string, Partial<CampaignData>>;
  /** Invites `me` can open, by code. Accepting one adds its campaign as a player. */
  invites?: Record<string, InvitePreview>;
}

/**
 * Fakes the Stagehand API: `me` is the signed-in user (null = signed out), `campaigns` the
 * campaigns they belong to. Writes change that state, like the real server.
 */
export function mockApi(me: MeResponse | null, campaigns: Campaign[] = [], world: FakeWorld = {}) {
  const store = new Map(campaigns.map((c) => [c.id, { ...c }]));
  const data = new Map<string, CampaignData>();
  const dataFor = (c: Campaign): CampaignData => {
    let entry = data.get(c.id);
    if (entry === undefined) {
      const extra = world.campaignData?.[c.id] ?? {};
      const self: Member[] =
        me === null
          ? []
          : [{ ...member(me.displayName, c.role), userId: me.id, avatarUrl: me.avatarUrl }];
      entry = {
        members: [...self, ...(extra.members ?? [])],
        characters: [...(extra.characters ?? [])],
        invites: [...(extra.invites ?? [])],
      };
      data.set(c.id, entry);
    }
    return entry;
  };

  const charactersOf = (d: CampaignData): Character[] =>
    d.characters.map((pc) => ({
      ...pc,
      assignedToUserId: d.members.find((m) => m.character?.id === pc.id)?.userId ?? null,
    }));

  const assign = (d: CampaignData, userId: string, characterId: string | null) => {
    const pc = d.characters.find((c) => c.id === characterId) ?? null;
    for (const m of d.members) {
      if (pc !== null && m.character?.id === pc.id) m.character = null;
      if (m.userId === userId) m.character = pc;
    }
  };

  const notFound = (message: string) =>
    Response.json({ error: 'Not Found', message }, { status: 404 });

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

    const invite = /^\/api\/invites\/([^/]+)(\/accept)?$/.exec(url);
    if (invite) {
      const [, code = '', accept] = invite;
      const preview = world.invites?.[decodeURIComponent(code)];
      if (preview === undefined) return notFound('This invite link has expired or been revoked');
      if (accept === undefined) return Response.json(preview);
      if (!store.has(preview.campaignId)) {
        store.set(
          preview.campaignId,
          campaign({ id: preview.campaignId, name: preview.campaignName, role: 'player' }),
        );
      }
      return Response.json({ campaignId: preview.campaignId });
    }

    const match = /^\/api\/campaigns\/([^/]+)(\/.*)?$/.exec(url);
    if (match) {
      const [, id = '', rest = ''] = match;
      const found = store.get(decodeURIComponent(id));
      if (found === undefined) return notFound('Campaign not found');
      const d = dataFor(found);

      if (rest === '' && method === 'GET') return Response.json(found);
      if (rest === '' && method === 'PATCH') {
        if (found.archivedAt !== null) {
          return Response.json({ message: 'Campaign is archived' }, { status: 409 });
        }
        found.name = String(body.name);
        return Response.json(found);
      }
      if (rest === '/archive' && method === 'POST') {
        found.archivedAt ??= '2026-11-09T12:00:00.000Z';
        return Response.json(found);
      }
      if (rest === '/unarchive' && method === 'POST') {
        found.archivedAt = null;
        return Response.json(found);
      }

      if (rest === '/members' && method === 'GET') return Response.json({ members: d.members });
      const memberMatch = /^\/members\/([^/]+)(\/character)?$/.exec(rest);
      if (memberMatch) {
        const [, userId = '', character] = memberMatch;
        if (!d.members.some((m) => m.userId === userId)) return notFound('Member not found');
        if (character === undefined && method === 'DELETE') {
          d.members = d.members.filter((m) => m.userId !== userId);
          if (userId === me?.id) store.delete(found.id);
          return new Response(null, { status: 204 });
        }
        if (character !== undefined && method === 'PUT') {
          assign(d, userId, body.characterId ?? null);
          return new Response(null, { status: 204 });
        }
      }

      if (rest === '/characters' && method === 'GET') {
        return Response.json({ characters: charactersOf(d) });
      }
      if (rest === '/characters' && method === 'POST') {
        const pc = { id: uuid(), name: String(body.name) };
        d.characters.push(pc);
        if (body.assignToUserId !== undefined) assign(d, body.assignToUserId, pc.id);
        const created = charactersOf(d).find((c) => c.id === pc.id);
        return Response.json(created, { status: 201 });
      }

      if (rest === '/invites' && method === 'GET') return Response.json({ invites: d.invites });
      if (rest === '/invites' && method === 'POST') {
        const created: Invite = {
          id: uuid(),
          code: inviteCode(`new${String(d.invites.length)}`),
          expiresAt: body.expiresIn === 'never' ? null : '2026-11-16T10:00:00.000Z',
          createdAt: '2026-11-09T10:00:00.000Z',
        };
        d.invites = [created, ...d.invites];
        return Response.json(created, { status: 201 });
      }
      const revoke = /^\/invites\/([^/]+)\/revoke$/.exec(rest);
      if (revoke && method === 'POST') {
        d.invites = d.invites.filter((i) => i.id !== revoke[1]);
        return new Response(null, { status: 204 });
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
