import { PLAY_SOCKET } from '@stagehand/shared';
import { io } from 'socket.io-client';

/** How long a request to the live room waits for its answer. */
const ANSWER_WAIT_MS = 8000;

/**
 * The few parts of a Socket.IO connection the live room uses (`room.ts`), so tests can put a
 * stand-in in its place.
 */
export interface PlaySocket {
  /** Calls `listener` whenever the server (or the connection itself) sends `event`. */
  on(event: string, listener: (...args: unknown[]) => void): void;
  /** Sends `event` and resolves with the server's answer; rejects if none comes in time. */
  request(event: string, payload?: unknown): Promise<unknown>;
  /** Whether the connection will try again by itself after an error. */
  retrying(): boolean;
  connect(): void;
  disconnect(): void;
}

/**
 * A connection to the live room, not yet opened. The same path works in a tab and inside
 * Discord's frame (D-48), and the browser sends the Stagehand session cookie with it.
 */
export function createPlaySocket(): PlaySocket {
  const socket = io(PLAY_SOCKET.namespace, { path: PLAY_SOCKET.path, autoConnect: false });
  return {
    on: (event, listener) => {
      socket.on(event, listener);
    },
    request: (event, payload) =>
      payload === undefined
        ? socket.timeout(ANSWER_WAIT_MS).emitWithAck(event)
        : socket.timeout(ANSWER_WAIT_MS).emitWithAck(event, payload),
    retrying: () => socket.active,
    connect: () => {
      socket.connect();
    },
    disconnect: () => {
      socket.disconnect();
    },
  };
}
