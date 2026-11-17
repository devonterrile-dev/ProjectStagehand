/**
 * The player journal part of the fake API (F3.5): revealed records as players read them, player
 * entries and the notes on both, following the server's rules and messages
 * (`apps/server/src/campaigns/journal.ts` and `notes.ts`).
 */
import {
  createEntryRequestSchema,
  noteRequestSchema,
  updateEntryRequestSchema,
  withMentionsOnly,
  type Campaign,
  type CampaignRecord,
  type JournalAuthor,
  type JournalRecord,
  type JournalRecordSummary,
  type MeResponse,
  type PlayerEntry,
  type PlayerNote,
} from '@stagehand/shared';

import { stageImageOf } from './scenes-world';

/** A note or an entry to start with. */
export type NoteSeed = Omit<PlayerNote, 'createdAt' | 'updatedAt'> &
  Partial<Pick<PlayerNote, 'createdAt' | 'updatedAt'>> &
  ({ recordId: string } | { entryId: string });

export interface JournalWorldOptions {
  /** Player entries already written, by campaign id. */
  entries?: Record<string, PlayerEntry[]>;
  /** Notes already left, by campaign id, newest last. */
  notes?: Record<string, NoteSeed[]>;
}

interface Ctx {
  me: MeResponse | null;
  refused: (status: number, message: string) => Response;
  notFound: (message: string) => Response;
  invalid: (issues: { path: PropertyKey[]; message: string }[]) => Response;
}

type StoredNote = PlayerNote & { recordId?: string; entryId?: string };

let nextId = 0;
const id = () => {
  nextId += 1;
  return `00000000-0000-4000-bc00-${String(nextId).padStart(12, '0')}`;
};
/** Each write is a minute after the last, so newest-first order is well defined. */
let clock = Date.parse('2026-11-16T18:00:00.000Z');
const now = () => {
  clock += 60_000;
  return new Date(clock).toISOString();
};

