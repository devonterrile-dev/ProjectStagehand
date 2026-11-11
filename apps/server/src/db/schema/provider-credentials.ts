/**
 * GMs' own AI provider keys (F1.7, governance §8 and §14, D-26). User-scoped, not campaign-
 * scoped: one key per user per provider, used for every campaign they run.
 *
 * `encrypted_key` is `credentials/crypto.ts` output (AES-256-GCM, bound to the user and
 * provider); the master key lives only in CREDENTIALS_ENCRYPTION_KEY. `last_four` is the
 * only part of a key the browser ever sees.
 */
import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const providerCredentials = pgTable(
  'provider_credentials',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['anthropic', 'openrouter'] }).notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    lastFour: text('last_four').notNull(),
    /** When the current key was saved; replacing a key resets it. */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.provider] }),
    check(
      'provider_credentials_provider_check',
      sql`${table.provider} IN ('anthropic', 'openrouter')`,
    ),
    check('provider_credentials_last_four_check', sql`char_length(${table.lastFour}) = 4`),
    check('provider_credentials_encrypted_key_check', sql`${table.encryptedKey} LIKE 'v1.%'`),
  ],
);
