/**
 * Gameplay records (F4.3, governance §8 "Gameplay records", D-58, D-61): domains and domain
 * cards so far; classes, gear and species join them in F4.4 to F4.6. Each type has its own
 * table with real columns, per campaign. Every member reads them; only the GM writes them.
 *
 * Only the data-access layer in `src/campaigns/` queries these tables.
 */
import { DOMAIN_CARD_TYPES, emptyRichText, type RichText } from '@stagehand/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { campaigns } from './campaigns';

/** A campaign's domains. Every campaign starts with the ten defaults (F4.3, 19.26). */
export const domains = pgTable(
  'domains',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Plain text; line breaks kept. */
    description: text('description').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    /** One domain of a name per campaign, whatever its case. */
    uniqueIndex('domains_campaign_name_idx').on(table.campaignId, sql`lower(${table.name})`),
    /** Target of the composite FK from `domain_cards`. */
    unique('domains_id_campaign_id_unique').on(table.id, table.campaignId),
    check('domains_name_length', sql`char_length(${table.name}) between 1 and 60`),
    check('domains_description_length', sql`char_length(${table.description}) <= 2000`),
  ],
);

export const domainCardType = pgEnum('domain_card_type', DOMAIN_CARD_TYPES);

/** A campaign's domain cards, each of one of its domains. */
export const domainCards = pgTable(
  'domain_cards',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** A domain of the same campaign; a domain with cards can't be deleted. */
    domainId: uuid('domain_id').notNull(),
    name: text('name').notNull(),
    /** 1 to 10: the PC must be at least this level to take it. */
    level: integer('level').default(1).notNull(),
    /** The Stress marked to bring it from the vault into the loadout. */
    recallCost: integer('recall_cost').default(0).notNull(),
    type: domainCardType('type').default('ability').notNull(),
    /** The bulk of the card. */
    feature: jsonb('feature').$type<RichText>().default(emptyRichText()).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('domain_cards_campaign_domain_idx').on(table.campaignId, table.domainId),
    /**
     * No action (checked at the end of the statement), not restrict: deleting a campaign removes
     * its domains and cards in one go, while deleting a domain that still has cards is refused.
     */
    foreignKey({
      name: 'domain_cards_domain_fk',
      columns: [table.domainId, table.campaignId],
      foreignColumns: [domains.id, domains.campaignId],
    }),
    check('domain_cards_name_length', sql`char_length(${table.name}) between 1 and 120`),
    check('domain_cards_level', sql`${table.level} between 1 and 10`),
    check('domain_cards_recall_cost', sql`${table.recallCost} between 0 and 99`),
  ],
);
