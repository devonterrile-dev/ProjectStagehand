import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

import { createDb } from './client';

/** Generated SQL migrations (apps/server/drizzle; /app/drizzle in the image). */
export const MIGRATIONS_FOLDER = resolveMigrationsFolder();

function resolveMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Bundled: <pkg>/dist/migrate.js. From source (tsx, tests): <pkg>/src/db/migrate.ts.
  return here.endsWith('dist') ? join(here, '..', 'drizzle') : join(here, '..', '..', 'drizzle');
}

export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

export interface MigrationResult {
  /** Migrations present in the migrations folder. */
  total: number;
  /** Migrations applied by this run. */
  applied: number;
}

/**
 * Applies all pending migrations, in order, inside a transaction. Safe to re-run: already
 * applied migrations are skipped. Uses its own single-connection pool, always closed.
 */
export async function runMigrations(
  databaseUrl: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<MigrationResult> {
  const total = readMigrationFiles({ migrationsFolder }).length;
  const { db, pool } = createDb(databaseUrl, { max: 1 });

  try {
    const before = await countApplied(pool);
    await migrate(db, {
      migrationsFolder,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
    const after = await countApplied(pool);
    return { total, applied: after - before };
  } finally {
    await pool.end();
  }
}

/** Number of migrations recorded as applied; 0 before the first run creates the table. */
export async function countApplied(pool: pg.Pool): Promise<number> {
  const qualified = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;
  const exists = await pool.query<{ exists: boolean }>(
    'select to_regclass($1) is not null as exists',
    [qualified],
  );
  if (exists.rows[0]?.exists !== true) return 0;

  const result = await pool.query<{ count: string }>(`select count(*) as count from ${qualified}`);
  return Number(result.rows[0]?.count ?? 0);
}
