/**
 * Data access for GMs' provider keys (F1.7, D-26). The only code that reads or writes
 * `provider_credentials`. Summaries never decrypt; `getProviderKey` is the one place a key
 * is decrypted, in memory, for the outgoing call (F1.8 onwards).
 */
import {
  PROVIDER_KEY_LAST_FOUR,
  providerCredentialSchema,
  type Provider,
  type ProviderCredential,
} from '@stagehand/shared';
import { and, asc, eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { providerCredentials } from '../db/schema';
import { credentialAad, decryptCredential, encryptCredential } from './crypto';

type Row = typeof providerCredentials.$inferSelect;

/** The browser-safe view of a row: provider, last four, date. Nothing else is read. */
function toSummary(row: Pick<Row, 'provider' | 'lastFour' | 'createdAt'>): ProviderCredential {
  return providerCredentialSchema.parse({
    provider: row.provider,
    lastFour: row.lastFour,
    createdAt: row.createdAt.toISOString(),
  });
}

const SUMMARY_COLUMNS = {
  provider: providerCredentials.provider,
  lastFour: providerCredentials.lastFour,
  createdAt: providerCredentials.createdAt,
};

export async function listProviderCredentials(
  db: Database,
  userId: string,
): Promise<ProviderCredential[]> {
  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(providerCredentials)
    .where(eq(providerCredentials.userId, userId))
    .orderBy(asc(providerCredentials.provider));
  return rows.map(toSummary);
}

/** Stores (or replaces) a user's key for a provider. Replacing resets `createdAt`. */
export async function saveProviderKey(
  db: Database,
  masterKey: Buffer,
  userId: string,
  provider: Provider,
  apiKey: string,
): Promise<ProviderCredential> {
  const encryptedKey = encryptCredential(masterKey, apiKey, credentialAad(userId, provider));
  const lastFour = apiKey.slice(-PROVIDER_KEY_LAST_FOUR);
  const now = new Date();
  const [row] = await db
    .insert(providerCredentials)
    .values({ userId, provider, encryptedKey, lastFour, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [providerCredentials.userId, providerCredentials.provider],
      set: { encryptedKey, lastFour, createdAt: now, updatedAt: now },
    })
    .returning(SUMMARY_COLUMNS);
  if (row === undefined) throw new Error('saveProviderKey: upsert returned no row');
  return toSummary(row);
}

/** Removes a user's key for a provider. True when there was one. */
export async function deleteProviderKey(
  db: Database,
  userId: string,
  provider: Provider,
): Promise<boolean> {
  const deleted = await db
    .delete(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, provider)))
    .returning({ provider: providerCredentials.provider });
  return deleted.length > 0;
}

/**
 * The user's decrypted key for a provider, or null when none is stored. Throws
 * CredentialUnreadableError when the stored value can't be decrypted (master key changed,
 * row altered); the GM then needs to enter the key again. Server-side only: the result must
 * go straight into the outgoing request, never into a response or a log.
 */
export async function getProviderKey(
  db: Database,
  masterKey: Buffer,
  userId: string,
  provider: Provider,
): Promise<string | null> {
  const [row] = await db
    .select({ encryptedKey: providerCredentials.encryptedKey })
    .from(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, provider)));
  if (row === undefined) return null;
  return decryptCredential(masterKey, row.encryptedKey, credentialAad(userId, provider));
}
