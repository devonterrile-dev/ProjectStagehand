/**
 * Campaign invite links (F1.2, governance §7). Reusable, optionally expiring, revocable
 * (D-21). The code is the credential, so it's long and random.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { campaigns } from './campaigns';

export const invites = pgTable(
  'invites',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** 16 random bytes, base64url (22 characters). Stored as-is so the GM can copy it again. */
    code: text('code').notNull().unique(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Null = never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Null = active. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('invites_campaign_id_idx').on(table.campaignId)],
);