export function journalWorld(options: JournalWorldOptions, ctx: Ctx) {
  const entryStores = new Map<string, PlayerEntry[]>();
  const noteStores = new Map<string, StoredNote[]>();
  const entriesOf = (campaignId: string) => {
    let entries = entryStores.get(campaignId);
    if (entries === undefined) {
      entries = (options.entries?.[campaignId] ?? []).map((entry) => ({ ...entry }));
      entryStores.set(campaignId, entries);
    }
    return entries;
  };
  const notesOf = (campaignId: string) => {
    let notes = noteStores.get(campaignId);
    if (notes === undefined) {
      notes = (options.notes?.[campaignId] ?? []).map((note) => ({
        createdAt: now(),
        ...note,
        updatedAt: note.updatedAt ?? note.createdAt ?? new Date(clock).toISOString(),
      }));
      noteStores.set(campaignId, notes);
    }
    return notes;
  };
  const author = (): JournalAuthor => ({
    userId: ctx.me?.id ?? null,
    displayName: ctx.me?.displayName ?? 'Former player',
  });
  const newestFirst = <T extends { createdAt: string }>(items: T[]) =>
    [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const strip = (note: StoredNote): PlayerNote => ({
    id: note.id,
    body: note.body,
    author: note.author,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  });

  function respond(
    found: Campaign,
    records: readonly CampaignRecord[],
    rest: string,
    method: string,
    rawBody: unknown,
  ): Response | null {
    const [path = '', queryString = ''] = rest.split('?');
    if (!path.startsWith('/journal') && !path.startsWith('/notes/')) return null;
    const archived = found.archivedAt !== null;
    const isGm = found.role === 'gm';
    const revealed = records.filter((r) => r.revealedAt !== null);
    const revealedRecord = (recordId: string) => revealed.find((r) => r.id === recordId);
    const entries = entriesOf(found.id);
    const notes = notesOf(found.id);
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase());

    if (path === '/journal/records' && method === 'GET') {
      const params = new URLSearchParams(queryString);
      const type = params.get('type');
      const q = (params.get('q') ?? '').toLowerCase();
      const list: JournalRecordSummary[] = revealed
        .filter((r) => type === null || r.type === type)
        .filter(
          (r) =>
            q === '' ||
            r.name.toLowerCase().includes(q) ||
            JSON.stringify(r.publicDescription).toLowerCase().includes(q),
        )
        .sort(byName)
        .map((r) => ({
          id: r.id,
          type: r.type,
          name: r.name,
          parentName: revealedRecord(r.parentId ?? '')?.name ?? null,
          revealedAt: r.revealedAt ?? '',
        }));
      return Response.json({ records: list });
    }

    const recordMatch = /^\/journal\/records\/([^/]+)(\/notes)?$/.exec(path);
    if (recordMatch !== null) {
      const [, recordId = '', notesPart] = recordMatch;
      const record = revealedRecord(recordId);
      if (record === undefined) return ctx.notFound('Record not found');
      if (notesPart === undefined) {
        if (method !== 'GET') return new Response('not mocked', { status: 500 });
        const read: JournalRecord = {
          id: record.id,
          type: record.type,
          name: record.name,
          publicDescription: withMentionsOnly(
            record.publicDescription,
            new Set(revealed.map((r) => r.id)),
          ),
          image: stageImageOf(record),
          parentName: revealedRecord(record.parentId ?? '')?.name ?? null,
          revealedAt: record.revealedAt ?? '',
        };
        return Response.json(read);
      }
      return respondNotes({ recordId });
    }

    if (path === '/journal/entries') {
      if (method === 'GET') return Response.json({ entries: newestFirst(entries) });
      if (method !== 'POST') return new Response('not mocked', { status: 500 });
      if (archived) return ctx.refused(409, 'Campaign is archived');
      if (isGm) return ctx.refused(403, 'Player entries are for players');
      const parsed = createEntryRequestSchema.safeParse(rawBody);
      if (!parsed.success) return ctx.invalid(parsed.error.issues);
      const at = now();
      const entry: PlayerEntry = {
        id: id(),
        ...parsed.data,
        author: author(),
        createdAt: at,
        updatedAt: at,
      };
      entries.push(entry);
      return Response.json(entry, { status: 201 });
    }

    const entryMatch = /^\/journal\/entries\/([^/]+)(\/notes)?$/.exec(path);
    if (entryMatch !== null) {
      const [, entryId = '', notesPart] = entryMatch;
      const entry = entries.find((e) => e.id === entryId);
      if (entry === undefined) return ctx.notFound('Entry not found');
      if (notesPart !== undefined) return respondNotes({ entryId });
      if (method === 'GET') return Response.json(entry);
      if (archived) return ctx.refused(409, 'Campaign is archived');
      const mine = entry.author.userId === ctx.me?.id;
      if (method === 'PATCH') {
        if (!mine) return ctx.refused(403, 'Only its author can change that');
        const parsed = updateEntryRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        Object.assign(entry, parsed.data, { updatedAt: now() });
        return Response.json(entry);
      }
      if (method === 'DELETE') {
        if (!mine && !isGm) return ctx.refused(403, 'Only its author or the GM can delete that');
        entries.splice(entries.indexOf(entry), 1);
        for (const note of notes.filter((n) => n.entryId === entryId)) {
          notes.splice(notes.indexOf(note), 1);
        }
        return new Response(null, { status: 204 });
      }
      return new Response('not mocked', { status: 500 });
    }

    const noteMatch = /^\/notes\/([^/]+)$/.exec(path);
    if (noteMatch !== null) {
      const note = notes.find((n) => n.id === noteMatch[1]);
      if (note === undefined || (note.recordId !== undefined && !revealedRecord(note.recordId))) {
        return ctx.notFound('Note not found');
      }
      if (archived) return ctx.refused(409, 'Campaign is archived');
      const mine = note.author.userId === ctx.me?.id;
      if (method === 'PATCH') {
        if (!mine) return ctx.refused(403, 'Only its author can change that');
        const parsed = noteRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        note.body = parsed.data.body;
        note.updatedAt = now();
        return Response.json(strip(note));
      }
      if (method === 'DELETE') {
        if (!mine && !isGm) return ctx.refused(403, 'Only its author or the GM can delete that');
        notes.splice(notes.indexOf(note), 1);
        return new Response(null, { status: 204 });
      }
      return new Response('not mocked', { status: 500 });
    }

    return new Response('not mocked', { status: 500 });

    function respondNotes(subject: { recordId: string } | { entryId: string }): Response {
      const on = (n: StoredNote) =>
        'recordId' in subject ? n.recordId === subject.recordId : n.entryId === subject.entryId;
      if (method === 'GET')
        return Response.json({ notes: newestFirst(notes.filter(on)).map(strip) });
      if (method !== 'POST') return new Response('not mocked', { status: 500 });
      if (archived) return ctx.refused(409, 'Campaign is archived');
      const parsed = noteRequestSchema.safeParse(rawBody);
      if (!parsed.success) return ctx.invalid(parsed.error.issues);
      const at = now();
      const note: StoredNote = {
        id: id(),
        body: parsed.data.body,
        author: author(),
        createdAt: at,
        updatedAt: at,
        ...subject,
      };
      notes.push(note);
      return Response.json(strip(note), { status: 201 });
    }
  }

  return { respond };
}
