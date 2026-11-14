import { ACTIVITY_SOCKET } from '@stagehand/shared';
import { io } from 'socket.io-client';

export interface SocketOutcome {
  /** What the connection ended up on: "websocket" or "polling". */
  transport: string;
  /** What it started on. Socket.IO starts by polling and moves to a websocket if one gets through. */
  startedOn: string;
  /** How long one echo took, there and back. */
  roundTripMs: number;
}

const CONNECT_TIMEOUT_MS = 8000;
/** How long to wait for the move from polling to a websocket before measuring anyway. */
const UPGRADE_WAIT_MS = 3000;

/**
 * Connects to the server's echo namespace at `path` (the Socket.IO path, with Discord's proxy
 * prefix when the frame needs one), sends one echo, and says how it went. Rejects when no
 * connection can be made.
 */
export function runSocketProbe(path: string): Promise<SocketOutcome> {
  return new Promise((resolve, reject) => {
    const socket = io(ACTIVITY_SOCKET.namespace, {
      path,
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
    });
    const fail = (error: unknown) => {
      socket.disconnect();
      reject(error instanceof Error ? error : new Error('The echo was not answered'));
    };

    socket.once('connect_error', fail);
    socket.once('connect', () => {
      const engine = socket.io.engine;
      const startedOn = engine.transport.name;

      const echo = () => {
        const sent = performance.now();
        socket
          .timeout(CONNECT_TIMEOUT_MS)
          .emitWithAck(ACTIVITY_SOCKET.echo, 'stagehand')
          .then(() => {
            const outcome = {
              transport: engine.transport.name,
              startedOn,
              roundTripMs: performance.now() - sent,
            };
            socket.disconnect();
            resolve(outcome);
          }, fail);
      };

      if (startedOn === 'websocket') {
        echo();
        return;
      }
      const giveUp = window.setTimeout(echo, UPGRADE_WAIT_MS);
      engine.once('upgrade', () => {
        window.clearTimeout(giveUp);
        echo();
      });
    });
  });
}
