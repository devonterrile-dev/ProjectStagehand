import { sep } from 'node:path';

import fastifyStatic from '@fastify/static';
import { healthResponseSchema, type HealthResponse } from '@stagehand/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { createImportRunner } from './ai-import/runner';
import { AUTH_BASE_PATH, type Auth } from './auth/auth';
import { registerAuthRoutes } from './auth/routes';
import type { Database, DbHandle } from './db/client';
import { registerCsrfProtection } from './http/csrf';
import { registerErrorHandler } from './http/errors';
import { serializeRequest } from './http/log';
import { registerImportRoutes } from './routes/ai-imports';
import { registerSecurityHeaders } from './http/security-headers';
import { registerCampaignRoutes } from './routes/campaigns';
import { registerCharacterRoutes } from './routes/characters';
import { registerInviteRoutes } from './routes/invites';
import { registerMeRoutes } from './routes/me';
import { registerMemberRoutes } from './routes/members';
import {
  registerProviderCredentialRoutes,
  type CredentialDeps,
} from './routes/provider-credentials';
import { registerRecordRoutes } from './routes/records';
import { registerStatBlockRoutes } from './routes/stat-blocks';

declare module 'fastify' {
  interface FastifyInstance {
    /** Drizzle client. Only present when the app was built with a database. */
    db?: Database;
  }
}

export interface BuildAppOptions {
  /** Fastify logger setting; off by default so tests stay quiet. */
  logger?: FastifyServerOptions['logger'];
  /** Absolute path to the built web client (apps/web/dist). When unset, no SPA is served. */
  webDistDir?: string | undefined;
  /** Database handle. The app takes ownership and ends the pool when it closes. */
  db?: DbHandle | undefined;
  /**
   * Sign-in, sessions and the user API. Requires `db`, `publicUrl`, `credentials` and
   * `importPrompt`.
   */
  auth?: Auth | undefined;
  /** Master key and provider clients for GMs' stored API keys (F1.7). */
  credentials?: CredentialDeps | undefined;
  /** The filled AI import prompt (`loadImportSystemPrompt`), read once at startup (F1.8). */
  importPrompt?: string | undefined;
  /** The app's own origin (PUBLIC_URL), used for CSRF checks and HSTS. */
  publicUrl?: string | undefined;
  /**
   * Trust X-Forwarded-* (client IP, protocol) from our own proxy, cloudflared. Never the
   * whole chain: cloudflared *appends* to any X-Forwarded-For the visitor sent, so trusting
   * everything would let a visitor choose their own IP. See TRUSTED_PROXIES.
   */
  trustProxy?: boolean | undefined;
}

/**
 * Proxies trusted for X-Forwarded-*, by address: loopback and private ranges, i.e.
 * cloudflared on the Docker network (and localhost checks). Walking X-Forwarded-For from
 * the right, the first public address is the client: the one cloudflared appended. Anything
 * a visitor wrote sits further left and is ignored. (Fastify treats hop counts as "trust
 * nothing", since a count can't verify the immediate peer.)
 */
const TRUSTED_PROXIES = 'loopback, uniquelocal';

/** Path prefixes owned by the server; these never fall back to the SPA. */
const SERVER_PREFIXES = ['/api', '/health'];

