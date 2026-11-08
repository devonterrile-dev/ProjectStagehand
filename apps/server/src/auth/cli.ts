/**
 * Better Auth CLI entry point, used only to generate the Drizzle schema:
 *
 *   pnpm --filter @stagehand/server auth:generate
 *
 * Placeholder values: the CLI reads the configuration shape, it never connects or signs in.
 */
import { createDb } from '../db/client';

import { createAuth } from './auth';

export const auth = createAuth({
  db: createDb('postgres://cli:cli@127.0.0.1:5432/cli').db,
  publicUrl: 'http://localhost:5173',
  secret: 'cli-placeholder-secret-not-used-at-runtime',
  discord: { clientId: 'cli', clientSecret: 'cli' },
});
