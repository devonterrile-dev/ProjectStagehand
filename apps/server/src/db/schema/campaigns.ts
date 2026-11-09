/**
 * Campaigns and their members (F1.1). Governance §7 (roles, isolation) and §8.
 *
 * Only `src/campaigns/scope.ts` queries these tables: routes go through that data-access layer.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.campaignId, table.userId] }),
    index('campaign_members_user_id_idx').on(table.userId),
    /** D-14: at most one GM per campaign, enforced by the database. */
    uniqueIndex('campaign_members_one_gm_idx')
      .on(table.campaignId)
      .where(sql`${table.role} = 'gm'`),
  ],
);