/**
 * Builds the Fastify app without starting it, so tests can drive it with `inject()`.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: withRequestRedaction(options.logger ?? false),
    trustProxy: options.trustProxy === true ? TRUSTED_PROXIES : false,
  });

  // Errors are answered and logged without their own text unless we wrote it (§14).
  registerErrorHandler(app);
  registerSecurityHeaders(app, { publicUrl: options.publicUrl });

  // AI imports run in the background of this process (D-27). Only the kind of error is
  // logged: an error's message could quote a GM's notes.
  const importRunner = createImportRunner((error) => {
    app.log.error(
      { errorName: error instanceof Error ? error.name : 'unknown' },
      'ai import job failed',
    );
  });

  const handle = options.db;
  if (handle !== undefined) {
    app.decorate('db', handle.db);
    // Runs on app.close(), which graceful shutdown already calls. Imports in flight are
    // cancelled first, while they can still record that they were.
    app.addHook('onClose', async () => {
      await importRunner.stop();
      await handle.pool.end();
    });
  }

  // Polled every few seconds by the Docker healthcheck, so keep it out of the request logs.
  app.get('/health', { logLevel: 'silent' }, (): HealthResponse =>
    healthResponseSchema.parse({ status: 'ok' }),
  );

  if (options.auth !== undefined) {
    if (
      handle === undefined ||
      options.publicUrl === undefined ||
      options.credentials === undefined ||
      options.importPrompt === undefined
    ) {
      throw new Error(
        'buildApp: `auth` requires `db`, `publicUrl`, `credentials` and `importPrompt`',
      );
    }
    // Better Auth checks the origin of its own endpoints; everything else under /api is ours.
    registerCsrfProtection(app, { publicUrl: options.publicUrl, exempt: [`${AUTH_BASE_PATH}/`] });
    registerAuthRoutes(app, options.auth);
    registerMeRoutes(app, { auth: options.auth, db: handle.db });
    registerProviderCredentialRoutes(app, {
      auth: options.auth,
      db: handle.db,
      credentials: options.credentials,
    });
    // Campaign routes first: they register the `request.campaign` decoration.
    registerCampaignRoutes(app, { auth: options.auth, db: handle.db });
    registerMemberRoutes(app, { auth: options.auth, db: handle.db });
    registerInviteRoutes(app, { auth: options.auth, db: handle.db });
    registerCharacterRoutes(app, { auth: options.auth, db: handle.db });
    registerRecordRoutes(app, { auth: options.auth, db: handle.db });
    registerStatBlockRoutes(app, { auth: options.auth, db: handle.db });
    registerImportRoutes(app, {
      auth: options.auth,
      db: handle.db,
      credentials: options.credentials,
      imports: { systemPrompt: options.importPrompt, runner: importRunner },
    });
  }

  if (options.webDistDir !== undefined) {
    registerSpa(app, options.webDistDir);
  }

  return app;
}

/**
 * Log fields that could ever hold a secret. Our request serializer already logs no headers
 * or bodies, so this is the backstop if a log call or a future serializer adds them (§14).
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.body.apiKey',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
  'body.apiKey',
  'apiKey',
  '*.apiKey',
  'encryptedKey',
  '*.encryptedKey',
  // A GM's notes and the proposals made from them (F1.8): private campaign text.
  'req.body.text',
  'body.text',
  'req.body.payload',
  'body.payload',
  'inputText',
  '*.inputText',
  'originalPayload',
  '*.originalPayload',
];

/**
 * Applies our request serializer (no OAuth codes in logs) and secret redaction to any
 * enabled logger.
 */
function withRequestRedaction(
  logger: NonNullable<FastifyServerOptions['logger']>,
): FastifyServerOptions['logger'] {
  if (logger === false) return false;
  const base = logger === true ? {} : logger;
  return {
    ...base,
    serializers: { ...base.serializers, req: serializeRequest },
    redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
  };
}

function registerSpa(app: FastifyInstance, root: string): void {
  void app.register(fastifyStatic, {
    root,
    // Cache headers are set explicitly below.
    cacheControl: false,
    setHeaders: (reply, filePath) => {
      // Vite fingerprints everything under assets/, so those files can be cached forever.
      // index.html must always be revalidated so new deploys are picked up.
      const immutable = filePath.includes(`${sep}assets${sep}`);
      void reply.header(
        'cache-control',
        immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  // Client-side routes (e.g. /campaigns/123) have no file on disk: serve index.html so the
  // SPA router can handle them. Server-owned paths and non-HTML requests get a real 404.
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const isServerPath = SERVER_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    const wantsHtml = request.headers.accept?.includes('text/html') ?? false;

    if (request.method === 'GET' && wantsHtml && !isServerPath) {
      return reply.sendFile('index.html');
    }

    return reply.code(404).send({ error: 'Not Found' });
  });
}
