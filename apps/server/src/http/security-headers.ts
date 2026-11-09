import type { FastifyInstance } from 'fastify';

export interface SecurityHeaderOptions {
  /** The app's public origin. HSTS is only sent when it is https. */
  publicUrl?: string | undefined;
}

/**
 * Baseline security headers on every response, API and SPA alike (governance §14).
 *
 * - nosniff: browsers must not guess content types (stops uploads being run as scripts).
 * - Referrer-Policy: other sites see only our origin, never full URLs with ids in them.
 * - frame-ancestors 'self': nobody can frame the app (clickjacking). F3.9 adds Discord's
 *   origins here so the Discord Activity can embed it.
 * - HSTS (https only): browsers go straight to https for a year. No includeSubDomains, so
 *   other subdomains stay free to do their own thing.
 *
 * A full Content-Security-Policy waits until the stage and Activity needs are known.
 */
export function registerSecurityHeaders(
  app: FastifyInstance,
  options: SecurityHeaderOptions = {},
): void {
  const hsts = options.publicUrl?.startsWith('https://') === true;

  app.addHook('onSend', async (_request, reply) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    void reply.header('content-security-policy', "frame-ancestors 'self'");
    if (hsts) void reply.header('strict-transport-security', 'max-age=31536000');
  });
}
