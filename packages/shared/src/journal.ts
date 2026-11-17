/**
 * The player journal (F3.5, governance §7): the revealed records every member of a campaign may
 * read, the players' own entries, and the notes anyone leaves on either. Everything here is what
 * a player's browser may hold: the public layer of a record and nothing else.
 */
import { z } from 'zod';

import { recordTypeSchema } from './record-fields';
import { RECORD_NAME_MAX } from './records';
import { SEARCH_QUERY_MAX } from './record-search';
import { recordRichTextSchema } from './rich-text';
import { stageImageSchema } from './scenes';

const timestamp = z.iso.datetime({ offset: true });

/** Longest note: it has to fit on a sticky note at the table. */
export const NOTE_BODY_MAX = 500;
/** Longest player entry description. */
export const ENTRY_DESCRIPTION_MAX = 4000;
/** An entry's title: as long as a record name. */
export const ENTRY_TITLE_MAX = RECORD_NAME_MAX;
/** What a note or entry shows when its author's account is gone (§14). */
export const FORMER_PLAYER = 'Former player';

/**
 * Plain text from a textarea: line endings made `\n`, trailing spaces and blank lines trimmed
 * from both ends. Line breaks inside are kept.
 */
function plainText(max: number, label: string, min: number) {
  return z
    .string()
    .transform((text) => text.replace(/\r\n?/g, '\n').trim())
    .pipe(
      z
        .string()
        .min(min, `${label} cannot be empty`)
        .max(max, `${label} must be ${String(max)} characters or fewer`),
    );
}

export const noteBodySchema = plainText(NOTE_BODY_MAX, 'A note', 1);
export const entryTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title cannot be empty')
  .max(ENTRY_TITLE_MAX, `Title must be ${String(ENTRY_TITLE_MAX)} characters or fewer`);
export const entryDescriptionSchema = plainText(ENTRY_DESCRIPTION_MAX, 'The description', 0);

/** Who wrote a note or an entry. `userId` is null once their account is gone. */
export const journalAuthorSchema = z.object({
  userId: z.uuid().nullable(),
  displayName: z.string(),
});
export type JournalAuthor = z.infer<typeof journalAuthorSchema>;

/** A revealed record in a list. */
export const journalRecordSummarySchema = z.object({
  id: z.uuid(),
  type: recordTypeSchema,
  name: z.string(),
  /** A Spot's Area, only when that Area is revealed too. */
  parentName: z.string().nullable(),
  revealedAt: timestamp,
});
export type JournalRecordSummary = z.infer<typeof journalRecordSummarySchema>;

/** `GET …/journal/records`: revealed records by name, or by how well they match `q`. */
export const journalRecordListResponseSchema = z.object({
  records: z.array(journalRecordSummarySchema),
});
export type JournalRecordListResponse = z.infer<typeof journalRecordListResponseSchema>;

export const journalRecordListQuerySchema = z.object({
  type: recordTypeSchema.optional(),
  q: z
    .string()
    .trim()
    .max(SEARCH_QUERY_MAX, `Search must be ${String(SEARCH_QUERY_MAX)} characters or fewer`)
    .transform((q) => (q === '' ? undefined : q))
    .optional(),
});
export type JournalRecordListQuery = z.infer<typeof journalRecordListQuerySchema>;

/**
 * A revealed record, as a player reads it: the public layer (§7). Mentions of records the
 * player hasn't been shown are plain text.
 */
export const journalRecordSchema = z.object({
  id: z.uuid(),
  type: recordTypeSchema,
  name: z.string(),
  publicDescription: recordRichTextSchema,
  /** The stage's version of the record's image in use, or null. */
  image: stageImageSchema.nullable(),
  parentName: z.string().nullable(),
  revealedAt: timestamp,
});
export type JournalRecord = z.infer<typeof journalRecordSchema>;

/** A player's own simple record: a title and a description, shared with the campaign. */
export const playerEntrySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  author: journalAuthorSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type PlayerEntry = z.infer<typeof playerEntrySchema>;

export const playerEntryListResponseSchema = z.object({ entries: z.array(playerEntrySchema) });
export type PlayerEntryListResponse = z.infer<typeof playerEntryListResponseSchema>;

export const createEntryRequestSchema = z.strictObject({
  title: entryTitleSchema,
  description: entryDescriptionSchema,
});
export type CreateEntryRequest = z.input<typeof createEntryRequestSchema>;

export const updateEntryRequestSchema = z
  .strictObject({
    title: entryTitleSchema.optional(),
    description: entryDescriptionSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');
export type UpdateEntryRequest = z.input<typeof updateEntryRequestSchema>;

/** A note on a revealed record or a player entry. */
export const playerNoteSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  author: journalAuthorSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type PlayerNote = z.infer<typeof playerNoteSchema>;

/** A record's or entry's notes, newest first. */
export const playerNoteListResponseSchema = z.object({ notes: z.array(playerNoteSchema) });
export type PlayerNoteListResponse = z.infer<typeof playerNoteListResponseSchema>;

export const noteRequestSchema = z.strictObject({ body: noteBodySchema });
export type NoteRequest = z.input<typeof noteRequestSchema>;

/** Whether a note was changed after it was posted. */
export function wasEdited(item: { createdAt: string; updatedAt: string }): boolean {
  return Date.parse(item.updatedAt) - Date.parse(item.createdAt) > 1000;
}
