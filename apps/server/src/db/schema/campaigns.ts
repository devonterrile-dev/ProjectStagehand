/**
 * Campaigns, their members (F1.1) and player characters (F1.2). Governance §7 and §8.
 * `characters` lives here because it and `campaign_members` reference each other.
 *
 * Only the data-access layer in `src/campaigns/` queries these tables.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';

export const campaignRole = pgEnum('campaign_role', ['gm', 'player']);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    name: text('name').notNull(),
    /** The campaign's one GM (D-14). Also present as a `gm` row in `campaign_members`. */
    gmUserId: uuid('gm_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    rulesetVersion: integer('ruleset_version').default(1).notNull(),
    /** Null = active. Set = archived, which makes the campaign read-only (D-20). */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('campaigns_gm_user_id_idx').on(table.gmUserId),
    check('campaigns_name_length', sql`char_length(${table.name}) between 1 and 80`),
  ],
);

export const campaignMembers = pgTable(
  'campaign_members',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: campaignRole('role').notNull(),
    /** The player's PC in this campaign (F1.2). Null for the GM and for players without one. */
    characterId: uuid('character_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.campaignId, table.userId] }),
    /** A PC can only be assigned within its own campaign. */
    foreignKey({
      name: 'campaign_members_character_fk',
      columns: [table.characterId, table.campaignId],
      foreignColumns: [characters.id, characters.campaignId],
    }),
    /** One player per PC (one PC per player follows from the single column). */
    uniqueIndex('campaign_members_character_id_idx').on(table.characterId),
    /** Only players hold a PC. */
    check(
      'campaign_members_pc_players_only',
      sql`${table.role} = 'player' or ${table.characterId} is null`,
    ),
    index('campaign_members_user_id_idx').on(table.userId),
    /** D-14: at most one GM per campaign, enforced by the database. */
    uniqueIndex('campaign_members_one_gm_idx')
      .on(table.campaignId)
      .where(sql`${table.role} = 'gm'`),
  ],
);

/**
 * Player characters (F1.2: just a name). F1.4 extends this table into the full character
 * sheet. Which player has it is `campaign_members.character_id` (D-21).
 */
export const characters = pgTable(
  'characters',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('characters_campaign_id_idx').on(table.campaignId),
    /** Target of the composite FK from `campaign_members`. */
    unique('characters_id_campaign_id_unique').on(table.id, table.campaignId),
    check('characters_name_length', sql`char_length(${table.name}) between 1 and 80`),
  ],
);
