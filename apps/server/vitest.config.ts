import { configDefaults, defineProject } from 'vitest/config';

/** Unit tests: no database. Integration tests live in vitest.integration.config.ts. */
export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
  },
});
