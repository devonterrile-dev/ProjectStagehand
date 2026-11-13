/**
 * Renders the whole app against a fake Stagehand API (a `fetch` spy with in-memory
 * campaigns, members, PC sheets, invites, records and stat blocks), so tests drive real
 * pages, routes and queries.
 */
import {
  applyFieldsPatch,
  emptyLinksFor,
  characterSheetPatchSchemaFor,
  createRecordRequestSchema,
  createStatBlockRequestSchema,
  emptyRichText,
  hasTermPrefix,
  linkFieldSpec,
  linkTargetsLabel,
  mentionIdsOfRecord,
  playerCharacterSheetSchema,
  richTextToPlainText,
  rulesetFor,
  providerSchema,
  saveProviderKeyRequestSchemas,
  searchTerms,
  snippetAround,
  updateRecordRequestSchemaFor,
  updateStatBlockRequestSchema,
  type BacklinksResponse,
  type Campaign,
  type CampaignRecord,
  type CampaignRole,
  type Character,
  type CharacterSheet,
  type Invite,
  type InvitePreview,
  type Member,
  type MeResponse,
  type Provider,
  type ProviderCredential,
  type RecordListItem,
  type RecordRef,
  type RecordType,
  type StatBlock,
  type StatBlockSummary,
} from '@stagehand/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';

import { App } from '@/App';

import { importsWorld, type ImportsWorldOptions } from './imports-world';

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
    rulesetVersion: 1,
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

/** A record fixture: a type, plus anything to override. Rich text starts empty. */
export function record(
  overrides: Partial<Omit<CampaignRecord, 'type' | 'fields'>> & {
    type: RecordType;
    fields?: Record<string, unknown>;
  },
): CampaignRecord {
  return {
    id: uuid(),
    name: 'Untitled',
    publicDescription: emptyRichText(),
    gmNotes: emptyRichText(),
    fields: {},
    tags: [],
    parentId: null,
    statBlockId: null,
    revealedAt: null,
    source: 'manual',
    links: emptyLinksFor(overrides.type),
    otherLinks: [],
    createdAt: '2026-11-09T10:00:00.000Z',
    updatedAt: '2026-11-09T10:00:00.000Z',
    ...overrides,
  };
}

/** A PC sheet fixture: a blank sheet (as the server creates one), plus overrides. */
export function characterSheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    id: uuid(),
    name: 'Untitled PC',
    assignedToUserId: null,
    level: 1,
    className: '',
    publicDescription: emptyRichText(),
    gmNotes: emptyRichText(),
    traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    evasion: 0,
    armorScore: 0,
    armorSlotsMax: 0,
    armorSlotsMarked: 0,
    minorThreshold: 0,
    majorThreshold: 0,
    severeThreshold: 0,
    hpMax: 0,
    hpCurrent: 0,
    stressMax: 0,
    stressCurrent: 0,
    hope: 0,
    proficiency: 1,
    experiences: [],
    weapons: { primary: null, secondary: null, inventory: [] },
    armor: null,
    inventory: [],
    gold: { handfuls: 0, bags: 0, chests: 0 },
    classFeature: null,
    combatOptions: [],
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

