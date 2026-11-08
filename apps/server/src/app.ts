import { healthResponseSchema, type HealthResponse } from '@stagehand/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

/**
 * Builds the Fastify app without starting it, so tests can drive it with `inject()`.
 */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  app.get('/health', (): HealthResponse => healthResponseSchema.parse({ status: 'ok' }));

  return app;
}
