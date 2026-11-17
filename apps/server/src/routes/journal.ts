/**
 * The player journal (F3.5, governance §7): revealed records as players read them, the players'
 * own entries, and the notes on both. Every member may use these, the GM included; what each
 * may change is decided in `campaigns/notes.ts`. Writes are refused while the campaign is
 * archived. Every route here is campaign-scoped: see the isolation table in
 * `campaigns.int.test.ts`.
 *
 * GET    …/journal/records                      revealed records (`type`, `q`)
 * GET    …/journal/records/:recordId            one, its public layer
 * GET    …/journal/records/:recordId/notes      its notes, newest first
 * POST   …/journal/records/:recordId/notes      a new note
 * GET    …/journal/entries                      player entries, newest first
 * POST   …/journal/entries                      a new entry (players only)
 * GET    …/journal/entries/:entryId             one
 * PATCH  …/journal/entries/:entryId             its author changes it
 * DELETE …/journal/entries/:entryId             its author or the GM deletes it
 * GET    …/journal/entries/:entryId/notes       its notes
 * POST   …/journal/entries/:entryId/notes       a new note
 * PATCH  …/notes/:noteId                        its author changes it
 * DELETE …/notes/:noteId                        its author or the GM deletes it
 *
 * Each change tells the live room, so the binder at the table reads the journal again.
 */
import {
  createEntryRequestSchema,
  journalRecordListQuerySchema,
  noteRequestSchema,
  updateEntryRequestSchema,
  type JournalRecordListResponse,
  type PlayerEntryListResponse,
  type PlayerNoteListResponse,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { getJournalRecord, listJournalRecords, RECORD_NOT_FOUND } from '../campaigns/journal';
import {
  createEntry,
  createNote,
  deleteEntry,
  deleteNote,
  ENTRY_NOT_FOUND,
  getEntry,
  listEntries,
  listNotes,
  NOTE_NOT_FOUND,
  updateEntry,
  updateNote,
  type NoteSubject,
} from '../campaigns/notes';
import { assertWritable } from '../campaigns/scope';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';
import type { PlayLive } from '../play/socket';

export function registerJournalRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database; live: PlayLive },
): void {
  const { db, live } = deps;
  const preHandler = memberOnly(deps.auth, db);
  const base = '/api/campaigns/:campaignId';
  const recordId = (request: FastifyRequest) => uuidParam(request, 'recordId', RECORD_NOT_FOUND);
  const entryId = (request: FastifyRequest) => uuidParam(request, 'entryId', ENTRY_NOT_FOUND);
  const noteId = (request: FastifyRequest) => uuidParam(request, 'noteId', NOTE_NOT_FOUND);

  app.get(`${base}/journal/records`, { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    const query = journalRecordListQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error);
    const response: JournalRecordListResponse = {
      records: await listJournalRecords(db, scope, query.data),
    };
    return response;
  });

  app.get(`${base}/journal/records/:recordId`, { preHandler }, async (request) =>
    getJournalRecord(db, campaignOf(request), recordId(request)),
  );

  app.get(`${base}/journal/entries`, { preHandler }, async (request) => {
    const response: PlayerEntryListResponse = {
      entries: await listEntries(db, campaignOf(request)),
    };
    return response;
  });

  app.post(`${base}/journal/entries`, { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertWritable(scope);
    const parsed = createEntryRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const entry = await createEntry(db, scope, parsed.data);
    live.journalChanged(scope.campaignId);
    return reply.code(201).send(entry);
  });

  app.get(`${base}/journal/entries/:entryId`, { preHandler }, async (request) =>
    getEntry(db, campaignOf(request), entryId(request)),
  );

  app.patch(`${base}/journal/entries/:entryId`, { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertWritable(scope);
    const id = entryId(request);
    const parsed = updateEntryRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const entry = await updateEntry(db, scope, id, parsed.data);
    live.journalChanged(scope.campaignId);
    return entry;
  });

  app.delete(`${base}/journal/entries/:entryId`, { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertWritable(scope);
    await deleteEntry(db, scope, entryId(request));
    live.journalChanged(scope.campaignId);
    return reply.code(204).send();
  });

  // The notes on a record, and on an entry: the same two routes each.
  for (const [path, subjectOf] of [
    [`${base}/journal/records/:recordId/notes`, (request) => ({ recordId: recordId(request) })],
    [`${base}/journal/entries/:entryId/notes`, (request) => ({ entryId: entryId(request) })],
  ] as const satisfies readonly (readonly [string, (request: FastifyRequest) => NoteSubject])[]) {
    app.get(path, { preHandler }, async (request) => {
      const response: PlayerNoteListResponse = {
        notes: await listNotes(db, campaignOf(request), subjectOf(request)),
      };
      return response;
    });

    app.post(path, { preHandler }, async (request, reply) => {
      const scope = campaignOf(request);
      assertWritable(scope);
      const subject = subjectOf(request);
      const parsed = noteRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      const note = await createNote(db, scope, subject, parsed.data.body);
      live.journalChanged(scope.campaignId);
      return reply.code(201).send(note);
    });
  }

  app.patch(`${base}/notes/:noteId`, { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertWritable(scope);
    const id = noteId(request);
    const parsed = noteRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const note = await updateNote(db, scope, id, parsed.data.body);
    live.journalChanged(scope.campaignId);
    return note;
  });

  app.delete(`${base}/notes/:noteId`, { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertWritable(scope);
    await deleteNote(db, scope, noteId(request));
    live.journalChanged(scope.campaignId);
    return reply.code(204).send();
  });
}
