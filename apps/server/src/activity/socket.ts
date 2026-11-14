import { ACTIVITY_SOCKET } from '@stagehand/shared';
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

/** Far above an echo's few bytes; a bound on what one message may carry. */
const MAX_MESSAGE_BYTES = 4096;

/**
 * The Activity test's Socket.IO echo (governance §13): one namespace that answers a short
 * text with the same text, so the test page can tell whether live traffic gets through
 * Discord's proxy and by which transport. It holds no state and reads no session.
 *
 * Socket.IO takes over requests under its path on Fastify's HTTP server and passes every
 * other request on to Fastify.
 */
export function registerActivitySocket(app: FastifyInstance): Server {
  const io = new Server(app.server, {
    path: ACTIVITY_SOCKET.path,
    serveClient: false,
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
  });

  io.of(ACTIVITY_SOCKET.namespace).on('connection', (socket) => {
    socket.on(ACTIVITY_SOCKET.echo, (text: unknown, reply: unknown) => {
      if (typeof reply !== 'function') return;
      if (typeof text !== 'string' || text.length > ACTIVITY_SOCKET.textMax) return;
      (reply as (echoed: string) => void)(text);
    });
  });

  // Before Fastify closes the HTTP server: an open socket would keep it waiting.
  app.addHook('preClose', (done) => {
    io.engine.close();
    done();
  });

  return io;
}
