import { sep } from 'node:path';

import fastifyStatic from '@fastify/static';
import { healthResponseSchema, type HealthResponse } from '@stagehand/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface BuildAppOptions {
  /** Fastify logger setting; off by default so tests stay quiet. */
  logger?: FastifyServerOptions['logger'];
  /** Absolute path to the built web client (apps/web/dist). When unset, no SPA is served. */
  webDistDir?: string | undefined;
}

/** Path prefixes owned by the server; these never fall back to the SPA. */
const SERVER_PREFIXES = ['/api', '/health'];

/**
 * Builds the Fastify app without starting it, so tests can drive it with `inject()`.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  // Polled every few seconds by the Docker healthcheck, so keep it out of the request logs.
  app.get('/health', { logLevel: 'silent' }, (): HealthResponse =>
    healthResponseSchema.parse({ status: 'ok' }),
  );

  if (options.webDistDir !== undefined) {
    registerSpa(app, options.webDistDir);
  }

  return app;
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
