/**
 * Links between records (F1.5, D-24): the §8 link fields (`kind = 'field'`), extra links
 * with a relationship label (`'other'`) and the @-mentions in a record's text
 * (`'mention'`). Backlinks are the same rows read by `to_record_id`.
 *
 * Which record types a link field accepts, and whether it holds one or many, depend on the
 * shared `RECORD_FIELD_SPECS`, so the data layer checks those (as with the ruleset, D-23).
 * The table checks what never changes: both ends in the same campaign, no self links, and
 * the columns each kind uses.
 *
 * Only the data-access layer in `src/campaigns/` queries this table.
 */
import { RECORD_LINK_KINDS } from '@stagehand/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { campaigns } from './campaigns';
import { records } from './records';

export const recordLinkKind = pgEnum('record_link_kind', RECORD_LINK_KINDS);

export const recordLinks = pgTable(
  'record_links',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    fromRecordId: uuid('from_record_id').notNull(),
    toRecordId: uuid('to_record_id').notNull(),
    kind: recordLinkKind('kind').notNull(),
    /** The source's link field, for `field` links only. */
    fieldKey: text('field_key'),
    /** The relationship ("rival of"), for `other` links only; optional there. */
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    /**
     * Both ends are records of the link's campaign. Deleting either record deletes the
     * link: the whole row goes, so CASCADE on a composite key is safe here.
     */
    foreignKey({
      name: 'record_links_from_fk',
      columns: [table.fromRecordId, table.campaignId],
      foreignColumns: [records.id, records.campaignId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'record_links_to_fk',
      columns: [table.toRecordId, table.campaignId],
      foreignColumns: [records.id, records.campaignId],
    }).onDelete('cascade'),
    /** Outgoing links and the cascade from the source. */
    index('record_links_from_record_id_idx').on(table.fromRecordId),
    /** Backlinks and the cascade from the target. */
    index('record_links_to_record_id_idx').on(table.toRecordId),
    uniqueIndex('record_links_field_unique')
      .on(table.fromRecordId, table.fieldKey, table.toRecordId)
      .where(sql`${table.kind} = 'field'`),
    uniqueIndex('record_links_other_unique')
      .on(table.fromRecordId, table.toRecordId)
      .where(sql`${table.kind} = 'other'`),
    uniqueIndex('record_links_mention_unique')
      .on(table.fromRecordId, table.toRecordId)
      .where(sql`${table.kind} = 'mention'`),
    check('record_links_no_self', sql`${table.fromRecordId} <> ${table.toRecordId}`),
    check(
      'record_links_field_key_only_fields',
      sql`(${table.kind} = 'field') = (${table.fieldKey} is not null)`,
    ),
    check('record_links_label_only_other', sql`${table.kind} = 'other' or ${table.label} is null`),
    check(
      'record_links_label_length',
      sql`${table.label} is null or char_length(${table.label}) between 1 and 60`,
    ),
  ],
);
