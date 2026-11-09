import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';

import { compose, run } from './docker';

/** Exact row count of every table in our schemas: "schema.table" → rows. */
export type TableCounts = Record<string, number>;

/**
 * One query that counts every base table in `public` and `drizzle`, so new tables are
 * covered without editing this list.
 */
const COUNT_ALL_TABLES = `
  select table_schema || '.' || table_name || '|' ||
    (xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
  where table_schema in ('public', 'drizzle') and table_type = 'BASE TABLE'
  order by 1`;

function parseCounts(stdout: string): TableCounts {
  const counts: TableCounts = {};
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const [table, count] = line.split('|');
    if (table && count) counts[table] = Number(count);
  }
  return counts;
}

export interface PgTarget {
  user: string;
  db: string;
}

/** Row counts and server version of the stack's production database. */
export async function inspectStackDatabase(
  envFile: string,
  target: PgTarget,
): Promise<{ counts: TableCounts; serverVersion: string }> {
  const psql = (sql: string) =>
    compose(envFile, [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      target.user,
      '-d',
      target.db,
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ]);
  const counts = parseCounts((await psql(COUNT_ALL_TABLES)).stdout);
  const serverVersion = (await psql('show server_version')).stdout.trim();
  return { counts, serverVersion };
}

/** pg_dump (custom format: compressed, restorable with pg_restore) straight to a file. */
export async function dumpStackDatabase(
  envFile: string,
  target: PgTarget,
  outPath: string,
): Promise<void> {
  const out = createWriteStream(outPath);
  try {
    await compose(
      envFile,
      ['exec', '-T', 'postgres', 'pg_dump', '-Fc', '-U', target.user, '-d', target.db],
      {
        stdout: out,
      },
    );
  } finally {
    out.end();
    await finished(out);
  }
}

/**
 * Restores a dump into a throwaway Postgres container (no volume, removed afterwards) and
 * returns the restored database's row counts: the honest test that a backup is usable.
 */
export async function restoreIntoThrowawayDatabase(
  image: string,
  dumpPath: string,
): Promise<TableCounts> {
  const name = `stagehand-restore-drill-${randomBytes(4).toString('hex')}`;
  await run('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '-e',
    'POSTGRES_USER=drill',
    '-e',
    'POSTGRES_PASSWORD=drill',
    '-e',
    'POSTGRES_DB=drill',
    image,
  ]);

  try {
    await waitForPostgres(name);
    await run(
      'docker',
      [
        'exec',
        '-i',
        name,
        'pg_restore',
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        '-U',
        'drill',
        '-d',
        'drill',
      ],
      { stdin: createReadStream(dumpPath) },
    );
    const { stdout } = await run('docker', [
      'exec',
      name,
      'psql',
      '-U',
      'drill',
      '-d',
      'drill',
      '-tA',
      '-c',
      COUNT_ALL_TABLES,
    ]);
    return parseCounts(stdout);
  } finally {
    await run('docker', ['rm', '-f', name], { allowFailure: true });
  }
}

async function waitForPostgres(container: string): Promise<void> {
  // Over TCP: the image's init phase runs a socket-only server first, then restarts it.
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await run(
      'docker',
      ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'drill', '-d', 'drill'],
      {
        allowFailure: true,
      },
    );
    if (result.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Throwaway Postgres (${container}) did not become ready in 30 seconds`);
}

/** Differences between two count maps, as readable lines (empty when they match). */
export function compareCounts(expected: TableCounts, actual: TableCounts): string[] {
  const tables = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return tables
    .filter((table) => expected[table] !== actual[table])
    .map(
      (table) =>
        `${table}: expected ${String(expected[table] ?? 'missing')}, got ${String(actual[table] ?? 'missing')}`,
    );
}
