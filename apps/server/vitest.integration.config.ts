import { defineProject } from 'vitest/config';

/** Integration tests against a real Postgres: `pnpm test:integration` (needs `pnpm db:up`). */
export default defineProject({
  test: {
    name: 'server-integration',
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./test/integration-setup.ts'],
    // Test files share one database; run them one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
