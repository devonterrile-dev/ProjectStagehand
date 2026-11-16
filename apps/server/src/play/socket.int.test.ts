/**
 * The live room (F3.3b, governance §13 and §14 "Live events", D-50), with real connections to
 * a listening server and a real Postgres: who may connect, joining and waiting, each role's
 * view of the stage, the GM's actions and a player trying them, the 6-player cap, coming back
 * after a drop, ending, and a removed member.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  PLAY_SOCKET,
  SESSION_MAX_PLAYERS,
  type ActionResult,
  type Campaign,
  type CampaignRecord,
  type GmStage,
  type JoinResult,
  type LiveStage,
  type PlayerStage,
  type Presence,
  type Scene,
  type SceneObjectInput,
} from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildTestApp,
  discordUser,
  PUBLIC_URL,
  SAME_ORIGIN,
  signIn,
} from '../../test/auth-helpers';
import type { DbHandle } from '../db/client';
import { assets, campaignMembers, records, users } from '../db/schema';

import { EVENT_BUDGET } from './socket';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Person {
  cookie: string;
  id: string;
  name: string;
}

/** A connection, and everything the server has sent it. */
interface Client {
  socket: Socket;
  stages: LiveStage[];
  presences: Presence[];
  /** How many times each of these arrived. */
  started: number;
  ended: number;
}

const WAIT_MS = 3000;

