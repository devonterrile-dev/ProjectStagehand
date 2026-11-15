import { ACTIVITY_SOCKET } from '@stagehand/shared';
import type { Server } from 'socket.io';

/**
 * The Activity test's Socket.IO echo (governance §13): one namespace that answers a short
 * text with the same text, so the test page can tell whether live traffic gets through
 * Discord's proxy and by which transport. It holds no state and reads no session.
 */
export function registerActivitySocket(io: Server): void {
  io.of(ACTIVITY_SOCKET.namespace).on('connection', (socket) => {
    socket.on(ACTIVITY_SOCKET.echo, (text: unknown, reply: unknown) => {
      if (typeof reply !== 'function') return;
      if (typeof text !== 'string' || text.length > ACTIVITY_SOCKET.textMax) return;
      (reply as (echoed: string) => void)(text);
    });
  });
}
