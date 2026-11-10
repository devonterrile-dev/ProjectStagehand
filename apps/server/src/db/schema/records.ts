/**
 * Narrative records (F1.3, governance §8): NPCs, areas, spots, factions, lore, story beats,
 * items and session notes in one table. The common columns are here; the type-specific
 * fields are a JSON column validated by the type's Zod schema in `@stagehand/shared`, so a
 * new type is a schema change, not a migration.
 *
 * Deferred columns: `visual_asset_id` arrives with assets (F2.x) and `stat_block_id` with
 * stat blocks (F1.4). `revealed_at` exists now, but nothing sets it until the reveal flow
 * (F3.5); every record route is GM-only until then.
 *
 * Only the data-access layer in `src/campaigns/` queries this table.
 */
import { RECORD_SOURCES, RECORD_TYPES, type RichText } from '@stagehand/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { campaigns } from './campaigns';

export const recordType = pgEnum('record_type', RECORD_TYPES);
export const recordSource = pgEnum('record_source', RECORD_SOURCES);

export const records = pgTable(
  'records',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    type: recordType('type').notNull(),
    /** Public. */
    name: text('name').notNull(),
    /** Public once revealed. Rich text (D-22); the data layer stores an empty doc, never null. */
    publicDescription: jsonb('public_description').$type<RichText>().notNull(),
    /** Private, free-form. Rich text (D-22). */
    gmNotes: jsonb('gm_notes').$type<RichText>().notNull(),
    /** Private, type-specific; its shape is `fieldsSchemaFor(type)` in the shared package. */
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
    /** The Area a Spot belongs to (D-15). Null for every other type (check below). */
    parentId: uuid('parent_id'),
    /** Null = hidden from players. */
    revealedAt: timestamp('revealed_at', { withTimezone: true }),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: recordSource('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    /** Its leading column also serves plain campaign lookups, so there's no separate index. */
    index('records_campaign_id_type_idx').on(table.campaignId, table.type),
    index('records_parent_id_idx').on(table.parentId),
    /** Target of the parent FK below. */
    unique('records_id_campaign_id_unique').on(table.id, table.campaignId),
    /**
     * A Spot's Area must be in the same campaign. Left as NO ACTION (checked at statement
     * end) rather than RESTRICT, so a cascading campaign delete can remove areas and their
     * spots in one statement. The data layer refuses to delete an area that still has spots.
     */
    foreignKey({
      name: 'records_parent_fk',
      columns: [table.parentId, table.campaignId],
      foreignColumns: [table.id, table.campaignId],
    }),
    /** Spots always have a parent; nothing else ever does (D-15). */
    check(
      'records_parent_only_spots',
      sql`(${table.type} = 'spot') = (${table.parentId} is not null)`,
    ),
    check('records_name_length', sql`char_length(${table.name}) between 1 and 120`),
  ],
);
