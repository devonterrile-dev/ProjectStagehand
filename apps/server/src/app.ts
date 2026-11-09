import { sep } from 'node:path';

import fastifyStatic from '@fastify/static';
import { healthResponseSchema, type HealthResponse } from '@stagehand/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { AUTH_BASE_PATH, type Auth } from './auth/auth';
import { registerAuthRoutes } from './auth/routes';
import type { Database, DbHandle } from './db/client';
import { registerCsrfProtection } from './http/csrf';
import { serializeRequest } from './http/log';
import { registerSecurityHeaders } from './http/security-headers';
import { registerMeRoutes } from './routes/me';

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
  /** Sign-in, sessions and the user API. Requires `db` and `publicUrl`. */
  auth?: Auth | undefined;
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

  registerSecurityHeaders(app, { publicUrl: options.publicUrl });

  const handle = options.db;
  if (handle !== undefined) {
    app.decorate('db', handle.db);
    // Runs on app.close(), which graceful shutdown already calls.
    app.addHook('onClose', async () => {
      await handle.pool.end();
    });
  }

  // Polled every few seconds by the Docker healthcheck, so keep it out of the request logs.
  app.get('/health', { logLevel: 'silent' }, (): HealthResponse =>
    healthResponseSchema.parse({ status: 'ok' }),
  );

  if (options.auth !== undefined) {
    if (handle === undefined || options.publicUrl === undefined) {
      throw new Error('buildApp: `auth` requires `db` and `publicUrl`');
    }
    // Better Auth checks the origin of its own endpoints; everything else under /api is ours.
    registerCsrfProtection(app, { publicUrl: options.publicUrl, exempt: [`${AUTH_BASE_PATH}/`] });
    registerAuthRoutes(app, options.auth);
    registerMeRoutes(app, { auth: options.auth, db: handle.db });
  }

  if (options.webDistDir !== undefined) {
    registerSpa(app, options.webDistDir);
  }

  return app;
}

/** Applies our request serializer (no OAuth codes in logs) to any enabled logger. */
function withRequestRedaction(
  logger: NonNullable<FastifyServerOptions['logger']>,
): FastifyServerOptions['logger'] {
  if (logger === false) return false;
  const base = logger === true ? {} : logger;
  return { ...base, serializers: { ...base.serializers, req: serializeRequest } };
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
