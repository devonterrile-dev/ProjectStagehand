/**
 * Vitest globalSetup for integration tests (governance §15: "Vitest + test Postgres").
 *
 * Creates a throwaway database, applies every migration through the real runner, hands its
 * URL to the tests via `inject('databaseUrl')`, and drops it afterwards.
 *
 * Needs a Postgres the admin URL can create databases on:
 *   - locally: `pnpm db:up` (the default URL below points at it)
 *   - CI: a Postgres service container, via TEST_DATABASE_ADMIN_URL
 */
import { randomBytes } from 'node:crypto';

import pg from 'pg';
import type { TestProject } from 'vitest/node';

import { runMigrations } from '../src/db/migrate';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string of this run's freshly migrated test database. */
    databaseUrl: string;
  }
}

const DEFAULT_ADMIN_URL = 'postgres://stagehand:stagehand@127.0.0.1:5432/postgres';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'] ?? DEFAULT_ADMIN_URL;
  const dbName = `stagehand_test_${String(Date.now())}_${randomBytes(3).toString('hex')}`;

  await withAdmin(adminUrl, (client) => client.query(`create database ${dbName}`));

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const databaseUrl = url.toString();

  try {
    await runMigrations(databaseUrl);
  } catch (error) {
    await dropDatabase(adminUrl, dbName);
    throw error;
  }

  project.provide('databaseUrl', databaseUrl);

  return async () => {
    await dropDatabase(adminUrl, dbName);
  };
}

async function dropDatabase(adminUrl: string, dbName: string): Promise<void> {
  await withAdmin(adminUrl, (client) =>
    client.query(`drop database if exists ${dbName} with (force)`),
  );
}

async function withAdmin(adminUrl: string, run: (client: pg.Client) => Promise<unknown>) {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Integration tests need Postgres at ${redact(adminUrl)} (${reason}).\n` +
        'Start the dev database with `pnpm db:up`, or set TEST_DATABASE_ADMIN_URL.',
      { cause: error },
    );
  }
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

function redact(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.password !== '') url.password = '***';
  return url.toString();
}
