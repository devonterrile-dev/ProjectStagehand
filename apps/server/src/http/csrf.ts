import type { FastifyInstance, FastifyRequest } from 'fastify';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface CsrfOptions {
  /** The app's own origin (PUBLIC_URL). Only requests from it may change state. */
  publicUrl: string;
  /** Path prefixes protected by this hook. */
  prefixes?: string[];
  /** Path prefixes that do their own origin checks (Better Auth). */
  exempt?: string[];
}

/**
 * CSRF protection for state-changing API routes (governance §14), on top of SameSite=Lax
 * session cookies: an unsafe request must come from our own origin, shown by its `Origin`
 * header, or, when a browser omits that, by `Sec-Fetch-Site: same-origin`.
 */
export function registerCsrfProtection(app: FastifyInstance, options: CsrfOptions): void {
  const prefixes = options.prefixes ?? ['/api/'];
  const exempt = options.exempt ?? [];

  app.addHook('onRequest', async (request, reply) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    const path = request.url.split('?')[0] ?? '';
    if (!prefixes.some((prefix) => path.startsWith(prefix))) return;
    if (exempt.some((prefix) => path.startsWith(prefix))) return;

    if (!isSameOrigin(request, options.publicUrl)) {
      request.log.warn({ origin: request.headers.origin }, 'blocked cross-origin request');
      return reply.code(403).send({ error: 'Forbidden', message: 'Cross-origin request blocked' });
    }
  });
}

function isSameOrigin(request: FastifyRequest, publicUrl: string): boolean {
  const origin = request.headers.origin;
  if (origin !== undefined) return origin === publicUrl;
  return request.headers['sec-fetch-site'] === 'same-origin';
}
