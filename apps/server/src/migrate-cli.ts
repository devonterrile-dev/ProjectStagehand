/**
 * Applies pending database migrations, then exits: 0 on success, 1 on failure.
 *
 * - Dev:        pnpm db:migrate              (tsx, reads apps/server/.env)
 * - Production: the one-shot `migrate` Compose service (node dist/migrate.js)
 */
import { runMigrations } from './db/migrate';

// Same JSON-lines shape as the server's pino logs, so `docker compose logs` reads uniformly.
function log(level: 'info' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level: level === 'info' ? 30 : 50,
    time: Date.now(),
    msg,
    ...extra,
  });
  (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`);
}

const databaseUrl = process.env['DATABASE_URL'];

if (databaseUrl === undefined || databaseUrl === '') {
  log('error', 'DATABASE_URL is required to run migrations');
  process.exit(1);
}

log('info', 'applying migrations');
try {
  const { total, applied } = await runMigrations(databaseUrl);
  log('info', applied === 0 ? 'database is up to date' : 'migrations applied', { applied, total });
} catch (error) {
  log('error', 'migration failed', {
    err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
  });
  process.exit(1);
}
