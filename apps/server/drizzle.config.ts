import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` works offline; only `drizzle-kit studio` needs DATABASE_URL.
// Load the local dev env file if present (production never runs drizzle-kit).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ?? 'postgres://stagehand:stagehand@127.0.0.1:5432/stagehand_dev',
  },
  strict: true,
  verbose: true,
});
