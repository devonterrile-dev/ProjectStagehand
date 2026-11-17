/**
 * Player entries and the notes on records and entries (F3.5, governance §7). Part of the
 * campaign data-access layer: every query is scoped to `scope.campaignId`.
 *
 * Rules:
 * - Any member reads every entry, and every note on a revealed record or an entry.
 * - Only players make entries. Anyone may note a revealed record or an entry.
 * - Only the author edits a note or an entry; the author or the GM deletes one.
 *
 * Callers check `assertWritable` before a write.
 */
import {
  FORMER_PLAYER,
  playerEntrySchema,
  playerNoteSchema,
  type PlayerEntry,
  type PlayerNote,
} from '@stagehand/shared';
import { and, desc, eq, type SQL } from 'drizzle-orm';

import { playerEntries, playerNotes, users } from '../db/schema';
import { httpError } from '../http/errors';
import { shownName } from '../users/profile';

import { requireRevealedRecord } from './journal';
import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

export const ENTRY_NOT_FOUND = 'Entry not found';
export const NOTE_NOT_FOUND = 'Note not found';
const ONLY_AUTHOR_EDITS = 'Only its author can change that';
const ONLY_AUTHOR_OR_GM = 'Only its author or the GM can delete that';

/** What a note or an entry is on: a revealed record, or a player entry. */
export type NoteSubject = { recordId: string } | { entryId: string };

const author = { userId: users.id, name: users.name, displayName: users.displayName };

function authorOf(row: { userId: string | null; name: string | null; displayName: string | null }) {
  return row.userId === null || row.name === null
    ? { userId: null, displayName: FORMER_PLAYER }
    : {
        userId: row.userId,
        displayName: shownName({ name: row.name, displayName: row.displayName }),
      };
}

function toEntry(row: {
  entry: typeof playerEntries.$inferSelect;
  author: { userId: string | null; name: string | null; displayName: string | null } | null;
}): PlayerEntry {
  return playerEntrySchema.parse({
    id: row.entry.id,
    title: row.entry.title,
    description: row.entry.description,
    author: authorOf(row.author ?? { userId: null, name: null, displayName: null }),
    createdAt: row.entry.createdAt.toISOString(),
    updatedAt: row.entry.updatedAt.toISOString(),
  });
}

function toNote(row: {
  note: typeof playerNotes.$inferSelect;
  author: { userId: string | null; name: string | null; displayName: string | null } | null;
}): PlayerNote {
  return playerNoteSchema.parse({
    id: row.note.id,
    body: row.note.body,
    author: authorOf(row.author ?? { userId: null, name: null, displayName: null }),
    createdAt: row.note.createdAt.toISOString(),
    updatedAt: row.note.updatedAt.toISOString(),
  });
}

// --- Entries -----------------------------------------------------------------------------

function entryScoped(scope: CampaignScope, entryId: string) {
  return and(eq(playerEntries.campaignId, scope.campaignId), eq(playerEntries.id, entryId));
}

async function entryRows(db: DbOrTx, where: SQL | undefined) {
  return db
    .select({ entry: playerEntries, author })
    .from(playerEntries)
    .leftJoin(users, eq(users.id, playerEntries.authorUserId))
    .where(where)
    .orderBy(desc(playerEntries.createdAt), desc(playerEntries.id));
}

/** The campaign's player entries, newest first. */
export async function listEntries(db: DbOrTx, scope: CampaignScope): Promise<PlayerEntry[]> {
  const rows = await entryRows(db, eq(playerEntries.campaignId, scope.campaignId));
  return rows.map(toEntry);
}

export async function getEntry(
  db: DbOrTx,
  scope: CampaignScope,
  entryId: string,
): Promise<PlayerEntry> {
  const [row] = await entryRows(db, entryScoped(scope, entryId));
  if (row === undefined) throw httpError(404, ENTRY_NOT_FOUND);
  return toEntry(row);
}

/** A new entry by the scope's player. The GM keeps records instead, so 403 for the GM. */
export async function createEntry(
  db: DbOrTx,
  scope: CampaignScope,
  input: { title: string; description: string },
): Promise<PlayerEntry> {
  if (scope.role === 'gm') throw httpError(403, 'Player entries are for players');
  const [row] = await db
    .insert(playerEntries)
    .values({
      campaignId: scope.campaignId,
      authorUserId: scope.userId,
      title: input.title,
      description: input.description,
    })
    .returning({ id: playerEntries.id });
  if (row === undefined) throw new Error('entry insert returned no row');
  return getEntry(db, scope, row.id);
}

/** The entry's author and campaign, or 404. */
async function entryAuthor(db: DbOrTx, scope: CampaignScope, entryId: string) {
  const [row] = await db
    .select({ authorUserId: playerEntries.authorUserId })
    .from(playerEntries)
    .where(entryScoped(scope, entryId));
  if (row === undefined) throw httpError(404, ENTRY_NOT_FOUND);
  return row.authorUserId;
}

