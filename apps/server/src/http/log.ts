import type { FastifyRequest } from 'fastify';

/**
 * Removes the query string from auth URLs before they are logged: OAuth callbacks carry a
 * one-time `code` and `state` that have no business in log files (§14).
 */
export function redactUrl(url: string): string {
  return url.startsWith('/api/auth/') ? (url.split('?')[0] ?? url) : url;
}

/** Fastify's default request serializer, with `redactUrl` applied. */
export function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: redactUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  };
}
