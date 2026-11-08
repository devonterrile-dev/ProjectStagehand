import { defineConfig } from 'vitest/config';

/** `pnpm test:integration`: tests that need a real Postgres (start one with `pnpm db:up`). */
export default defineConfig({
  test: {
    projects: ['apps/server/vitest.integration.config.ts'],
  },
});