export async function updateEntry(
  db: DbOrTx,
  scope: CampaignScope,
  entryId: string,
  patch: { title?: string | undefined; description?: string | undefined },
): Promise<PlayerEntry> {
  if ((await entryAuthor(db, scope, entryId)) !== scope.userId) {
    throw httpError(403, ONLY_AUTHOR_EDITS);
  }
  await db
    .update(playerEntries)
    .set({
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
    })
    .where(entryScoped(scope, entryId));
  return getEntry(db, scope, entryId);
}

/** Deletes the entry and its notes. */
export async function deleteEntry(
  db: DbOrTx,
  scope: CampaignScope,
  entryId: string,
): Promise<void> {
  const authorId = await entryAuthor(db, scope, entryId);
  if (authorId !== scope.userId && scope.role !== 'gm') throw httpError(403, ONLY_AUTHOR_OR_GM);
  await db.delete(playerEntries).where(entryScoped(scope, entryId));
}

// --- Notes -------------------------------------------------------------------------------

/** 404 unless the subject is a revealed record or an entry of this campaign. */
async function requireSubject(db: DbOrTx, scope: CampaignScope, subject: NoteSubject) {
  if ('recordId' in subject) {
    await requireRevealedRecord(db, scope, subject.recordId);
  } else {
    await entryAuthor(db, scope, subject.entryId);
  }
}

function onSubject(subject: NoteSubject) {
  return 'recordId' in subject
    ? eq(playerNotes.recordId, subject.recordId)
    : eq(playerNotes.entryId, subject.entryId);
}

function noteScoped(scope: CampaignScope, noteId: string) {
  return and(eq(playerNotes.campaignId, scope.campaignId), eq(playerNotes.id, noteId));
}

async function noteRows(db: DbOrTx, where: SQL | undefined) {
  return db
    .select({ note: playerNotes, author })
    .from(playerNotes)
    .leftJoin(users, eq(users.id, playerNotes.authorUserId))
    .where(where)
    .orderBy(desc(playerNotes.createdAt), desc(playerNotes.id));
}

/** The subject's notes, newest first. */
export async function listNotes(
  db: DbOrTx,
  scope: CampaignScope,
  subject: NoteSubject,
): Promise<PlayerNote[]> {
  await requireSubject(db, scope, subject);
  const rows = await noteRows(
    db,
    and(eq(playerNotes.campaignId, scope.campaignId), onSubject(subject)),
  );
  return rows.map(toNote);
}

export async function createNote(
  db: DbOrTx,
  scope: CampaignScope,
  subject: NoteSubject,
  body: string,
): Promise<PlayerNote> {
  await requireSubject(db, scope, subject);
  const [row] = await db
    .insert(playerNotes)
    .values({
      campaignId: scope.campaignId,
      ...('recordId' in subject ? { recordId: subject.recordId } : { entryId: subject.entryId }),
      authorUserId: scope.userId,
      body,
    })
    .returning({ id: playerNotes.id });
  if (row === undefined) throw new Error('note insert returned no row');
  return getNote(db, scope, row.id);
}

async function getNote(db: DbOrTx, scope: CampaignScope, noteId: string): Promise<PlayerNote> {
  const [row] = await noteRows(db, noteScoped(scope, noteId));
  if (row === undefined) throw httpError(404, NOTE_NOT_FOUND);
  return toNote(row);
}

/**
 * The note's author, or 404. A note on a record players no longer have is answered as if it
 * didn't exist, for the GM too: it comes back if the record is revealed again.
 */
async function noteAuthor(db: DbOrTx, scope: CampaignScope, noteId: string) {
  const [row] = await db
    .select({
      authorUserId: playerNotes.authorUserId,
      recordId: playerNotes.recordId,
    })
    .from(playerNotes)
    .where(noteScoped(scope, noteId));
  if (row === undefined) throw httpError(404, NOTE_NOT_FOUND);
  if (row.recordId !== null) {
    try {
      await requireRevealedRecord(db, scope, row.recordId);
    } catch {
      throw httpError(404, NOTE_NOT_FOUND);
    }
  }
  return row.authorUserId;
}

export async function updateNote(
  db: DbOrTx,
  scope: CampaignScope,
  noteId: string,
  body: string,
): Promise<PlayerNote> {
  if ((await noteAuthor(db, scope, noteId)) !== scope.userId) {
    throw httpError(403, ONLY_AUTHOR_EDITS);
  }
  await db.update(playerNotes).set({ body }).where(noteScoped(scope, noteId));
  return getNote(db, scope, noteId);
}

export async function deleteNote(db: DbOrTx, scope: CampaignScope, noteId: string): Promise<void> {
  const authorId = await noteAuthor(db, scope, noteId);
  if (authorId !== scope.userId && scope.role !== 'gm') throw httpError(403, ONLY_AUTHOR_OR_GM);
  await db.delete(playerNotes).where(noteScoped(scope, noteId));
}