/** A stat block fixture with defaults; `usedBy` is computed by the fake API. */
export function statBlock(overrides: Partial<StatBlock> = {}): StatBlock {
  return {
    id: uuid(),
    name: 'Untitled stat block',
    tier: 1,
    role: '',
    publicDescription: emptyRichText(),
    difficulty: 0,
    attackModifier: 0,
    standardAttack: null,
    experiences: [],
    motives: [],
    features: [],
    majorThreshold: 0,
    severeThreshold: 0,
    hpMax: 0,
    stressMax: 0,
    usedBy: [],
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * Makes every request with `method` fail with `{ statusCode, error, message }` until the
 * returned function is called.
 */
export function failRequests(
  fetchMock: ReturnType<typeof mockApi>,
  method: string,
  status: number,
  message: string,
): () => void {
  const original = fetchMock.getMockImplementation();
  fetchMock.mockImplementation((input, init) =>
    (init?.method ?? 'GET') === method
      ? Promise.resolve(Response.json({ statusCode: status, error: 'Error', message }, { status }))
      : (original?.(input, init) ?? Promise.reject(new Error('fetch is not mocked'))),
  );
  return () => {
    if (original !== undefined) fetchMock.mockImplementation(original);
  };
}

interface CampaignData {
  members: Member[];
  /** Full sheets; `assignedToUserId` is derived from the members, like the server. */
  characters: CharacterSheet[];
  invites: Invite[];
  records: CampaignRecord[];
  statBlocks: StatBlock[];
}

/** Seed data: a PC can be just `{ id, name }`, filled out with `characterSheet()`. */
type CampaignSeed = Partial<Omit<CampaignData, 'characters'>> & {
  characters?: Partial<CharacterSheet>[];
};

export interface FakeWorld extends ImportsWorldOptions {
  /** Extra members, PCs, invites, records and stat blocks per campaign id. Each campaign also has `me` as a member. */
  campaignData?: Record<string, CampaignSeed>;
  /** Invites `me` can open, by code. Accepting one adds its campaign as a player. */
  invites?: Record<string, InvitePreview>;
  /**
   * `me`'s stored AI keys (Anthropic and OpenRouter). Saving a key that contains `rejected`
   * gets the provider's refusal (400), and one containing `offline` the "couldn't reach"
   * error (502).
   */
  credentials?: ProviderCredential[];
}

/** What the fake server answers when Anthropic refuses a key, as the real one words it. */
export const KEY_REJECTED_MESSAGE =
  "Anthropic didn't accept this key. Check that you copied all of it, and that it hasn't been deleted. Nothing was saved.";
export const KEY_UNREACHABLE_MESSAGE =
  "Couldn't reach Anthropic to check the key. Try again in a moment. Nothing was saved.";
/** The same, for an OpenRouter key (F2.2). */
export const OPENROUTER_KEY_REJECTED_MESSAGE =
  "OpenRouter didn't accept this key. Check that you copied all of it, and that it hasn't been deleted or disabled. Nothing was saved.";
export const OPENROUTER_KEY_UNREACHABLE_MESSAGE =
  "Couldn't reach OpenRouter to check the key. Try again in a moment. Nothing was saved.";

const KEY_REFUSALS: Record<Provider, { rejected: string; offline: string }> = {
  anthropic: { rejected: KEY_REJECTED_MESSAGE, offline: KEY_UNREACHABLE_MESSAGE },
  openrouter: {
    rejected: OPENROUTER_KEY_REJECTED_MESSAGE,
    offline: OPENROUTER_KEY_UNREACHABLE_MESSAGE,
  },
};

/**
 * Fakes the Stagehand API: `me` is the signed-in user (null = signed out), `campaigns` the
 * campaigns they belong to. Writes change that state, like the real server.
 */
export function mockApi(me: MeResponse | null, campaigns: Campaign[] = [], world: FakeWorld = {}) {
  const store = new Map(campaigns.map((c) => [c.id, { ...c }]));
  let credentials: ProviderCredential[] = (world.credentials ?? []).map((c) => ({ ...c }));
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
        characters: (extra.characters ?? []).map((pc) => characterSheet(pc)),
        invites: [...(extra.invites ?? [])],
        records: (extra.records ?? []).map((r) => ({ ...r })),
        statBlocks: (extra.statBlocks ?? []).map((b) => ({ ...b })),
      };
      // A seeded sheet's `assignedToUserId` gives it to that member (e.g. `me`).
      for (const pc of entry.characters) {
        if (pc.assignedToUserId !== null) assign(entry, pc.assignedToUserId, pc.id);
      }
      data.set(c.id, entry);
    }
    return entry;
  };

  const holderOf = (d: CampaignData, characterId: string) =>
    d.members.find((m) => m.character?.id === characterId)?.userId ?? null;

  const charactersOf = (d: CampaignData): Character[] =>
    d.characters.map((pc) => ({
      id: pc.id,
      name: pc.name,
      assignedToUserId: holderOf(d, pc.id),
    }));

  const assign = (d: CampaignData, userId: string, characterId: string | null) => {
    const sheet = d.characters.find((c) => c.id === characterId);
    const pc = sheet === undefined ? null : { id: sheet.id, name: sheet.name };
    for (const m of d.members) {
      if (pc !== null && m.character?.id === pc.id) m.character = null;
      if (m.userId === userId) m.character = pc;
    }
  };

  const notFound = (message: string) =>
    Response.json({ error: 'Not Found', message }, { status: 404 });
  const refused = (status: number, message: string) =>
    Response.json({ statusCode: status, error: 'Refused', message }, { status });
  const invalid = (issues: { path: PropertyKey[]; message: string }[]) =>
    Response.json(
      {
        error: 'Bad Request',
        issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
      { status: 400 },
    );

  const imports = importsWorld(world, {
    hasKey: () => credentials.some((c) => c.provider === 'anthropic'),
    newRecord: (overrides) => record(overrides),
    refused,
    notFound,
  });
  for (const c of store.values()) imports.setCampaignName(c);

  /** The records API, GM only, mirroring the server's rules and messages. */
  const respondRecords = (
    found: Campaign,
    d: CampaignData,
    rest: string,
    method: string,
    rawBody: unknown,
  ): Response | null => {
    const [path = '', queryString = ''] = rest.split('?');
    const recordMatch = /^\/records\/([^/]+)$/.exec(path);
    const backlinksMatch = /^\/records\/([^/]+)\/backlinks$/.exec(path);
    if (path !== '/records' && recordMatch === null && backlinksMatch === null) return null;
    if (found.role !== 'gm') return refused(403, 'Only the GM can do that');

    const byId = (id: string) => d.records.find((r) => r.id === id);
    const refOf = (r: CampaignRecord): RecordRef => ({ id: r.id, type: r.type, name: r.name });
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    /** Like the server: links under the targets' current names, sorted, deleted ones gone. */
    const present = (r: CampaignRecord): CampaignRecord => ({
      ...r,
      links: Object.fromEntries(
        Object.entries(r.links).map(([key, refs]) => [
          key,
          refs
            .flatMap((ref) => {
              const target = byId(ref.id);
              return target === undefined ? [] : [refOf(target)];
            })
            .sort(byName),
        ]),
      ),
      otherLinks: r.otherLinks
        .flatMap((link) => {
          const target = byId(link.record.id);
          return target === undefined ? [] : [{ record: refOf(target), label: link.label }];
        })
        .sort((a, b) => byName(a.record, b.record)),
    });
    const SELF_LINK = "A record can't link to itself";
    /** The server's link checks: a refusal, or null when every id may be linked. */
    const linkRefusal = (
      from: CampaignRecord,
      links: Record<string, string[] | undefined> | undefined,
      others: { recordId: string }[] | undefined,
    ): Response | null => {
      for (const [key, ids] of Object.entries(links ?? {})) {
        const spec = linkFieldSpec(from.type, key);
        if (spec === undefined || ids === undefined) continue;
        for (const id of ids) {
          if (id === from.id) return refused(400, SELF_LINK);
          const target = byId(id);
          if (target === undefined) return notFound('Linked record not found');
          if (!spec.targets.includes(target.type)) {
            return refused(400, `${spec.label} can only link ${linkTargetsLabel(spec.targets)}`);
          }
        }
      }
      for (const { recordId } of others ?? []) {
        if (recordId === from.id) return refused(400, SELF_LINK);
        if (byId(recordId) === undefined) return notFound('Linked record not found');
      }
      return null;
    };

    if (backlinksMatch !== null) {
      const target = byId(backlinksMatch[1] ?? '');
      if (target === undefined) return notFound('Record not found');
      if (method !== 'GET') return null;
      const response: BacklinksResponse = { links: [], mentions: [], inventories: [] };
      for (const source of [...d.records].sort(byName)) {
        for (const [fieldKey, refs] of Object.entries(source.links)) {
          if (refs.some((ref) => ref.id === target.id)) {
            response.links.push({ record: refOf(source), kind: 'field', fieldKey, label: null });
          }
        }
        for (const link of source.otherLinks) {
          if (link.record.id === target.id) {
            response.links.push({
              record: refOf(source),
              kind: 'other',
              fieldKey: null,
              label: link.label,
            });
          }
        }
        const mentioned = mentionIdsOfRecord(source.type, source);
        if (source.id !== target.id && mentioned.includes(target.id)) {
          response.mentions.push(refOf(source));
        }
      }
      response.inventories = d.characters
        .filter((pc) => pc.inventory.some((row) => row.recordId === target.id))
        .map((pc) => ({ id: pc.id, name: pc.name }))
        .sort(byName);
      return Response.json(response);
    }
    const toSummary = (r: CampaignRecord): RecordListItem => ({
      id: r.id,
      type: r.type,
      name: r.name,
      tags: r.tags,
      parentId: r.parentId,
      parentName: d.records.find((parent) => parent.id === r.parentId)?.name ?? null,
      revealedAt: r.revealedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      match: null,
    });

    if (recordMatch === null) {
      if (method === 'GET') {
        const params = new URLSearchParams(queryString);
        const type = params.get('type');
        const tags = params.getAll('tag');
        const areaId = params.get('areaId');
        const limit = params.get('limit');
        const q = params.get('q')?.trim() ?? '';
        const terms = searchTerms(q);
        /** Like the server (D-25): name substring, or every term prefixes a word somewhere. */
        const textOf = (r: CampaignRecord) =>
          [
            r.name,
            ...r.tags,
            richTextToPlainText(r.publicDescription),
            richTextToPlainText(r.gmNotes),
          ].join(' ');
        const hit = (r: CampaignRecord) =>
          r.name.toLowerCase().includes(q.toLowerCase()) ||
          (terms.length > 0 && terms.every((term) => hasTermPrefix(textOf(r), [term])));
        const rank = (r: CampaignRecord) => {
          const name = r.name.toLowerCase();
          const needle = q.toLowerCase();
          if (name === needle) return 0;
          if (name.startsWith(needle)) return 1;
          return name.includes(needle) ? 2 : 3;
        };
        const matchOf = (r: CampaignRecord): RecordListItem['match'] => {
          if (q === '' || r.name.toLowerCase().includes(q.toLowerCase())) return null;
          if (terms.every((term) => hasTermPrefix([r.name, ...r.tags].join(' '), [term]))) {
            return null;
          }
          for (const field of ['publicDescription', 'gmNotes'] as const) {
            const snippet = snippetAround(richTextToPlainText(r[field]), terms);
            if (snippet !== null) return { field, snippet };
          }
          return null;
        };
        const list = d.records
          .filter((r) => type === null || r.type === type)
          .filter((r) => tags.every((tag) => r.tags.includes(tag)))
          .filter((r) => areaId === null || r.parentId === areaId)
          .filter((r) => q === '' || hit(r))
          .sort((a, b) => (q === '' ? 0 : rank(a) - rank(b)) || a.name.localeCompare(b.name))
          .slice(0, limit === null ? undefined : Number(limit));
        return Response.json({
          records: list.map((r) => ({ ...toSummary(r), match: matchOf(r) })),
        });
      }
      if (method === 'POST') {
        if (found.archivedAt !== null) return refused(409, 'Campaign is archived');
        const parsed = createRecordRequestSchema.safeParse(rawBody);
        if (!parsed.success) return invalid(parsed.error.issues);
        const input = parsed.data;
        const parentId = input.type === 'spot' ? input.parentId : null;
        if (parentId !== null && !d.records.some((r) => r.id === parentId && r.type === 'area')) {
          return notFound('Area not found');
        }
        const created = record({
          type: input.type,
          name: input.name,
          fields: input.fields ?? {},
          tags: input.tags ?? [],
          publicDescription: input.publicDescription ?? emptyRichText(),
          gmNotes: input.gmNotes ?? emptyRichText(),
          parentId,
        });
        d.records.push(created);
        return Response.json(present(created), { status: 201 });
      }
      return null;
    }

    const existing = d.records.find((r) => r.id === recordMatch[1]);
    if (existing === undefined) return notFound('Record not found');
    if (method === 'GET') return Response.json(present(existing));
    if (method === 'PATCH') {
      if (found.archivedAt !== null) return refused(409, 'Campaign is archived');
      const parsed = updateRecordRequestSchemaFor(existing.type).safeParse(rawBody);
      if (!parsed.success) return invalid(parsed.error.issues);
      const patch = parsed.data;
      const refusal = linkRefusal(existing, patch.links, patch.otherLinks);
      if (refusal !== null) return refusal;
      if (patch.name !== undefined) existing.name = patch.name;
      if (patch.publicDescription !== undefined)
        existing.publicDescription = patch.publicDescription;
      if (patch.gmNotes !== undefined) existing.gmNotes = patch.gmNotes;
      if (patch.tags !== undefined) existing.tags = patch.tags;
      if (patch.parentId !== undefined) existing.parentId = patch.parentId;
      if (patch.statBlockId !== undefined) {
        if (patch.statBlockId !== null) {
          if (existing.type !== 'npc') return refused(400, 'Only NPCs have a stat block');
          if (!d.statBlocks.some((b) => b.id === patch.statBlockId)) {
            return notFound('Stat block not found');
          }
        }
        existing.statBlockId = patch.statBlockId;
      }
      if (patch.fields !== undefined) {
        existing.fields = applyFieldsPatch(existing.type, existing.fields, patch.fields);
      }
      for (const [key, ids] of Object.entries(patch.links ?? {})) {
        if (ids === undefined) continue;
        existing.links = {
          ...existing.links,
          [key]: ids.flatMap((id) => {
            const target = byId(id);
            return target === undefined ? [] : [refOf(target)];
          }),
        };
      }
      if (patch.otherLinks !== undefined) {
        existing.otherLinks = patch.otherLinks.flatMap(({ recordId, label }) => {
          const target = byId(recordId);
          return target === undefined ? [] : [{ record: refOf(target), label }];
        });
      }
      existing.updatedAt = '2026-11-10T12:00:00.000Z';
      return Response.json(present(existing));
    }
    if (method === 'DELETE') {
      if (found.archivedAt !== null) return refused(409, 'Campaign is archived');
      if (existing.type === 'area' && d.records.some((r) => r.parentId === existing.id)) {
        return refused(409, 'This area still has spots. Move or delete them first.');
      }
      d.records = d.records.filter((r) => r.id !== existing.id);
      // Links to it disappear (`present` drops them); PC inventories lose the Item.
      for (const pc of d.characters) {
        pc.inventory = pc.inventory.map((row) =>
          row.recordId === existing.id ? { name: row.name, detail: row.detail } : row,
        );
      }
      return new Response(null, { status: 204 });
    }
    return null;
  };

  /** One PC's sheet: the GM's full sheet, or a player's own through the allow-list. */
  const respondCharacter = (
    found: Campaign,
    d: CampaignData,
    rest: string,
    method: string,
    rawBody: unknown,
  ): Response | null => {
    const sheetMatch = /^\/characters\/([^/]+)$/.exec(rest);
    if (sheetMatch === null) return null;
    const sheet = d.characters.find((c) => c.id === sheetMatch[1]);
    const full = (pc: CharacterSheet): CharacterSheet => ({
      ...pc,
      assignedToUserId: holderOf(d, pc.id),
    });

    if (found.role !== 'gm') {
      if (method !== 'GET') return refused(403, 'Only the GM can do that');
      if (sheet === undefined || holderOf(d, sheet.id) !== me?.id) {
        return notFound('Character not found');
      }
      return Response.json(playerCharacterSheetSchema.parse(full(sheet)));
    }
    if (sheet === undefined) return notFound('Character not found');
    if (method === 'GET') return Response.json(full(sheet));
    if (found.archivedAt !== null) return refused(409, 'Campaign is archived');
    if (method === 'PATCH') {
      const parsed = characterSheetPatchSchemaFor(
        rulesetFor(found.rulesetVersion),
        sheet,
      ).safeParse(rawBody);
      if (!parsed.success) return invalid(parsed.error.issues);
      for (const row of parsed.data.inventory ?? []) {
        const item = d.records.find((r) => r.id === row.recordId);
        if (row.recordId !== undefined && item?.type !== 'item') return notFound('Item not found');
      }
      Object.assign(sheet, parsed.data, { updatedAt: '2026-11-10T12:00:00.000Z' });
      for (const m of d.members) {
        if (m.character?.id === sheet.id) m.character = { id: sheet.id, name: sheet.name };
      }
      return Response.json(full(sheet));
    }
    if (method === 'DELETE') {
      for (const m of d.members) if (m.character?.id === sheet.id) m.character = null;
      d.characters = d.characters.filter((c) => c.id !== sheet.id);
      return new Response(null, { status: 204 });
    }
    return null;
  };

  /** The stat blocks API, GM only; deleting one unlinks its NPCs. */
  const respondStatBlocks = (
    found: Campaign,
    d: CampaignData,
    rest: string,
    method: string,
    rawBody: unknown,
  ): Response | null => {
    const blockMatch = /^\/stat-blocks\/([^/]+)$/.exec(rest);
    if (rest !== '/stat-blocks' && blockMatch === null) return null;
    if (found.role !== 'gm') return refused(403, 'Only the GM can do that');
    const usersOf = (id: string) =>
      d.records
        .filter((r) => r.statBlockId === id)
        .map((r) => ({ id: r.id, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const full = (b: StatBlock): StatBlock => ({ ...b, usedBy: usersOf(b.id) });

    if (blockMatch === null) {
      if (method === 'GET') {
        const summaries: StatBlockSummary[] = [...d.statBlocks]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((b) => ({
            id: b.id,
            name: b.name,
            tier: b.tier,
            role: b.role,
            usedByCount: usersOf(b.id).length,
            updatedAt: b.updatedAt,
          }));
        return Response.json({ statBlocks: summaries });
      }
      if (method === 'POST') {
        if (found.archivedAt !== null) return refused(409, 'Campaign is archived');
        const parsed = createStatBlockRequestSchema.safeParse(rawBody);
        if (!parsed.success) return invalid(parsed.error.issues);
        const created = statBlock(parsed.data);
        d.statBlocks.push(created);
        return Response.json(full(created), { status: 201 });
      }
      return null;
    }

    const existing = d.statBlocks.find((b) => b.id === blockMatch[1]);
    if (existing === undefined) return notFound('Stat block not found');
    if (method === 'GET') return Response.json(full(existing));
    if (found.archivedAt !== null) return refused(409, 'Campaign is archived');
    if (method === 'PATCH') {
      const parsed = updateStatBlockRequestSchema.safeParse(rawBody);
      if (!parsed.success) return invalid(parsed.error.issues);
      Object.assign(existing, parsed.data, { updatedAt: '2026-11-10T12:00:00.000Z' });
      return Response.json(full(existing));
    }
    if (method === 'DELETE') {
      for (const r of d.records) if (r.statBlockId === existing.id) r.statBlockId = null;
      d.statBlocks = d.statBlocks.filter((b) => b.id !== existing.id);
      return new Response(null, { status: 204 });
    }
    return null;
  };

  const respond = (url: string, init?: RequestInit): Response => {
    const method = init?.method ?? 'GET';
    const rawBody: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const body = (rawBody ?? {}) as RequestBody;

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

    if (url === '/api/me/usage' && method === 'GET') {
      if (me === null) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      return Response.json(imports.usage());
    }

    if (url.startsWith('/api/me/credentials')) {
      if (me === null) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (url === '/api/me/credentials' && method === 'GET') {
        return Response.json({ credentials });
      }
      const provider = providerSchema.safeParse(url.slice('/api/me/credentials/'.length));
      if (provider.success && method === 'PUT') {
        const parsed = saveProviderKeyRequestSchemas[provider.data].safeParse(rawBody);
        if (!parsed.success) return invalid(parsed.error.issues);
        const refusals = KEY_REFUSALS[provider.data];
        if (parsed.data.apiKey.includes('rejected')) return refused(400, refusals.rejected);
        if (parsed.data.apiKey.includes('offline')) return refused(502, refusals.offline);
        const saved: ProviderCredential = {
          provider: provider.data,
          lastFour: parsed.data.apiKey.slice(-4),
          createdAt: '2026-11-11T12:00:00.000Z',
        };
        credentials = [...credentials.filter((c) => c.provider !== provider.data), saved];
        return Response.json(saved);
      }
      if (provider.success && method === 'DELETE') {
        credentials = credentials.filter((c) => c.provider !== provider.data);
        return new Response(null, { status: 204 });
      }
      return notFound('Not Found');
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
        const pc = characterSheet({ name: String(body.name) });
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

      const records = respondRecords(found, d, rest, method, rawBody);
      if (records !== null) return records;
      const sheet = respondCharacter(found, d, rest, method, rawBody);
      if (sheet !== null) return sheet;
      const blocks = respondStatBlocks(found, d, rest, method, rawBody);
      if (blocks !== null) return blocks;
      const imported = imports.respond(found, d.records, rest, method, rawBody);
      if (imported !== null) return imported;
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
