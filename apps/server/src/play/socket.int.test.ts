/**
 * The live room (F3.3b, governance §13 and §14 "Live events", D-50), with real connections to
 * a listening server and a real Postgres: who may connect, joining and waiting, each role's
 * view of the stage, the GM's actions and a player trying them, the 6-player cap, coming back
 * after a drop, ending, and a removed member; rolls, Hope and Fear (F3.6), with fixed dice; and
 * puppet motion (F3.7): emotes and who is talking.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  PLAY_SOCKET,
  SESSION_MAX_PLAYERS,
  type ActionResult,
  type Campaign,
  type CampaignRecord,
  type EmotePlayed,
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
import { assets, campaignMembers, characters, records, users } from '../db/schema';

import { EMOTE_GAP_MS, EVENT_BUDGET } from './socket';

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
  /** Times the journal changed (F3.5). */
  journal: number;
  /** PCs whose sheets the server said changed (F3.6). */
  sheets: string[];
  /** Times the GM was told the log grew (F3.6). */
  logs: number;
  /** Emotes played (F3.7). */
  emotes: EmotePlayed[];
}

/** The next dice the server rolls (F3.6), Hope die first; a 6 when none are queued. */
const dice: number[] = [];

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
    ({ app, handle } = await buildTestApp({ rollDie: () => dice.shift() ?? 6 }));
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
    const client: Client = {
      socket,
      stages: [],
      presences: [],
      started: 0,
      ended: 0,
      journal: 0,
      sheets: [],
      logs: 0,
      emotes: [],
    };
    socket.on(PLAY_SOCKET.stage, (stage: LiveStage) => client.stages.push(stage));
    socket.on(PLAY_SOCKET.presence, (presence: Presence) => client.presences.push(presence));
    socket.on(PLAY_SOCKET.started, () => (client.started += 1));
    socket.on(PLAY_SOCKET.ended, () => (client.ended += 1));
    socket.on(PLAY_SOCKET.journalChanged, () => (client.journal += 1));
    socket.on(PLAY_SOCKET.sheetChanged, (changed: { characterId: string }) =>
      client.sheets.push(changed.characterId),
    );
    socket.on(PLAY_SOCKET.logChanged, () => (client.logs += 1));
    socket.on(PLAY_SOCKET.emote, (played: EmotePlayed) => client.emotes.push(played));
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
        characterId: null,
        speaking: false,
        voicing: null,
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

    it('tells everyone the journal changed: a reveal on stage, a note, an entry (F3.5)', async () => {
      const campaign = await table('Journal Table');
      const market = await marketScene(campaign);
      await start(campaign);
      const director = await seated(gm, campaign);
      const player = await seated(players[0] ?? gm, campaign);
      const both = [director.client, player.client];

      // Loading behind a closed curtain may reveal nothing, but journals read again anyway.
      expect(await act(director.client, PLAY_SOCKET.loadScene, { sceneId: market.id })).toEqual({
        ok: true,
      });
      await vi.waitFor(() => {
        for (const client of both) expect(client.journal).toBe(1);
      });
      // Opening the curtain reveals the well.
      expect(await act(director.client, PLAY_SOCKET.openCurtain)).toEqual({ ok: true });
      await vi.waitFor(() => {
        for (const client of both) expect(client.journal).toBe(2);
      });
      const seen = last(player.client.stages);
      const well = seen?.role === 'player' ? seen.objects[0] : undefined;
      expect(well?.recordId).toEqual(expect.any(String));

      // Closing the curtain and moving reveal nothing.
      expect(await act(director.client, PLAY_SOCKET.closeCurtain)).toEqual({ ok: true });
      await vi.waitFor(() => {
        expect(last(player.client.stages)?.curtainOpen).toBe(false);
      });
      expect(player.client.journal).toBe(2);

      // A note and an entry through the site reach the table.
      const note = await call(
        'POST',
        `/api/campaigns/${campaign.id}/journal/records/${String(well?.recordId)}/notes`,
        players[0] ?? gm,
        { body: 'It hums' },
      );
      expect(note.statusCode, note.body).toBe(201);
      await vi.waitFor(() => {
        for (const client of both) expect(client.journal).toBe(3);
      });
      const entry = await call(
        'POST',
        `/api/campaigns/${campaign.id}/journal/entries`,
        players[0] ?? gm,
        {
          title: 'Market map',
          description: '',
        },
      );
      expect(entry.statusCode, entry.body).toBe(201);
      await vi.waitFor(() => {
        for (const client of both) expect(client.journal).toBe(4);
      });
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

  describe('rolls, Hope and Fear (F3.6)', () => {
    /** A PC for `player`, with Agility +2 and the Hope given. */
    async function pc(campaign: Campaign, player: Person, name: string, hope = 2, hopeBonus = 0) {
      const made = await call('POST', `/api/campaigns/${campaign.id}/characters`, gm, {
        name,
        assignToUserId: player.id,
      });
      expect(made.statusCode, made.body).toBe(201);
      const { id } = made.json<{ id: string }>();
      const patched = await call('PATCH', `/api/campaigns/${campaign.id}/characters/${id}`, gm, {
        traits: { agility: 2, strength: 1, finesse: 0, instinct: -1, presence: 0, knowledge: 0 },
        hope,
        hopeBonus,
      });
      expect(patched.statusCode, patched.body).toBe(200);
      return id;
    }

    async function hopeOf(campaign: Campaign, characterId: string) {
      const sheet = await call(
        'GET',
        `/api/campaigns/${campaign.id}/characters/${characterId}`,
        gm,
      );
      return sheet.json<{ hope: number }>().hope;
    }

    async function logOf(campaign: Campaign, who = gm) {
      const response = await call('GET', `/api/campaigns/${campaign.id}/play-session/log`, who);
      return response;
    }

    /** A running session with Mira (player 1, own Hope bonus +1) and Bram (player 2), seated. */
    async function rollTable(name: string) {
      const campaign = await table(name, 2);
      const mira = await pc(campaign, players[0] ?? gm, 'Mira', 2, 1);
      const bram = await pc(campaign, players[1] ?? gm, 'Bram', 0);
      await start(campaign);
      const director = await seated(gm, campaign);
      const first = await seated(players[0] ?? gm, campaign);
      const second = await seated(players[1] ?? gm, campaign);
      return { campaign, mira, bram, director, first, second };
    }

    const gmView = (client: Client) => last(client.stages) as GmStage;
    const playerView = (client: Client) => last(client.stages) as PlayerStage;

    it('starts with the GM’s Fear and nothing called, and only the GM sees the party', async () => {
      const { campaign, mira, bram, director, first } = await rollTable('Roll Basics');

      expect(director.stage).toMatchObject({
        fear: 3,
        fearCap: 12,
        calls: [],
        lastRoll: null,
        lastFearSpend: null,
        party: [
          { characterId: bram, name: 'Bram', playerName: 'Live Player 2', hope: 0 },
          { characterId: mira, name: 'Mira', playerName: 'Live Player 1', hope: 2 },
        ],
      });
      expect(first.stage).toMatchObject({ fear: 3, calls: [], lastRoll: null });
      expect(first.stage).not.toHaveProperty('party');
      await end(campaign);
    });

    it("calls a roll, and its player rolls it, spending Hope for +2 plus the PC's own +1", async () => {
      const { campaign, mira, director, first, second } = await rollTable('Climbing');

      expect(
        await act(director.client, PLAY_SOCKET.callRoll, {
          characterIds: [mira],
          trait: 'agility',
          difficulty: 12,
          hidden: false,
          label: 'Climb the wall',
        }),
      ).toEqual({ ok: true });
      await waitForCalls(second.client, 1);
      const [called] = await waitForCalls(first.client, 1);
      expect(called).toMatchObject({
        characterId: mira,
        characterName: 'Mira',
        trait: 'agility',
        difficulty: 12,
        hidden: false,
        label: 'Climb the wall',
      });

      dice.push(9, 4);
      expect(
        await act(first.client, PLAY_SOCKET.makeRoll, { callId: called?.id, spendHope: true }),
      ).toEqual({ ok: true });

      await vi.waitFor(() => {
        expect(playerView(second.client).lastRoll).not.toBeNull();
        expect(first.client.sheets).toContain(mira);
        expect(director.client.logs).toBeGreaterThan(0);
      });
      expect(playerView(second.client)).toMatchObject({
        calls: [],
        fear: 3,
        lastRoll: {
          characterName: 'Mira',
          trait: 'agility',
          label: 'Climb the wall',
          dice: { hope: 9, fear: 4 },
          modifier: 2,
          hopeBonus: 3,
          total: 18,
          critical: false,
          success: true,
          gained: 'hope',
          difficulty: 12,
          hidden: false,
        },
      });
      // 2 Hope, 1 spent, 1 gained from the Hope die.
      expect(await hopeOf(campaign, mira)).toBe(2);

      const log = await logOf(campaign);
      expect(log.statusCode).toBe(200);
      expect(
        log.json<{ entries: { kind: string; text: string; actorName: string }[] }>().entries[0],
      ).toMatchObject({
        kind: 'roll',
        actorName: 'Live Player 1',
        text: 'Mira rolled Agility (Climb the wall): 9 + 4 + 2 + 3 = 18 vs 12: success with Hope',
      });
      await end(campaign);
    });

    it('gives the GM Fear when the Fear die is higher, and the party’s Hope follows', async () => {
      const { campaign, mira, director, first } = await rollTable('Fear Die');
      await act(director.client, PLAY_SOCKET.callRoll, {
        characterIds: [mira],
        trait: 'instinct',
        difficulty: 20,
        hidden: false,
      });
      const [called] = await waitForCalls(first.client, 1);

      dice.push(2, 10);
      expect(
        await act(first.client, PLAY_SOCKET.makeRoll, { callId: called?.id, spendHope: false }),
      ).toEqual({ ok: true });
      await vi.waitFor(() => {
        expect(gmView(director.client).fear).toBe(4);
      });
      expect(gmView(director.client).lastRoll).toMatchObject({
        total: 11,
        modifier: -1,
        success: false,
        gained: 'fear',
        label: null,
      });
      expect(await hopeOf(campaign, mira)).toBe(2);
      await end(campaign);
    });

    /** Waits until a client's stage holds `count` calls, and answers them. */
    async function waitForCalls(client: Client, count: number) {
      await vi.waitFor(() => {
        expect(playerView(client).calls).toHaveLength(count);
      });
      return playerView(client).calls;
    }

    it('keeps a hidden difficulty and its result from players until the GM reveals it', async () => {
      const { campaign, mira, director, first } = await rollTable('Hidden Roll');
      await act(director.client, PLAY_SOCKET.callRoll, {
        characterIds: [mira],
        trait: 'agility',
        difficulty: 15,
        hidden: true,
      });
      const [called] = await waitForCalls(first.client, 1);
      expect(called).toMatchObject({ difficulty: null, hidden: true });
      expect(gmView(director.client).calls[0]).toMatchObject({ difficulty: 15 });

      dice.push(3, 5);
      await act(first.client, PLAY_SOCKET.makeRoll, { callId: called?.id, spendHope: false });
      await vi.waitFor(() => {
        expect(playerView(first.client).lastRoll).not.toBeNull();
      });
      const hidden = playerView(first.client).lastRoll;
      expect(hidden).toMatchObject({ total: 10, difficulty: null, success: null, revealed: false });
      expect(JSON.stringify(playerView(first.client))).not.toMatch(/"difficulty":15/);
      expect(gmView(director.client).lastRoll).toMatchObject({
        difficulty: 15,
        success: false,
      });

      expect(await act(director.client, PLAY_SOCKET.revealRoll, { rollId: hidden?.id })).toEqual({
        ok: true,
      });
      await vi.waitFor(() => {
        expect(playerView(first.client).lastRoll).toMatchObject({
          difficulty: 15,
          success: false,
          revealed: true,
        });
      });
      // Revealing twice is harmless and logs once.
      expect(await act(director.client, PLAY_SOCKET.revealRoll, { rollId: hidden?.id })).toEqual({
        ok: true,
      });
      const kinds = (await logOf(campaign)).json<{ entries: { kind: string }[] }>().entries;
      expect(kinds.filter((entry) => entry.kind === 'roll_reveal')).toHaveLength(1);
      await end(campaign);
    });

    it('tells players a critical success, even with a hidden difficulty', async () => {
      const { campaign, mira, director, first } = await rollTable('Hidden Critical');
      await act(director.client, PLAY_SOCKET.callRoll, {
        characterIds: [mira],
        trait: 'agility',
        difficulty: 40,
        hidden: true,
      });
      const [called] = await waitForCalls(first.client, 1);

      dice.push(6, 6);
      await act(first.client, PLAY_SOCKET.makeRoll, { callId: called?.id, spendHope: false });
      await vi.waitFor(() => {
        expect(playerView(first.client).lastRoll).toMatchObject({
          critical: true,
          success: true,
          difficulty: null,
          gained: 'hope',
        });
      });
      expect(await hopeOf(campaign, mira)).toBe(3);
      await end(campaign);
    });

    it('calls a roll for several PCs at once, replaces a call, and takes one back', async () => {
      const { campaign, mira, bram, director, first } = await rollTable('Group Call');
      const everyone = { trait: 'instinct', difficulty: 10, hidden: false };
      await act(director.client, PLAY_SOCKET.callRoll, { characterIds: [mira, bram], ...everyone });
      const calls = await waitForCalls(first.client, 2);
      expect(calls.map((entry) => entry.characterName).sort()).toEqual(['Bram', 'Mira']);
      const miraCall = calls.find((entry) => entry.characterId === mira);

      await act(director.client, PLAY_SOCKET.callRoll, {
        characterIds: [mira],
        trait: 'strength',
        difficulty: 8,
        hidden: false,
      });
      await vi.waitFor(() => {
        const now = playerView(first.client).calls;
        expect(now.find((entry) => entry.characterId === mira)?.trait).toBe('strength');
      });
      expect(playerView(first.client).calls).toHaveLength(2);
      // The replaced call can't be rolled.
      expect(
        await act(first.client, PLAY_SOCKET.makeRoll, { callId: miraCall?.id, spendHope: false }),
      ).toEqual({ ok: false, message: 'That roll is no longer called' });

      const bramCall = gmView(director.client).calls.find((entry) => entry.characterId === bram);
      expect(await act(director.client, PLAY_SOCKET.cancelRoll, { callId: bramCall?.id })).toEqual({
        ok: true,
      });
      await waitForCalls(first.client, 1);
      expect(await act(director.client, PLAY_SOCKET.cancelRoll, { callId: bramCall?.id })).toEqual({
        ok: false,
        message: 'That roll is no longer called',
      });
      await end(campaign);
    });

    it('refuses what a player or the GM may not do', async () => {
      const { campaign, mira, bram, director, first, second } = await rollTable('Refusals');
      await act(director.client, PLAY_SOCKET.callRoll, {
        characterIds: [mira, bram],
        trait: 'agility',
        difficulty: 12,
        hidden: false,
      });
      const calls = await waitForCalls(first.client, 2);
      const miraCall = calls.find((entry) => entry.characterId === mira);
      const bramCall = calls.find((entry) => entry.characterId === bram);

      expect(
        await act(second.client, PLAY_SOCKET.makeRoll, { callId: miraCall?.id, spendHope: false }),
      ).toEqual({ ok: false, message: 'That roll is for another player' });
      expect(
        await act(director.client, PLAY_SOCKET.makeRoll, {
          callId: miraCall?.id,
          spendHope: false,
        }),
      ).toEqual({ ok: false, message: 'Only players can do that' });
      // Bram has no Hope to spend; his call waits.
      expect(
        await act(second.client, PLAY_SOCKET.makeRoll, { callId: bramCall?.id, spendHope: true }),
      ).toEqual({ ok: false, message: 'You have no Hope to spend' });
      expect(playerView(second.client).calls).toHaveLength(2);

      for (const [event, payload] of [
        [
          PLAY_SOCKET.callRoll,
          { characterIds: [mira], trait: 'agility', difficulty: 9, hidden: false },
        ],
        [PLAY_SOCKET.spendFear, { amount: 1 }],
        [PLAY_SOCKET.setFear, { fear: 9 }],
        [PLAY_SOCKET.setHope, { characterId: mira, hope: 6 }],
        [PLAY_SOCKET.cancelRoll, { callId: miraCall?.id }],
      ] as const) {
        expect(await act(first.client, event, payload)).toEqual({
          ok: false,
          message: 'Only the GM can do that',
        });
      }

      expect(
        await act(director.client, PLAY_SOCKET.callRoll, {
          characterIds: [mira],
          trait: 'luck',
          difficulty: 9,
          hidden: false,
        }),
      ).toEqual({ ok: false, message: 'Choose one of the traits' });
      const loner = (
        await call('POST', `/api/campaigns/${campaign.id}/characters`, gm, { name: 'Nobody’s PC' })
      ).json<{ id: string }>().id;
      expect(
        await act(director.client, PLAY_SOCKET.callRoll, {
          characterIds: [loner],
          trait: 'agility',
          difficulty: 9,
          hidden: false,
        }),
      ).toEqual({ ok: false, message: 'Choose PCs that have a player' });
      expect(
        await act(director.client, PLAY_SOCKET.callRoll, {
          characterIds: [mira],
          trait: 'agility',
          difficulty: 100,
          hidden: false,
        }),
      ).toEqual({ ok: false, message: 'Choose PCs, a trait and a difficulty' });
      expect(await act(director.client, PLAY_SOCKET.spendFear, { amount: 4 })).toEqual({
        ok: false,
        message: 'There is only 3 Fear to spend',
      });
      expect(await act(director.client, PLAY_SOCKET.setFear, { fear: 13 })).toEqual({
        ok: false,
        message: 'Fear is from 0 to 12',
      });
      expect(
        await act(director.client, PLAY_SOCKET.setHope, { characterId: mira, hope: 7 }),
      ).toEqual({ ok: false, message: 'Hope is from 0 to 6' });
      expect(await act(director.client, PLAY_SOCKET.revealRoll, { rollId: randomUUID() })).toEqual({
        ok: false,
        message: 'That roll is not in this session',
      });

      expect((await logOf(campaign, players[0] ?? gm)).statusCode).toBe(403);
      await end(campaign);
    });

    it('spends Fear with a reason, and corrects Fear and Hope, all logged', async () => {
      const { campaign, mira, director, first } = await rollTable('Fear and Hope');

      expect(
        await act(director.client, PLAY_SOCKET.spendFear, {
          amount: 2,
          reason: 'The bridge gives way',
        }),
      ).toEqual({ ok: true });
      await vi.waitFor(() => {
        expect(playerView(first.client)).toMatchObject({
          fear: 1,
          lastFearSpend: { amount: 2, reason: 'The bridge gives way' },
        });
      });

      await act(director.client, PLAY_SOCKET.setFear, { fear: 5 });
      await act(director.client, PLAY_SOCKET.setHope, { characterId: mira, hope: 4 });
      await vi.waitFor(() => {
        expect(gmView(director.client).party.find((pc) => pc.characterId === mira)?.hope).toBe(4);
        expect(first.client.sheets).toContain(mira);
        expect(playerView(first.client).fear).toBe(5);
      });
      expect(await hopeOf(campaign, mira)).toBe(4);

      const entries = (await logOf(campaign)).json<{ entries: { text: string }[] }>().entries;
      expect(entries.map((entry) => entry.text).slice(0, 3)).toEqual([
        "Set Mira's Hope from 2 to 4",
        'Set Fear from 1 to 5',
        'Spent 2 Fear (3 → 1): The bridge gives way',
      ]);
      await end(campaign);
    });

    it('tells the table when the GM edits a sheet on the site', async () => {
      const { campaign, mira, director, first } = await rollTable('Site Edit');
      const patched = await call('PATCH', `/api/campaigns/${campaign.id}/characters/${mira}`, gm, {
        hope: 5,
      });
      expect(patched.statusCode).toBe(200);
      await vi.waitFor(() => {
        expect(first.client.sheets).toContain(mira);
        expect(gmView(director.client).party.find((pc) => pc.characterId === mira)?.hope).toBe(5);
      });
      await end(campaign);
    });

    it('drops the calls nobody rolled when the session ends, and starts the next one clean', async () => {
      const { campaign, mira, director, first } = await rollTable('Next Session');
      await act(director.client, PLAY_SOCKET.callRoll, {
        characterIds: [mira],
        trait: 'agility',
        difficulty: 12,
        hidden: false,
      });
      const [called] = await waitForCalls(first.client, 1);
      dice.push(1, 2);
      await act(first.client, PLAY_SOCKET.makeRoll, { callId: called?.id, spendHope: false });
      await act(director.client, PLAY_SOCKET.callRoll, {
        characterIds: [mira],
        trait: 'agility',
        difficulty: 12,
        hidden: false,
      });
      await end(campaign);
      await start(campaign);

      const again = await seated(gm, campaign);
      expect(again.stage).toMatchObject({ fear: 3, calls: [], lastRoll: null });
      expect((await logOf(campaign)).json<{ entries: unknown[] }>().entries).toEqual([]);
      await end(campaign);
    });

    it('keeps another campaign’s calls out of reach', async () => {
      const { campaign, mira, director } = await rollTable('Own Table');
      const other = await table('Other Table', 1);
      const theirs = await pc(other, players[0] ?? gm, 'Stranger');
      await start(other);

      expect(
        await act(director.client, PLAY_SOCKET.callRoll, {
          characterIds: [theirs],
          trait: 'agility',
          difficulty: 9,
          hidden: false,
        }),
      ).toEqual({ ok: false, message: 'Choose PCs that have a player' });
      expect(
        await act(director.client, PLAY_SOCKET.setHope, { characterId: theirs, hope: 1 }),
      ).toEqual({ ok: false, message: 'PC not found' });
      expect(await hopeOf(campaign, mira)).toBe(2);
      await end(other);
      await end(campaign);
    });
  });

  describe('puppet motion (F3.7)', () => {
    /** A PC for `player`, with an image in use so it can be drawn on the stage. */
    async function drawnPc(campaign: Campaign, player: Person, name: string) {
      const made = await call('POST', `/api/campaigns/${campaign.id}/characters`, gm, {
        name,
        assignToUserId: player.id,
      });
      expect(made.statusCode, made.body).toBe(201);
      const { id } = made.json<{ id: string }>();
      const [asset] = await handle.db
        .insert(assets)
        .values({
          campaignId: campaign.id,
          characterId: id,
          createdBy: gm.id,
          kind: 'character',
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
        .update(characters)
        .set({ visualAssetId: asset?.id ?? null })
        .where(eq(characters.id, id));
      return id;
    }

    const pause = () => new Promise((resolve) => setTimeout(resolve, EMOTE_GAP_MS));

    /**
     * A running session with Mira's puppet (player 1) and Bram's (player 2) raised, Old Marta
     * raised, a well in sight and a trapdoor hidden; all three people seated.
     */
    async function motionTable(name: string) {
      const campaign = await table(name, 2);
      const mira = await drawnPc(campaign, players[0] ?? gm, 'Mira');
      const bram = await drawnPc(campaign, players[1] ?? gm, 'Bram');
      const market = await marketScene(campaign);
      await start(campaign);
      const director = await seated(gm, campaign);
      const first = await seated(players[0] ?? gm, campaign);
      const second = await seated(players[1] ?? gm, campaign);
      expect(await act(director.client, PLAY_SOCKET.loadScene, { sceneId: market.id })).toEqual({
        ok: true,
      });
      const ids = { mira: randomUUID(), bram: randomUUID() };
      for (const [objectId, characterId] of [
        [ids.mira, mira],
        [ids.bram, bram],
      ] as const) {
        expect(
          await act(director.client, PLAY_SOCKET.addObject, { id: objectId, characterId }),
        ).toEqual({ ok: true });
        expect(await act(director.client, PLAY_SOCKET.raisePuppet, { id: objectId })).toEqual({
          ok: true,
        });
      }
      const [well, trapdoor, marta] = market.objects;
      expect(await act(director.client, PLAY_SOCKET.raisePuppet, { id: marta?.id })).toEqual({
        ok: true,
      });
      await vi.waitFor(() => {
        expect((last(first.client.stages) as PlayerStage | undefined)?.objects).toHaveLength(4);
      });
      return {
        campaign,
        mira,
        bram,
        director,
        first,
        second,
        objects: {
          ...ids,
          well: well?.id ?? '',
          trapdoor: trapdoor?.id ?? '',
          marta: marta?.id ?? '',
        },
      };
    }

    it('tells players whose puppet each PC is, and nothing for anything else', async () => {
      const { campaign, mira, bram, first, objects } = await motionTable('Whose Puppet');

      const stage = last(first.client.stages) as PlayerStage;
      const whose = Object.fromEntries(stage.objects.map((o) => [o.id, o.characterId]));
      expect(whose).toEqual({
        [objects.well]: null,
        [objects.marta]: null,
        [objects.mira]: mira,
        [objects.bram]: bram,
      });
      await end(campaign);
    });

    it('plays a player’s emote on their own puppet for everyone, once', async () => {
      const { campaign, director, first, second, objects } = await motionTable('Own Emote');
      const stagesBefore = director.client.stages.length;

      expect(
        await act(first.client, PLAY_SOCKET.emote, { id: objects.mira, emote: 'wave' }),
      ).toEqual({ ok: true });

      for (const client of [director.client, first.client, second.client]) {
        await vi.waitFor(() => {
          expect(client.emotes).toHaveLength(1);
        });
        expect(client.emotes[0]).toMatchObject({ objectId: objects.mira, emote: 'wave' });
      }
      // The same play everywhere; nothing on the stage changed, so it isn't sent again.
      expect(new Set([director, first, second].map((s) => s.client.emotes[0]?.id)).size).toBe(1);
      expect(director.client.stages).toHaveLength(stagesBefore);
      await end(campaign);
    });

    it('lets the GM emote any raised puppet, and nothing else', async () => {
      const { campaign, director, first, objects } = await motionTable('GM Emotes');

      for (const id of [objects.marta, objects.bram]) {
        expect(await act(director.client, PLAY_SOCKET.emote, { id, emote: 'bow' })).toEqual({
          ok: true,
        });
        await pause();
      }
      await vi.waitFor(() => {
        expect(first.client.emotes.map((played) => played.objectId)).toEqual([
          objects.marta,
          objects.bram,
        ]);
      });

      expect(
        await act(director.client, PLAY_SOCKET.emote, { id: objects.well, emote: 'bow' }),
      ).toEqual({ ok: false, message: 'Choose a puppet on the stage' });
      await pause();
      await act(director.client, PLAY_SOCKET.lowerPuppet, { id: objects.marta });
      expect(
        await act(director.client, PLAY_SOCKET.emote, { id: objects.marta, emote: 'bow' }),
      ).toEqual({ ok: false, message: 'Raise that puppet first' });
      await end(campaign);
    });

    it('refuses a player anyone else’s puppet, props, nonsense and emotes too quick', async () => {
      const { campaign, director, first, objects } = await motionTable('Emote Refusals');

      for (const id of [objects.bram, objects.marta]) {
        expect(await act(first.client, PLAY_SOCKET.emote, { id, emote: 'hop' })).toEqual({
          ok: false,
          message: 'That puppet isn’t yours',
        });
        await pause();
      }
      for (const id of [objects.well, objects.trapdoor, randomUUID()]) {
        expect(await act(first.client, PLAY_SOCKET.emote, { id, emote: 'hop' })).toEqual({
          ok: false,
          message: 'Choose a puppet on the stage',
        });
        await pause();
      }
      expect(
        await act(first.client, PLAY_SOCKET.emote, { id: objects.mira, emote: 'moonwalk' }),
      ).toEqual({ ok: false, message: 'Choose a puppet and an emote' });

      // Lowered, a player's own puppet is out of reach like anything else out of sight.
      await act(director.client, PLAY_SOCKET.lowerPuppet, { id: objects.mira });
      expect(
        await act(first.client, PLAY_SOCKET.emote, { id: objects.mira, emote: 'hop' }),
      ).toEqual({ ok: false, message: 'Choose a puppet on the stage' });
      await act(director.client, PLAY_SOCKET.raisePuppet, { id: objects.mira });

      await pause();
      expect(
        await act(first.client, PLAY_SOCKET.emote, { id: objects.mira, emote: 'hop' }),
      ).toEqual({ ok: true });
      expect(
        await act(first.client, PLAY_SOCKET.emote, { id: objects.mira, emote: 'nod' }),
      ).toEqual({ ok: false, message: 'Too quick: wait a moment' });
      await vi.waitFor(() => {
        expect(director.client.emotes).toHaveLength(1);
      });
      expect(director.client.emotes[0]?.emote).toBe('hop');
      expect(director.client.emotes[0]?.objectId).toBe(objects.mira);

      await end(campaign);
      await pause();
      expect(
        await act(director.client, PLAY_SOCKET.emote, { id: objects.mira, emote: 'hop' }),
      ).toEqual({ ok: false, message: 'Join the session first' });
    });

    it('passes on who is talking with presence, only when it changes', async () => {
      const { campaign, mira, director, first, second } = await motionTable('Talking');
      const talking = (client: Client) =>
        last(client.presences)
          ?.filter((person) => person.speaking)
          .map((person) => person.displayName);
      const before = director.client.presences.length;

      first.client.socket.emit(PLAY_SOCKET.speaking, { speaking: true });
      await vi.waitFor(() => {
        expect(talking(second.client)).toEqual(['Live Player 1']);
      });
      expect(last(director.client.presences)?.find((p) => p.speaking)?.characterId).toBe(mira);
      // Saying it again changes nothing, and nonsense is ignored.
      first.client.socket.emit(PLAY_SOCKET.speaking, { speaking: true });
      first.client.socket.emit(PLAY_SOCKET.speaking, { speaking: 'loud' });
      first.client.socket.emit(PLAY_SOCKET.speaking, { speaking: false });
      await vi.waitFor(() => {
        expect(talking(director.client)).toEqual([]);
      });
      expect(director.client.presences.length - before).toBe(2);

      // Leaving while talking stops it for everyone else.
      second.client.socket.emit(PLAY_SOCKET.speaking, { speaking: true });
      await vi.waitFor(() => {
        expect(talking(director.client)).toEqual(['Live Player 2']);
      });
      second.client.socket.disconnect();
      await vi.waitFor(() => {
        expect(names(last(director.client.presences))).toEqual(['Live GM', 'Live Player 1']);
      });
      expect(talking(director.client)).toEqual([]);
      await end(campaign);
    });

    /** Who the GM voices in `client`'s last presence (F3.8). */
    const voicing = (client: Client) =>
      last(client.presences)?.find((person) => person.role === 'gm')?.voicing;

    it('lets the GM take over a raised NPC, switch, and give the voice back (F3.8)', async () => {
      const { campaign, director, first, objects } = await motionTable('Takeover');
      const stagesBefore = director.client.stages.length;

      expect(await act(director.client, PLAY_SOCKET.takeOverNpc, { id: objects.marta })).toEqual({
        ok: true,
      });
      for (const client of [director.client, first.client]) {
        await vi.waitFor(() => {
          expect(voicing(client)).toBe(objects.marta);
        });
      }
      // Only the GM carries it, and nothing on the stage changed.
      expect(last(first.client.presences)?.filter((p) => p.voicing !== null)).toHaveLength(1);
      expect(director.client.stages).toHaveLength(stagesBefore);

      // The GM's talking goes out as before; the browsers put it on the NPC.
      director.client.socket.emit(PLAY_SOCKET.speaking, { speaking: true });
      await vi.waitFor(() => {
        expect(last(first.client.presences)?.find((p) => p.role === 'gm')).toMatchObject({
          speaking: true,
          voicing: objects.marta,
        });
      });

      expect(await act(director.client, PLAY_SOCKET.releaseNpc, {})).toEqual({ ok: true });
      await vi.waitFor(() => {
        expect(voicing(first.client)).toBeNull();
      });
      // Releasing again is harmless.
      expect(await act(director.client, PLAY_SOCKET.releaseNpc, {})).toEqual({ ok: true });
      await end(campaign);
    });

    it('refuses a takeover of a PC, a prop, a lowered NPC, or by a player (F3.8)', async () => {
      const { campaign, director, first, objects } = await motionTable('Takeover Refusals');

      for (const id of [objects.mira, objects.well, objects.trapdoor, randomUUID()]) {
        expect(await act(director.client, PLAY_SOCKET.takeOverNpc, { id })).toEqual({
          ok: false,
          message: 'Choose an NPC puppet on the stage',
        });
      }
      expect(await act(director.client, PLAY_SOCKET.takeOverNpc, { id: 'marta' })).toEqual({
        ok: false,
        message: 'Choose an NPC puppet on the stage',
      });
      expect(await act(first.client, PLAY_SOCKET.takeOverNpc, { id: objects.marta })).toEqual({
        ok: false,
        message: 'Only the GM can do that',
      });
      expect(await act(first.client, PLAY_SOCKET.releaseNpc, {})).toEqual({
        ok: false,
        message: 'Only the GM can do that',
      });

      await act(director.client, PLAY_SOCKET.lowerPuppet, { id: objects.marta });
      expect(await act(director.client, PLAY_SOCKET.takeOverNpc, { id: objects.marta })).toEqual({
        ok: false,
        message: 'Raise that puppet first',
      });
      expect(voicing(director.client)).toBeNull();
      await end(campaign);
    });

    it('gives the voice back when the NPC is lowered, removed or its scene loads again', async () => {
      const { campaign, director, first, objects } = await motionTable('Takeover Release');
      const market = (last(director.client.stages) as GmStage).scene?.id;
      const voiced = async () => {
        expect(await act(director.client, PLAY_SOCKET.raisePuppet, { id: objects.marta })).toEqual({
          ok: true,
        });
        expect(await act(director.client, PLAY_SOCKET.takeOverNpc, { id: objects.marta })).toEqual({
          ok: true,
        });
        await vi.waitFor(() => {
          expect(voicing(first.client)).toBe(objects.marta);
        });
      };

      for (const [event, payload] of [
        [PLAY_SOCKET.lowerPuppet, { id: objects.marta }],
        [PLAY_SOCKET.loadScene, { sceneId: market }],
        [PLAY_SOCKET.removeObject, { id: objects.marta }],
      ] as const) {
        await voiced();
        expect(await act(director.client, event, payload)).toEqual({ ok: true });
        await vi.waitFor(() => {
          expect(voicing(first.client)).toBeNull();
        });
        expect(voicing(director.client)).toBeNull();
      }
      await end(campaign);
    });
  });
});
