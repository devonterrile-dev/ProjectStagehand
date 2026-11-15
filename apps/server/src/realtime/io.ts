import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

/** Socket.IO's default path, the one Discord's proxy was tried with (D-48). */
export const SOCKET_PATH = '/socket.io';

/** Far above anything a browser sends here (a join, a scene id); a bound on one message. */
const MAX_MESSAGE_BYTES = 4096;

export interface RealtimeOptions {
  /**
   * The origins a browser may connect from: the app's own, and Discord's proxy when the
   * Activity is served. A request that names any other origin is refused.
   */
  allowedOrigins: readonly string[];
}

/**
 * The app's one Socket.IO server (governance §6, §13). The live room (`play/socket.ts`) and the
 * Activity test's echo (`activity/socket.ts`) are namespaces on it.
 *
 * Socket.IO takes over requests under its path on Fastify's HTTP server and passes every other
 * request on to Fastify.
 *
 * A browser's cross-origin rules don't cover websockets, so a page on another site could open
 * one here with the visitor's cookies. Browsers always say where such a request comes from, so
 * one with a foreign `Origin` is refused (§14). A request with no `Origin` is not from a page on
 * another site: a same-origin poll, or a program that has no visitor's cookies to borrow.
 */
export function createRealtime(app: FastifyInstance, options: RealtimeOptions): Server {
  const allowed = new Set(options.allowedOrigins);
  const io = new Server(app.server, {
    path: SOCKET_PATH,
    serveClient: false,
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    allowRequest: (request, decide) => {
      const origin = request.headers.origin;
      decide(null, origin === undefined || allowed.has(origin));
    },
  });

  // Before Fastify closes the HTTP server: an open socket would keep it waiting.
  app.addHook('preClose', (done) => {
    io.engine.close();
    done();
  });

  return io;
}
