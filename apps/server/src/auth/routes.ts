import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AUTH_BASE_PATH, type Auth } from './auth';

export type AuthSession = Auth['$Infer']['Session'];

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user and session. Set by `requireSession`; null elsewhere. */
    auth: AuthSession | null;
  }
}

/** Mounts Better Auth's handler (sign-in, OAuth callback, sign-out, session) under /api/auth. */
export function registerAuthRoutes(app: FastifyInstance, auth: Auth): void {
  app.decorateRequest('auth', null);

  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      const body = request.body === undefined ? undefined : JSON.stringify(request.body);

      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          ...(body === undefined ? {} : { body }),
        }),
      );

      void reply.status(response.status);
      forwardHeaders(response.headers, reply);
      return reply.send(response.body === null ? null : await response.text());
    },
  });
}

/**
 * preHandler for routes that need a signed-in user. Responds 401 when there is no valid
 * session; otherwise sets `request.auth`, and forwards any refreshed session cookie
 * (sessions roll forward daily, see `updateAge`).
 */
export function requireSession(auth: Auth) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });

    forwardHeaders(result.headers, reply);
    if (result.response === null) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    request.auth = result.response;
  };
}

/** The session `requireSession` attached; throws if a route forgot the preHandler. */
export function sessionOf(request: FastifyRequest): AuthSession {
  if (request.auth === null) throw new Error('route is missing the requireSession preHandler');
  return request.auth;
}

function forwardHeaders(headers: Headers, reply: FastifyReply): void {
  headers.forEach((value, key) => {
    // set-cookie is handled below: Headers joins multiple cookies into one value.
    if (key !== 'set-cookie') void reply.header(key, value);
  });
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) void reply.header('set-cookie', cookies);
}
