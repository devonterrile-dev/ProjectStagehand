import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PromptError } from '@stagehand/prompts';
import {
  DEFAULT_STYLE_BIBLE_DIR,
  loadStyleBible,
  STYLE_BIBLE_VERSION,
  StyleBibleError,
  type StyleBible,
} from '@stagehand/style-bible';

import { loadImportSystemPrompt } from './ai-import/prompt';
import { buildApp } from './app';
import { failInterruptedImports } from './campaigns/ai-imports';
import { failInterruptedVisuals } from './campaigns/visuals';
import { createAuth } from './auth/auth';
import { ConfigError, loadConfig } from './config';
import { createDb } from './db/client';
import { createAnthropicProvider } from './providers/anthropic';
import { createOpenRouterProvider } from './providers/openrouter';
import { processStoredVisual, processVisualJob, queueStaleProcessing } from './visuals/job';
import { createPgBossQueue } from './visuals/queue';
import { loadReferences, type ReferencesByKind } from './visuals/references';
import { createDiskStorage } from './visuals/storage';

/** Where images go in dev when ASSETS_DIR is unset: `apps/server/var/assets` (git-ignored). */
const DEV_ASSETS_DIR = fileURLToPath(new URL('../var/assets', import.meta.url));

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

  // The AI import prompt (F1.9) is read here, so a wrong PROMPTS_DIR, or a prompt file that
  // no longer matches the record types, stops the server now instead of failing a GM's first
  // import.
  let importPrompt: string;
  try {
    importPrompt = loadImportSystemPrompt(config.promptsDir);
  } catch (error) {
    if (error instanceof PromptError) {
      console.error(`${error.message}\nSet PROMPTS_DIR to the folder holding import/v<N>.md.`);
      process.exit(1);
    }
    throw error;
  }

  // The style bible and its anchor images (F2.3), read now for the same reason.
  let bible: StyleBible;
  let references: ReferencesByKind;
  try {
    bible = loadStyleBible(STYLE_BIBLE_VERSION, config.styleBibleDir ?? DEFAULT_STYLE_BIBLE_DIR);
    references = loadReferences(bible);
  } catch (error) {
    if (error instanceof StyleBibleError) {
      console.error(`${error.message}
Set STYLE_BIBLE_DIR to the folder holding v<N>/.`);
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

  const storage = createDiskStorage(config.assetsDir ?? DEV_ASSETS_DIR);
  const openrouter = createOpenRouterProvider();

  // Image jobs (F2.3) run in this process, from a pg-boss queue in the same database (D-42).
  // Only the kind of an error is logged: a job's prompt is private campaign text.
  const credentialsKey = config.credentialsKey;
  const onVisualError = (assetId: string, errorName: string, stage: 'generate' | 'process') => {
    app.log.error(
      { assetId, errorName },
      stage === 'generate' ? 'visual job failed' : 'visual post-processing failed',
    );
  };
  const visualQueue =
    db === undefined || config.databaseUrl === undefined || credentialsKey === undefined
      ? undefined
      : createPgBossQueue({
          databaseUrl: config.databaseUrl,
          process: (assetId, signal) =>
            processVisualJob(
              {
                db: db.db,
                credentialsKey,
                openrouter,
                storage,
                references,
                onError: onVisualError,
              },
              assetId,
              signal,
            ),
          reprocess: (assetId) =>
            processStoredVisual({ db: db.db, storage, onError: onVisualError }, assetId),
          onError: (error) => {
            app.log.error(
              { errorName: error instanceof Error ? error.name : 'unknown' },
              'visual queue error',
            );
          },
        });

  const app = buildApp({
    logger: { level: config.logLevel },
    webDistDir: config.webDistDir === undefined ? undefined : resolve(config.webDistDir),
    db,
    auth,
    publicUrl: config.publicUrl,
    trustProxy: config.trustProxy,
    credentials:
      config.credentialsKey === undefined
        ? undefined
        : {
            key: config.credentialsKey,
            anthropic: createAnthropicProvider(),
            openrouter,
          },
    importPrompt,
    visuals: visualQueue === undefined ? undefined : { queue: visualQueue, storage, bible },
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

  // Imports and image jobs run inside this process, so one still marked as running was cut
  // off by the last shutdown. Say so before anyone polls it; then start taking image jobs.
  const ready =
    db === undefined
      ? Promise.resolve()
      : Promise.all([failInterruptedImports(db.db), failInterruptedVisuals(db.db)]).then(
          async ([imports, visuals]) => {
            if (imports > 0)
              app.log.warn({ interrupted: imports }, 'marked interrupted ai imports failed');
            if (visuals > 0)
              app.log.warn({ interrupted: visuals }, 'marked interrupted visuals failed');
            if (visualQueue === undefined) return;
            await visualQueue.start();
            // Images stored before post-processing (F2.4), or by an older version of it.
            const stale = await queueStaleProcessing(db.db, visualQueue);
            if (stale > 0) app.log.info({ queued: stale }, 'queued visuals for post-processing');
          },
        );

  ready
    .then(() => app.listen({ port: config.port, host: config.host }))
    .catch((error: unknown) => {
      app.log.error(error, 'failed to start');
      process.exit(1);
    });
}

start();
