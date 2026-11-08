import { readMigrationFiles } from 'drizzle-orm/migrator';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createDb, type DbHandle } from './client';
import { countApplied, MIGRATIONS_FOLDER, runMigrations } from './migrate';

// globalSetup has already created this database and applied every migration to it.
const databaseUrl = inject('databaseUrl');

describe('database migrations', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('records every migration in the folder as applied', async () => {
    const inFolder = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length;

    expect(inFolder).toBeGreaterThan(0);
    expect(await countApplied(pool)).toBe(inFolder);
  });

  it('installs pg_trgm (baseline migration)', async () => {
    const result = await pool.query<{ score: number }>(
      "select similarity('Stagehand', 'Stagehands') as score",
    );

    expect(result.rows[0]?.score).toBeGreaterThan(0.5);
  });

  it('is a no-op when run again', async () => {
    const result = await runMigrations(databaseUrl);

    expect(result).toEqual({ total: await countApplied(pool), applied: 0 });
  });
});

describe('createDb', () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDb(databaseUrl, { max: 1 });
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it('queries through Drizzle', async () => {
    const result = await handle.db.execute<{ answer: number }>(sql`select 1 as answer`);

    expect(result.rows).toEqual([{ answer: 1 }]);
  });
});
