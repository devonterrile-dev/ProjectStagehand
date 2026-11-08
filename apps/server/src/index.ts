import { resolve } from 'node:path';

import { buildApp } from './app';
import { createAuth } from './auth/auth';
import { ConfigError, loadConfig } from './config';
import { createDb } from './db/client';

function start(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  // Migrations are applied separately (pnpm db:migrate / the `migrate` service), never here.
  const db = config.databaseUrl === undefined ? undefined : createDb(config.databaseUrl);

  // loadConfig guarantees these outside NODE_ENV=test.
  const auth =
    db !== undefined && config.auth !== undefined && config.publicUrl !== undefined
      ? createAuth({
          db: db.db,
          publicUrl: config.publicUrl,
          secret: config.auth.secret,
          discord: {
            clientId: config.auth.discordClientId,
            clientSecret: config.auth.discordClientSecret,
          },
        })
      : undefined;

  const app = buildApp({
    logger: { level: config.logLevel },
    webDistDir: config.webDistDir === undefined ? undefined : resolve(config.webDistDir),
    db,
    auth,
    publicUrl: config.publicUrl,
  });

  // Close cleanly on `docker stop` (SIGTERM) and Ctrl+C (SIGINT): stop accepting
  // connections and let in-flight requests finish.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error(error, 'error during shutdown');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  app.listen({ port: config.port, host: config.host }).catch((error: unknown) => {
    app.log.error(error, 'failed to start');
    process.exit(1);
  });
}

start();
