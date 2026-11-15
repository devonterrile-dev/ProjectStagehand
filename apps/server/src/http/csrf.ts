import type { FastifyInstance, FastifyRequest } from 'fastify';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface CsrfOptions {
  /** The app's own origin (PUBLIC_URL). Only requests from it may change state. */
  publicUrl: string;
  /**
   * Other origins the app's own pages are served from: Discord's proxy for this application,
   * when it runs as an Activity (D-48, D-51). A request from one counts as our own.
   */
  alsoOurs?: readonly string[];
  /** Path prefixes protected by this hook. */
  prefixes?: string[];
  /** Path prefixes that do their own origin checks (Better Auth). */
  exempt?: string[];
}

/**
 * CSRF protection for state-changing API routes (governance §14), on top of SameSite=Lax
 * session cookies: an unsafe request must come from our own origin, shown by its `Origin`
 * header, or, when a browser omits that, by `Sec-Fetch-Site: same-origin`.
 *
 * Inside Discord's frame the session cookie is `SameSite=None` (D-51), so there this check is
 * what stands between another site and the user's session: only the app's own address and
 * Discord's proxy for this application pass.
 */
export function registerCsrfProtection(app: FastifyInstance, options: CsrfOptions): void {
  const prefixes = options.prefixes ?? ['/api/'];
  const exempt = options.exempt ?? [];
  const ours = new Set([options.publicUrl, ...(options.alsoOurs ?? [])]);

  app.addHook('onRequest', async (request, reply) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    const path = request.url.split('?')[0] ?? '';
    if (!prefixes.some((prefix) => path.startsWith(prefix))) return;
    if (exempt.some((prefix) => path.startsWith(prefix))) return;

    if (!isSameOrigin(request, ours)) {
      request.log.warn({ origin: request.headers.origin }, 'blocked cross-origin request');
      return reply.code(403).send({ error: 'Forbidden', message: 'Cross-origin request blocked' });
    }
  });
}

function isSameOrigin(request: FastifyRequest, ours: ReadonlySet<string>): boolean {
  const origin = request.headers.origin;
  if (origin !== undefined) return ours.has(origin);
  return request.headers['sec-fetch-site'] === 'same-origin';
}
