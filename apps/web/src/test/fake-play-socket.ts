import type { PlaySocket } from '@/play/socket';

/** A request the page sent to the live room, waiting for the test to answer it. */
export interface SentRequest {
  event: string;
  payload: unknown;
  answer(value: unknown): void;
  /** No answer came in time. */
  fail(): void;
}

/** A stand-in for the live room's connection: the test plays the server. */
export interface FakePlaySocket extends PlaySocket {
  /** The server, or the connection itself, sends `event`. */
  receive(event: string, ...args: unknown[]): void;
  /** Every request sent so far, in order. */
  requests: SentRequest[];
  /** The newest request for `event`; throws when there is none. */
  last(event: string): SentRequest;
  connects: number;
  disconnects: number;
  /** What `retrying()` answers: whether Socket.IO would reconnect by itself. */
  willRetry: boolean;
}

export function fakePlaySocket(): FakePlaySocket {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const fake: FakePlaySocket = {
    requests: [],
    connects: 0,
    disconnects: 0,
    willRetry: true,
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    request(event, payload) {
      return new Promise((resolve, reject) => {
        fake.requests.push({
          event,
          payload,
          answer: resolve,
          fail: () => {
            reject(new Error('operation has timed out'));
          },
        });
      });
    },
    retrying: () => fake.willRetry,
    connect() {
      fake.connects += 1;
    },
    disconnect() {
      fake.disconnects += 1;
    },
    receive(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    last(event) {
      const found = fake.requests.filter((request) => request.event === event).at(-1);
      if (found === undefined) throw new Error(`no ${event} request was sent`);
      return found;
    },
  };
  return fake;
}
