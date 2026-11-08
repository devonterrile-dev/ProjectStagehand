import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;

export interface DbHandle {
  db: Database;
  /** The underlying pool; call `pool.end()` on shutdown. */
  pool: pg.Pool;
}

/** Creates the app's connection pool and Drizzle client. Connections open lazily. */
export function createDb(databaseUrl: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: 'stagehand',
    // One GM + 6 players per room and a handful of rooms: a small pool is plenty.
    max: options.max ?? 10,
  });

  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool };
}
