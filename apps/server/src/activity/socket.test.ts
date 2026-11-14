import type { AddressInfo } from 'node:net';

import { ACTIVITY_SOCKET } from '@stagehand/shared';
import type { FastifyInstance } from 'fastify';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';

const DISCORD = { clientId: 'client-123', clientSecret: 'secret-456' };

describe('Activity test Socket.IO echo', () => {
  let app: FastifyInstance | null = null;
  let socket: Socket | null = null;

  afterEach(async () => {
    socket?.disconnect();
    socket = null;
    await app?.close();
    app = null;
  });

  /** Starts the app on a free local port and connects a client to the echo namespace. */
  async function connect(transports: ('polling' | 'websocket')[]): Promise<Socket> {
    app = buildApp({ activityTest: { discord: DISCORD } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const client = io(`http://127.0.0.1:${String(port)}${ACTIVITY_SOCKET.namespace}`, {
      path: ACTIVITY_SOCKET.path,
      transports,
      reconnection: false,
    });
    socket = client;
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    return client;
  }

  it('answers a short text with the same text over a websocket', async () => {
    const client = await connect(['websocket']);

    const echoed: unknown = await client.timeout(2000).emitWithAck(ACTIVITY_SOCKET.echo, 'hello');

    expect(echoed).toBe('hello');
    expect(client.io.engine.transport.name).toBe('websocket');
  });

  it('works by polling alone, for a proxy that blocks websockets', async () => {
    const client = await connect(['polling']);

    expect(await client.timeout(2000).emitWithAck(ACTIVITY_SOCKET.echo, 'hi')).toBe('hi');
  });

  it('does not answer text that is too long or not text', async () => {
    const client = await connect(['websocket']);

    await expect(
      client
        .timeout(200)
        .emitWithAck(ACTIVITY_SOCKET.echo, 'x'.repeat(ACTIVITY_SOCKET.textMax + 1)),
    ).rejects.toThrow();
    await expect(
      client.timeout(200).emitWithAck(ACTIVITY_SOCKET.echo, { not: 'text' }),
    ).rejects.toThrow();
  });

  it('leaves every other request to the app, and closes with a client still connected', async () => {
    await connect(['websocket']);
    const running = app;
    if (running === null) throw new Error('the app did not start');

    expect((await running.inject({ url: '/health' })).statusCode).toBe(200);

    // afterEach would close it too; closing here shows an open socket does not hold it up.
    await running.close();
    app = null;
  });

  it('is not served without the Activity test', async () => {
    app = buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${String(port)}${ACTIVITY_SOCKET.path}/?EIO=4&transport=polling`,
    );

    expect(response.status).toBe(404);
  });
});