describe('The live room', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let port: number;
  let gm: Person;
  let players: Person[];
  let outsider: Person;
  const open: Socket[] = [];

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    await app.listen({ port: 0, host: '127.0.0.1' });
    ({ port } = app.server.address() as AddressInfo);

    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '', name };
    }
    gm = await person('17400', 'Live GM');
    outsider = await person('17499', 'Live Outsider');
    players = [];
    for (let n = 1; n <= SESSION_MAX_PLAYERS + 1; n += 1) {
      players.push(await person(String(17400 + n), `Live Player ${String(n)}`));
    }
  });

  afterEach(() => {
    for (const socket of open.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await app.close();
  });

  function call(method: Method, url: string, who: Person, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: { ...SAME_ORIGIN, cookie: who.cookie },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  /** A campaign of `owner` with the first `seats` players in it. */
  async function table(name: string, seats = 1, owner = gm): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', owner, { name });
    expect(response.statusCode).toBe(201);
    const campaign = response.json<Campaign>();
    if (seats > 0) {
      await handle.db.insert(campaignMembers).values(
        players.slice(0, seats).map((player) => ({
          campaignId: campaign.id,
          userId: player.id,
          role: 'player' as const,
        })),
      );
    }
    return campaign;
  }

  async function start(campaign: Campaign, who = gm) {
    const response = await call('POST', `/api/campaigns/${campaign.id}/play-session`, who);
    expect(response.statusCode, response.body).toBe(201);
  }

  async function end(campaign: Campaign, who = gm) {
    const response = await call('POST', `/api/campaigns/${campaign.id}/play-session/end`, who);
    expect(response.statusCode, response.body).toBe(204);
  }

  /** A record of a placeable type with an image in use. */
  async function drawn(
    campaign: Campaign,
    type: 'prop' | 'npc',
    name: string,
    owner = gm,
  ): Promise<CampaignRecord> {
    const made = await call('POST', `/api/campaigns/${campaign.id}/records`, owner, { type, name });
    expect(made.statusCode, made.body).toBe(201);
    const record = made.json<CampaignRecord>();
    const [asset] = await handle.db
      .insert(assets)
      .values({
        campaignId: campaign.id,
        recordId: record.id,
        createdBy: owner.id,
        kind: type === 'npc' ? 'character' : 'prop',
        status: 'approved',
        prompt: 'a test image',
        model: 'test/model',
        styleBibleVersion: 1,
        quality: 'medium',
        aspectRatio: '2:3',
        originalPath: `test/${randomUUID()}/original.png`,
        mediaType: 'image/png',
        processedPath: `test/${randomUUID()}/processed.webp`,
        processedWidth: 640,
        processedHeight: 1024,
        processingVersion: 3,
      })
      .returning({ id: assets.id });
    await handle.db
      .update(records)
      .set({ visualAssetId: asset?.id ?? null })
      .where(eq(records.id, record.id));
    return record;
  }

  function at(recordId: string, overrides: Partial<SceneObjectInput> = {}): SceneObjectInput {
    return {
      id: randomUUID(),
      recordId,
      across: 0.5,
      up: 0,
      depthTick: 5,
      scale: 1,
      flipped: false,
      ...overrides,
    };
  }

  async function scene(
    campaign: Campaign,
    name: string,
    objects: SceneObjectInput[],
    owner = gm,
  ): Promise<Scene> {
    const made = await call('POST', `/api/campaigns/${campaign.id}/scenes`, owner, { name });
    expect(made.statusCode, made.body).toBe(201);
    const placed = await call(
      'PUT',
      `/api/campaigns/${campaign.id}/scenes/${made.json<Scene>().id}/objects`,
      owner,
      { objects },
    );
    expect(placed.statusCode, placed.body).toBe(200);
    return placed.json<Scene>();
  }

  /** A scene with a well in sight, a hidden trapdoor and a fishmonger waiting below. */
  async function marketScene(campaign: Campaign): Promise<Scene> {
    const well = await drawn(campaign, 'prop', 'The cursed well');
    const trapdoor = await drawn(campaign, 'prop', 'Secret trapdoor');
    const marta = await drawn(campaign, 'npc', 'Old Marta');
    return scene(campaign, 'Ambush at the market', [
      at(well.id),
      at(trapdoor.id, { shown: false }),
      at(marta.id),
    ]);
  }

  /** Connects to the live room. Rejects when the server refuses the connection. */
  function connect(who: Person | null, headers: Record<string, string> = {}): Promise<Client> {
    const socket = io(`http://127.0.0.1:${String(port)}${PLAY_SOCKET.namespace}`, {
      path: PLAY_SOCKET.path,
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { ...(who === null ? {} : { cookie: who.cookie }), ...headers },
    });
    open.push(socket);
    const client: Client = { socket, stages: [], presences: [], started: 0, ended: 0 };
    socket.on(PLAY_SOCKET.stage, (stage: LiveStage) => client.stages.push(stage));
    socket.on(PLAY_SOCKET.presence, (presence: Presence) => client.presences.push(presence));
    socket.on(PLAY_SOCKET.started, () => (client.started += 1));
    socket.on(PLAY_SOCKET.ended, () => (client.ended += 1));
    return new Promise((resolve, reject) => {
      socket.once('connect', () => {
        resolve(client);
      });
      socket.once('connect_error', reject);
    });
  }

  const join = (client: Client, campaignId: string): Promise<JoinResult> =>
    client.socket.timeout(WAIT_MS).emitWithAck(PLAY_SOCKET.join, { campaignId });

  /** Connects and joins, expecting to get in. */
  async function seated(who: Person, campaign: Campaign) {
    const client = await connect(who);
    const result = await join(client, campaign.id);
    if (result.status !== 'joined') throw new Error(`join answered ${result.status}`);
    return { client, ...result };
  }

  const act = (client: Client, event: string, ...payload: unknown[]): Promise<ActionResult> =>
    client.socket.timeout(WAIT_MS).emitWithAck(event, ...payload);

  const last = <T>(list: readonly T[]): T | undefined => list[list.length - 1];
  const names = (presence: Presence | undefined) => presence?.map((person) => person.displayName);

  describe('connecting', () => {
    it('refuses a connection with no Stagehand session', async () => {
      await expect(connect(null)).rejects.toThrow('unauthorized');
      await expect(
        connect({ cookie: 'better-auth.session_token=forged', id: '', name: '' }),
      ).rejects.toThrow('unauthorized');
    });

    it('refuses a page on another site, even with the visitor’s cookie', async () => {
      await expect(connect(gm, { origin: 'https://evil.example' })).rejects.toThrow();
    });

    it('accepts the app’s own pages', async () => {
      const client = await connect(gm, { origin: PUBLIC_URL });

      expect(client.socket.connected).toBe(true);
    });
  });

  describe('joining', () => {
    it('answers not-found for a campaign the user is not in, or no campaign at all', async () => {
      const campaign = await table('Private Table');
      await start(campaign);
      const client = await connect(outsider);

      expect(await join(client, campaign.id)).toEqual({ status: 'not-found' });
      expect(await join(client, randomUUID())).toEqual({ status: 'not-found' });
      expect(
        await client.socket.timeout(WAIT_MS).emitWithAck(PLAY_SOCKET.join, { campaignId: 'nope' }),
      ).toEqual({ status: 'not-found' });
      expect(await client.socket.timeout(WAIT_MS).emitWithAck(PLAY_SOCKET.join, null)).toEqual({
        status: 'not-found',
      });
      await end(campaign);
    });

    it('has a member wait while no session runs, and tells them when one starts', async () => {
      const campaign = await table('Waiting Table');
      const player = await connect(players[0] ?? null);

      expect(await join(player, campaign.id)).toEqual({ status: 'no-session' });
      expect(player.started).toBe(0);

      await start(campaign);
      await vi.waitFor(() => {
        expect(player.started).toBe(1);
      });
      expect((await join(player, campaign.id)).status).toBe('joined');
      await end(campaign);
    });

    it('gives each role its own view of the stage', async () => {
      const campaign = await table('Two Views');
      const market = await marketScene(campaign);
      await start(campaign);
      const director = await seated(gm, campaign);
      expect(await act(director.client, PLAY_SOCKET.loadScene, { sceneId: market.id })).toEqual({
        ok: true,
      });

      const forGm = (await seated(gm, campaign)).stage as GmStage;
      const forPlayer = (await seated(players[0] ?? gm, campaign)).stage as PlayerStage;

      expect(forGm.role).toBe('gm');
      expect(forGm.scene).toEqual({ id: market.id, name: 'Ambush at the market' });
      expect(forGm.objects.map((object) => [object.subject.name, object.shown])).toEqual([
        ['The cursed well', true],
        ['Secret trapdoor', false],
        ['Old Marta', false],
      ]);

      expect(forPlayer.role).toBe('player');
      expect(forPlayer.objects).toHaveLength(1);
      expect(forPlayer.objects[0]?.id).toBe(market.objects[0]?.id);
      const sent = JSON.stringify(forPlayer);
      for (const secret of ['well', 'trapdoor', 'Marta', 'Ambush', market.id]) {
        expect(sent, secret).not.toContain(secret);
      }
      await end(campaign);
    });

    it('tells everyone who is here, as people come and go', async () => {
      const campaign = await table('Presence Table', 2);
      await start(campaign);

      const director = await seated(gm, campaign);
      expect(names(director.presence)).toEqual(['Live GM']);

      const first = await seated(players[0] ?? gm, campaign);
      expect(names(first.presence)).toEqual(['Live GM', 'Live Player 1']);
      await vi.waitFor(() => {
        expect(names(last(director.client.presences))).toEqual(['Live GM', 'Live Player 1']);
      });
      expect(last(director.client.presences)?.[1]).toEqual({
        userId: players[0]?.id,
        displayName: 'Live Player 1',
        avatarUrl: expect.stringContaining('https://') as string,
        role: 'player',
        characterName: null,
      });

      const second = await seated(players[1] ?? gm, campaign);
      await vi.waitFor(() => {
        expect(last(first.client.presences)).toHaveLength(3);
      });

      second.client.socket.disconnect();
      await vi.waitFor(() => {
        expect(names(last(director.client.presences))).toEqual(['Live GM', 'Live Player 1']);
        expect(names(last(first.client.presences))).toEqual(['Live GM', 'Live Player 1']);
      });
      await end(campaign);
    });

    it('moves a connection out of one campaign when it joins another', async () => {
      const one = await table('First Table');
      const two = await table('Second Table');
      await start(one);
      await start(two);
      const director = await seated(gm, one);
      const player = await seated(players[0] ?? gm, one);
      await vi.waitFor(() => {
        expect(last(director.client.presences)).toHaveLength(2);
      });

      expect((await join(player.client, two.id)).status).toBe('joined');

      await vi.waitFor(() => {
        expect(names(last(director.client.presences))).toEqual(['Live GM']);
      });
      await end(one);
      await end(two);
    });
  });

  describe('running the stage', () => {
    it('sends everyone the stage when the GM loads a scene or moves the curtain', async () => {
      const campaign = await table('Synced Table');
      const market = await marketScene(campaign);
      await start(campaign);
      const director = await seated(gm, campaign);
      const player = await seated(players[0] ?? gm, campaign);
      expect(player.stage).toMatchObject({ sceneLoad: 0, curtainOpen: false, objects: [] });

      expect(await act(director.client, PLAY_SOCKET.loadScene, { sceneId: market.id })).toEqual({
        ok: true,
      });

      // A new session's curtain is closed, and a load leaves it closed (F3.4).
      await vi.waitFor(() => {
        expect(last(player.client.stages)).toMatchObject({
          role: 'player',
          sceneLoad: 1,
          curtainOpen: false,
        });
        expect(last(director.client.stages)).toMatchObject({ role: 'gm', sceneLoad: 1 });
      });
      expect(last(player.client.stages)?.objects).toHaveLength(1);
      expect(last(director.client.stages)?.objects).toHaveLength(3);
      expect(JSON.stringify(last(player.client.stages))).not.toContain('trapdoor');

      expect(await act(director.client, PLAY_SOCKET.openCurtain)).toEqual({ ok: true });
      await vi.waitFor(() => {
        expect(last(player.client.stages)?.curtainOpen).toBe(true);
        expect(last(director.client.stages)?.curtainOpen).toBe(true);
      });

      expect(await act(director.client, PLAY_SOCKET.closeCurtain)).toEqual({ ok: true });
      await vi.waitFor(() => {
        expect(last(player.client.stages)?.curtainOpen).toBe(false);
      });
      expect(last(player.client.stages)?.sceneLoad).toBe(1);
      await end(campaign);
    });

    it('refuses a player every GM action, and changes nothing', async () => {
      const campaign = await table('Guarded Table');
      const market = await marketScene(campaign);
      await start(campaign);
      const director = await seated(gm, campaign);
      const player = await seated(players[0] ?? gm, campaign);
      const refusal = { ok: false, message: 'Only the GM can do that' };

      expect(await act(player.client, PLAY_SOCKET.loadScene, { sceneId: market.id })).toEqual(
        refusal,
      );
      expect(await act(player.client, PLAY_SOCKET.openCurtain)).toEqual(refusal);
      expect(await act(player.client, PLAY_SOCKET.closeCurtain)).toEqual(refusal);
      const well = market.objects[0]?.record.id ?? '';
      expect(
        await act(player.client, PLAY_SOCKET.addObject, { id: randomUUID(), recordId: well }),
      ).toEqual(refusal);
      const id = randomUUID();
      expect(await act(player.client, PLAY_SOCKET.moveObject, { id, across: 0.2 })).toEqual(
        refusal,
      );
      for (const event of [
        PLAY_SOCKET.removeObject,
        PLAY_SOCKET.showProp,
        PLAY_SOCKET.hideProp,
        PLAY_SOCKET.raisePuppet,
        PLAY_SOCKET.lowerPuppet,
      ]) {
        expect(await act(player.client, event, { id })).toEqual(refusal);
      }

      const now = (await seated(gm, campaign)).stage;
      expect(now).toMatchObject({ sceneLoad: 0, curtainOpen: false, objects: [] });
      expect(director.client.stages).toEqual([]);
      expect(player.client.stages).toEqual([]);
      await end(campaign);
    });

    it('runs the control desk: add, move, show, raise and remove, for everyone', async () => {
      const campaign = await table('Desk Table');
      const market = await marketScene(campaign);
      const gull = await drawn(campaign, 'npc', 'Gull the smuggler');
      await start(campaign);
      const director = await seated(gm, campaign);
      const player = await seated(players[0] ?? gm, campaign);
      expect(await act(director.client, PLAY_SOCKET.loadScene, { sceneId: market.id })).toEqual({
        ok: true,
      });
      expect(await act(director.client, PLAY_SOCKET.openCurtain)).toEqual({ ok: true });
      const [, trapdoor, marta] = market.objects;
      const ok = { ok: true };

      const gullId = randomUUID();
      expect(
        await act(director.client, PLAY_SOCKET.addObject, { id: gullId, recordId: gull.id }),
      ).toEqual(ok);
      expect(
        await act(director.client, PLAY_SOCKET.moveObject, {
          id: gullId,
          across: 0.8,
          depthTick: 2,
        }),
      ).toEqual(ok);
      expect(await act(director.client, PLAY_SOCKET.raisePuppet, { id: gullId })).toEqual(ok);
      expect(await act(director.client, PLAY_SOCKET.showProp, { id: trapdoor?.id })).toEqual(ok);
      expect(await act(director.client, PLAY_SOCKET.removeObject, { id: marta?.id })).toEqual(ok);

      await vi.waitFor(() => {
        const forGm = last(director.client.stages) as GmStage | undefined;
        expect(forGm?.objects.map((object) => [object.subject.name, object.shown])).toEqual([
          ['The cursed well', true],
          ['Secret trapdoor', true],
          ['Gull the smuggler', true],
        ]);
        expect(forGm?.objects.at(-1)).toMatchObject({
          across: 0.8,
          depthTick: 2,
          subject: { revealed: true },
        });
        expect(last(player.client.stages)?.objects).toHaveLength(3);
      });
      expect(JSON.stringify(last(player.client.stages))).not.toContain('Gull');

      expect(await act(director.client, PLAY_SOCKET.lowerPuppet, { id: gullId })).toEqual(ok);
      expect(await act(director.client, PLAY_SOCKET.hideProp, { id: trapdoor?.id })).toEqual(ok);
      await vi.waitFor(() => {
        expect(last(player.client.stages)?.objects).toHaveLength(1);
      });
      await end(campaign);
    });

    it('refuses desk actions that are malformed or name nothing on the stage', async () => {
      const campaign = await table('Fussy Table');
      await start(campaign);
      const director = await seated(gm, campaign);

      expect(await act(director.client, PLAY_SOCKET.addObject, { id: randomUUID() })).toEqual({
        ok: false,
        message: 'Choose a record or a PC to add',
      });
      expect(
        await act(director.client, PLAY_SOCKET.moveObject, { id: randomUUID(), across: 2 }),
      ).toEqual({ ok: false, message: 'That place is not on the stage' });
      expect(await act(director.client, PLAY_SOCKET.raisePuppet, { id: 'nope' })).toEqual({
        ok: false,
        message: 'Choose something on the stage',
      });
      expect(await act(director.client, PLAY_SOCKET.raisePuppet, { id: randomUUID() })).toEqual({
        ok: false,
        message: 'That is no longer on the stage',
      });
      await end(campaign);
    });

    it('treats a GM of another campaign as the player they are here', async () => {
      // Player 1 runs their own campaign, and is a player at this table.
      const own = await table('Their Own Table', 0, players[0] ?? gm);
      const ownScene = await scene(own, 'Their scene', [], players[0] ?? gm);
      const campaign = await table('Borrowed Table');
      await start(campaign);
      const player = await seated(players[0] ?? gm, campaign);

      expect(await act(player.client, PLAY_SOCKET.loadScene, { sceneId: ownScene.id })).toEqual({
        ok: false,
        message: 'Only the GM can do that',
      });
      await end(campaign);
    });

    it('refuses actions from a connection that has not joined', async () => {
      const client = await connect(gm);

      expect(await act(client, PLAY_SOCKET.openCurtain)).toEqual({
        ok: false,
        message: 'Join the session first',
      });
    });

    it('refuses a scene that is missing, malformed or from another campaign', async () => {
      const campaign = await table('Careful Table');
      const elsewhere = await table('Elsewhere Table', 0);
      const foreign = await scene(elsewhere, 'Not yours to load', []);
      await start(campaign);
      const director = await seated(gm, campaign);

      expect(await act(director.client, PLAY_SOCKET.loadScene, {})).toEqual({
        ok: false,
        message: 'Choose a scene to load',
      });
      for (const sceneId of [foreign.id, randomUUID()]) {
        expect(await act(director.client, PLAY_SOCKET.loadScene, { sceneId })).toEqual({
          ok: false,
          message: 'Scene not found',
        });
      }
      expect((await seated(gm, campaign)).stage.sceneLoad).toBe(0);
      await end(campaign);
    });

    it('ignores a message with nothing to answer through', async () => {
      const campaign = await table('Quiet Table');
      await start(campaign);
      const director = await seated(gm, campaign);

      director.client.socket.emit(PLAY_SOCKET.openCurtain);
      director.client.socket.emit(PLAY_SOCKET.loadScene, { sceneId: randomUUID() });
      director.client.socket.emit(PLAY_SOCKET.join, { campaignId: campaign.id });

      // Still connected and still served.
      expect(await act(director.client, PLAY_SOCKET.closeCurtain)).toEqual({ ok: true });
      expect((await seated(gm, campaign)).stage.curtainOpen).toBe(false);
      await end(campaign);
    });

    it('disconnects a connection that floods the room', async () => {
      const campaign = await table('Flooded Table');
      await start(campaign);
      const { client } = await seated(players[0] ?? gm, campaign);
      const dropped = new Promise<string>((resolve) => {
        client.socket.once('disconnect', resolve);
      });

      for (let n = 0; n <= EVENT_BUDGET.events; n += 1) {
        client.socket.emit(PLAY_SOCKET.openCurtain, () => undefined);
      }

      expect(await dropped).toBe('io server disconnect');
      await end(campaign);
    });
  });

  describe('the 6-player cap', () => {
    it('seats 6 players, turns the 7th away, and lets a seated player open a second tab', async () => {
      const campaign = await table('Full Table', SESSION_MAX_PLAYERS + 1);
      await start(campaign);
      const director = await seated(gm, campaign);
      for (const player of players.slice(0, SESSION_MAX_PLAYERS)) await seated(player, campaign);

      const seventh = await connect(players[SESSION_MAX_PLAYERS] ?? null);
      expect(await join(seventh, campaign.id)).toEqual({ status: 'full' });

      const secondTab = await seated(players[0] ?? gm, campaign);
      expect(secondTab.presence).toHaveLength(SESSION_MAX_PLAYERS + 1);
      expect(names(secondTab.presence)).not.toContain('Live Player 7');
      // The GM is not one of the 6, and can come in again too.
      expect((await seated(gm, campaign)).presence).toHaveLength(SESSION_MAX_PLAYERS + 1);
      expect(names(last(director.client.presences))).not.toContain('Live Player 7');
      await end(campaign);
    });

    it('gives the seat of a player who left to the next one who asks', async () => {
      const campaign = await table('Musical Chairs', SESSION_MAX_PLAYERS + 1);
      await start(campaign);
      const director = await seated(gm, campaign);
      const sitting = [];
      for (const player of players.slice(0, SESSION_MAX_PLAYERS)) {
        sitting.push(await seated(player, campaign));
      }
      const seventh = await connect(players[SESSION_MAX_PLAYERS] ?? null);
      expect(await join(seventh, campaign.id)).toEqual({ status: 'full' });

      sitting[2]?.client.socket.disconnect();
      await vi.waitFor(() => {
        expect(last(director.client.presences)).toHaveLength(SESSION_MAX_PLAYERS);
      });

      expect((await join(seventh, campaign.id)).status).toBe('joined');
      await end(campaign);
    });
  });

  describe('coming back, ending and leaving', () => {
    it('gives a player who dropped the stage as it is now', async () => {
      const campaign = await table('Reconnect Table');
      const market = await marketScene(campaign);
      await start(campaign);
      const director = await seated(gm, campaign);
      const before = await seated(players[0] ?? gm, campaign);
      expect(before.stage.sceneLoad).toBe(0);

      before.client.socket.disconnect();
      await vi.waitFor(() => {
        expect(names(last(director.client.presences))).toEqual(['Live GM']);
      });
      await act(director.client, PLAY_SOCKET.loadScene, { sceneId: market.id });
      await act(director.client, PLAY_SOCKET.closeCurtain);

      const after = await seated(players[0] ?? gm, campaign);
      expect(after.stage).toMatchObject({ role: 'player', sceneLoad: 1, curtainOpen: false });
      expect(after.stage.objects).toHaveLength(1);
      expect(names(after.presence)).toEqual(['Live GM', 'Live Player 1']);
      await end(campaign);
    });

    it('tells everyone when the GM ends the session, and has them wait for the next', async () => {
      const campaign = await table('Ending Table', SESSION_MAX_PLAYERS + 1);
      await start(campaign);
      const director = await seated(gm, campaign);
      const player = await seated(players[0] ?? gm, campaign);

      await end(campaign);

      await vi.waitFor(() => {
        expect(director.client.ended).toBe(1);
        expect(player.client.ended).toBe(1);
      });
      expect(await act(director.client, PLAY_SOCKET.openCurtain)).toEqual({
        ok: false,
        message: 'Join the session first',
      });
      expect(await join(player.client, campaign.id)).toEqual({ status: 'no-session' });

      // Both were left waiting, so the next start reaches them without asking again.
      await start(campaign);
      await vi.waitFor(() => {
        expect(director.client.started).toBe(1);
        expect(player.client.started).toBeGreaterThanOrEqual(1);
      });
      const again = await join(player.client, campaign.id);
      expect(again.status === 'joined' && names(again.presence)).toEqual(['Live Player 1']);
      await end(campaign);
    });

    it('drops a member the GM removes, who can’t come back in', async () => {
      const campaign = await table('Shrinking Table', 2);
      await start(campaign);
      const director = await seated(gm, campaign);
      const removed = await seated(players[1] ?? gm, campaign);
      const staying = await seated(players[0] ?? gm, campaign);
      const dropped = new Promise<string>((resolve) => {
        removed.client.socket.once('disconnect', resolve);
      });

      const response = await call(
        'DELETE',
        `/api/campaigns/${campaign.id}/members/${players[1]?.id ?? ''}`,
        gm,
      );
      expect(response.statusCode).toBe(204);

      expect(await dropped).toBe('io server disconnect');
      await vi.waitFor(() => {
        expect(names(last(director.client.presences))).toEqual(['Live GM', 'Live Player 1']);
      });
      expect(staying.client.socket.connected).toBe(true);
      const back = await connect(players[1] ?? null);
      expect(await join(back, campaign.id)).toEqual({ status: 'not-found' });
      await end(campaign);
    });
  });
});
