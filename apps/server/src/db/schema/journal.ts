/**
 * The player journal's own tables (F3.5, governance §7, §8): the players' entries, and the
 * notes anyone in the campaign leaves on a revealed record or an entry.
 *
 * Authors are kept as a user id that becomes null if the account is ever deleted; the note or
 * entry then shows "Former player" (§14).
 *
 * Only the data-access layer in `src/campaigns/` queries these tables.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { campaigns } from './campaigns';
import { records } from './records';

/** A player's own simple record: a title and a plain text description, seen by everyone. */
export const playerEntries = pgTable(
  'player_entries',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** Plain text; line breaks kept. */
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('player_entries_campaign_id_idx').on(table.campaignId),
    index('player_entries_author_user_id_idx').on(table.authorUserId),
    /** Target of the notes' entry FK. */
    unique('player_entries_id_campaign_id_unique').on(table.id, table.campaignId),
    check('player_entries_title_length', sql`char_length(${table.title}) between 1 and 120`),
    check('player_entries_description_length', sql`char_length(${table.description}) <= 4000`),
  ],
);

/**
 * A note on a record or on a player entry, never both. Players see a record's notes only while
 * the record is revealed; an un-reveal keeps them for when it comes back.
 */
export const playerNotes = pgTable(
  'player_notes',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id'),
    entryId: uuid('entry_id'),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Plain text; line breaks kept. */
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    /** The note's record or entry is in its campaign; deleting it deletes the note. */
    foreignKey({
      name: 'player_notes_record_fk',
      columns: [table.recordId, table.campaignId],
      foreignColumns: [records.id, records.campaignId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'player_notes_entry_fk',
      columns: [table.entryId, table.campaignId],
      foreignColumns: [playerEntries.id, playerEntries.campaignId],
    }).onDelete('cascade'),
    /** A record's or entry's notes, newest first, and the cascades. */
    index('player_notes_record_created_idx').on(table.recordId, table.createdAt.desc()),
    index('player_notes_entry_created_idx').on(table.entryId, table.createdAt.desc()),
    index('player_notes_campaign_id_idx').on(table.campaignId),
    index('player_notes_author_user_id_idx').on(table.authorUserId),
    check(
      'player_notes_one_subject',
      sql`(${table.recordId} is null) <> (${table.entryId} is null)`,
    ),
    check('player_notes_body_length', sql`char_length(${table.body}) between 1 and 500`),
  ],
);
