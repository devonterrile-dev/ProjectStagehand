/**
 * Live sessions (F3.3a, governance §13, D-50), against a real Postgres: starting and ending a
 * session, the live stage as a copy of a loaded scene, the GM's view and the players' view of
 * it, and which images a player may load. Route-level isolation with random ids (outsiders 404,
 * players 403) is in the table in `campaigns.int.test.ts`. The live room itself is tested in
 * `play/socket.int.test.ts`.
 */
import { randomUUID } from 'node:crypto';

import type {
  Campaign,
  CampaignRecord,
  PlaySessionResponse,
  Scene,
  SceneObjectInput,
} from '@stagehand/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import {
  addLiveObject,
  loadSceneLive,
  moveLiveObject,
  NO_SESSION,
  removeLiveObject,
  setCurtain,
  setLiveObjectShown,
  setRecordRevealed,
  setTravelPlaying,
  settlePasses,
  stagesOf,
} from '../campaigns/play-sessions';
import { loadCampaignScope, type CampaignScope } from '../campaigns/scope';
import type { DbHandle } from '../db/client';
import {
  assets,
  campaignMembers,
  characters,
  playSessionObjects,
  playSessions,
  records,
  sessionEvents,
  users,
} from '../db/schema';
import { originalKey, processedKey, type AssetStorage } from '../visuals/storage';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Postgres error code from a failed query (Drizzle wraps the driver error in `cause`). */
function pgCode(error: unknown): unknown {
  const withCause = error as { code?: unknown; cause?: { code?: unknown } };
  return withCause.cause?.code ?? withCause.code;
}

interface Person {
  cookie: string;
  id: string;
}

describe('Live sessions API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let storage: AssetStorage;
  let gm: Person;
  let player: Person;
  let campaign: Campaign;
  let other: Campaign;
  let area: CampaignRecord;

  beforeAll(async () => {
    ({ app, handle, storage } = await buildTestApp());
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('16301', 'Sessions GM');
    player = await person('16302', 'Sessions Player');
    campaign = await newCampaign('Sessions Campaign');
    other = await newCampaign('Other Sessions Campaign');
    await handle.db
      .insert(campaignMembers)
      .values({ campaignId: campaign.id, userId: player.id, role: 'player' });
    area = await record({ type: 'area', name: 'Saltmarsh' });
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

  async function newCampaign(name: string): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', gm, { name });
    expect(response.statusCode).toBe(201);
    return response.json<Campaign>();
  }

  async function record(body: Record<string, unknown>, c = campaign): Promise<CampaignRecord> {
    const response = await call('POST', `/api/campaigns/${c.id}/records`, gm, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<CampaignRecord>();
  }

  /**
   * Gives a record an image in use, as "Use this" leaves it, with real files behind it so the
   * image route has something to serve.
   */
  async function giveImage(
    target: { id: string },
    kind: 'character' | 'prop' | 'backdrop',
    c = campaign,
  ): Promise<string> {
    const assetId = randomUUID();
    const originalPath = originalKey(c.id, assetId, 'png');
    const processedPath = processedKey(c.id, assetId);
    await storage.put(originalPath, Buffer.from('the original'));
    await storage.put(processedPath, Buffer.from('the stage version'));
    await handle.db.insert(assets).values({
      id: assetId,
      campaignId: c.id,
      recordId: target.id,
      createdBy: gm.id,
      kind,
      status: 'approved',
      prompt: 'a test image',
      model: 'test/model',
      styleBibleVersion: 1,
      quality: 'medium',
      aspectRatio: kind === 'backdrop' ? '16:9' : '2:3',
      originalPath,
      mediaType: 'image/png',
      processedPath,
      processedWidth: kind === 'backdrop' ? 1536 : 640,
      processedHeight: kind === 'backdrop' ? 864 : 1024,
      processingVersion: 3,
    });
    await handle.db
      .update(records)
      .set({ visualAssetId: assetId })
      .where(eq(records.id, target.id));
    return assetId;
  }

  /** A record of a placeable type with its image; answers the record and the image's asset. */
  async function drawn(type: 'prop' | 'item' | 'npc', name: string, c = campaign) {
    const made = await record({ type, name }, c);
    const assetId = await giveImage(made, type === 'npc' ? 'character' : 'prop', c);
    return { record: made, assetId };
  }

  /** An object as the builder sends it. */
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
    name: string,
    spotId: string | null,
    objects: SceneObjectInput[],
    c = campaign,
  ): Promise<Scene> {
    const made = await call('POST', `/api/campaigns/${c.id}/scenes`, gm, { name, spotId });
    expect(made.statusCode, made.body).toBe(201);
    const { id } = made.json<Scene>();
    const placed = await call('PUT', `/api/campaigns/${c.id}/scenes/${id}/objects`, gm, {
      objects,
    });
    expect(placed.statusCode, placed.body).toBe(200);
    return placed.json<Scene>();
  }

  const sessionUrl = (c: Campaign) => `/api/campaigns/${c.id}/play-session`;
  const imageUrl = (assetId: string, c = campaign) =>
    `/api/campaigns/${c.id}/assets/${assetId}/image`;

  async function running(who: Person, c = campaign) {
    const response = await call('GET', sessionUrl(c), who);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PlaySessionResponse>().session;
  }

  async function start(c = campaign) {
    const response = await call('POST', sessionUrl(c), gm);
    expect(response.statusCode, response.body).toBe(201);
    const { session } = response.json<PlaySessionResponse>();
    if (session === null) throw new Error('no session was started');
    return session;
  }

  async function end(c = campaign) {
    const response = await call('POST', `${sessionUrl(c)}/end`, gm);
    expect(response.statusCode, response.body).toBe(204);
  }

  async function scopeOf(who: Person, c = campaign): Promise<CampaignScope> {
    const scope = await loadCampaignScope(handle.db, who.id, c.id);
    if (scope === null) throw new Error('not a member');
    return scope;
  }

  async function stages(c = campaign) {
    const both = await stagesOf(handle.db, await scopeOf(gm, c));
    if (both === null) throw new Error('no session is running');
    return both;
  }

  describe('starting and ending', () => {
    it('has no session until the GM starts one', async () => {
      expect(await running(gm)).toBeNull();
      expect(await running(player)).toBeNull();
    });

    it('starts session 1 with an empty theater, a closed curtain and 3 Fear', async () => {
      const session = await start();

      expect(session.number).toBe(1);
      expect(Date.parse(session.startedAt)).toBeGreaterThan(Date.now() - 60_000);
      expect(await running(gm)).toEqual(session);
      expect(await running(player)).toEqual(session);

      const [row] = await handle.db
        .select()
        .from(playSessions)
        .where(eq(playSessions.id, session.id));
      expect(row).toMatchObject({
        campaignId: campaign.id,
        endedAt: null,
        sceneId: null,
        spotId: null,
        sceneLoads: 0,
        curtainOpen: false,
        fear: 3,
      });
    });

    it('answers the running session when the GM starts again', async () => {
      const session = await running(gm);

      const again = await call('POST', sessionUrl(campaign), gm);

      expect(again.statusCode).toBe(200);
      expect(again.json<PlaySessionResponse>().session).toEqual(session);
    });

    it('keeps a second running session out of the database', async () => {
      const second = handle.db
        .insert(playSessions)
        .values({ campaignId: campaign.id, number: 99, fear: 3 });

      const error = await second.then(
        () => null,
        (e: unknown) => e,
      );

      expect(pgCode(error)).toBe('23505'); // unique_violation
    });

    it('ends the session, and numbers the next one 2', async () => {
      await end();
      expect(await running(gm)).toBeNull();
      expect(await running(player)).toBeNull();

      expect((await start()).number).toBe(2);
      await end();
    });

    it('answers 404 when there is no session to end', async () => {
      const response = await call('POST', `${sessionUrl(campaign)}/end`, gm);

      expect(response.statusCode).toBe(404);
      expect(response.json<{ message: string }>().message).toBe(NO_SESSION);
    });

    it('keeps each campaign’s sessions to itself', async () => {
      const here = await start();

      expect(await running(gm, other)).toBeNull();
      expect((await start(other)).number).toBe(1);
      expect((await running(gm))?.id).toBe(here.id);

      await end(other);
      await end();
    });

    it('lets players neither start nor end one', async () => {
      expect((await call('POST', sessionUrl(campaign), player)).statusCode).toBe(403);
      await start();
      expect((await call('POST', `${sessionUrl(campaign)}/end`, player)).statusCode).toBe(403);
      expect(await running(gm)).not.toBeNull();
      await end();
    });

    it('refuses to start in an archived campaign, but lets a running session be ended', async () => {
      const shelf = await newCampaign('Shelved Sessions');
      await start(shelf);
      expect((await call('POST', `/api/campaigns/${shelf.id}/archive`, gm)).statusCode).toBe(200);

      await end(shelf);

      const refused = await call('POST', sessionUrl(shelf), gm);
      expect(refused.statusCode).toBe(409);
      expect(refused.json<{ message: string }>().message).toBe('Campaign is archived');
    });
  });

  describe('the live stage', () => {
    let market: CampaignRecord;
    let backdropAsset: string;
    let well: Awaited<ReturnType<typeof drawn>>;
    let trapdoor: Awaited<ReturnType<typeof drawn>>;
    let fishmonger: Awaited<ReturnType<typeof drawn>>;
    let marketScene: Scene;
    let gmScope: CampaignScope;

    beforeAll(async () => {
      market = await record({ type: 'spot', name: 'Fish Market', parentId: area.id });
      backdropAsset = await giveImage(market, 'backdrop');
      well = await drawn('prop', 'The cursed well');
      trapdoor = await drawn('prop', 'Secret trapdoor');
      fishmonger = await drawn('npc', 'Old Marta the fishmonger');
      marketScene = await scene('Ambush at the market', market.id, [
        at(well.record.id, { across: 0.3, depthTick: 6, mount: 'stand' }),
        at(trapdoor.record.id, { across: 0.7, shown: false }),
        at(fishmonger.record.id, { across: 0.5, up: 0.2, depthTick: 2, flipped: true }),
      ]);
      gmScope = await scopeOf(gm);
      await start();
    });

    afterAll(async () => {
      if ((await running(gm)) !== null) await end();
    });

    it('is nothing at all while no session is running', async () => {
      expect(await stagesOf(handle.db, await scopeOf(gm, other))).toBeNull();
    });

    it('starts as an empty theater behind a closed curtain', async () => {
      const { gm: forGm, player: forPlayers } = await stages();

      expect(forGm).toMatchObject({
        role: 'gm',
        sceneLoad: 0,
        curtainOpen: false,
        backdrop: null,
        scene: null,
        objects: [],
      });
      expect(forPlayers).toEqual({
        role: 'player',
        session: forGm.session,
        sceneLoad: 0,
        curtainOpen: false,
        backdrop: null,
        // No transition scene loaded (F5.4).
        travel: null,
        objects: [],
        // Fear where it starts, Rest off (F4.7), and no rolls yet (F3.6).
        rest: false,
        fear: 3,
        fearCap: 12,
        lastFearSpend: null,
        calls: [],
        lastRoll: null,
      });
    });

    it('loads a scene as saved, behind the curtain while it is closed', async () => {
      await loadSceneLive(handle.db, gmScope, marketScene.id);

      const { gm: forGm } = await stages();
      expect(forGm).toMatchObject({
        sceneLoad: 1,
        curtainOpen: false,
        scene: { id: marketScene.id, name: 'Ambush at the market' },
        backdrop: { assetId: backdropAsset, width: 1536, height: 864, version: 3 },
      });
      expect(forGm.objects).toEqual(
        marketScene.objects.map((object) => ({
          id: object.id,
          kind: object.kind,
          across: object.across,
          up: object.up,
          depthTick: object.depthTick,
          scale: object.scale,
          flipped: object.flipped,
          mount: object.mount,
          passFrom: null,
          subject: { kind: 'record', ...object.record, revealed: false },
          image: object.image,
          shown: object.shown,
          travelMode: object.travelMode,
        })),
      );
      expect(forGm.objects.map((object) => object.shown)).toEqual([true, false, false]);

      await setCurtain(handle.db, gmScope, true);
      expect((await stages()).gm.curtainOpen).toBe(true);
    });

    it('sends players only what is in sight, as an image and a place', async () => {
      const { player: forPlayers } = await stages();
      const [shownWell] = marketScene.objects;

      expect(forPlayers.backdrop?.assetId).toBe(backdropAsset);
      expect(forPlayers.objects).toEqual([
        {
          id: shownWell?.id,
          kind: 'prop',
          across: 0.3,
          up: 0,
          depthTick: 6,
          scale: 1,
          flipped: false,
          mount: 'stand',
          passFrom: null,
          image: { assetId: well.assetId, width: 640, height: 1024, version: 3 },
          // Opening the curtain on it revealed it, so players may inspect it (F3.5).
          recordId: well.record.id,
          // Not a PC's puppet (F3.7).
          characterId: null,
        },
      ]);

      // Nothing of the hidden prop or the puppet waiting below, and no names; the only record
      // id is the revealed well's.
      const sent = JSON.stringify(forPlayers);
      for (const secret of [
        trapdoor.assetId,
        trapdoor.record.id,
        fishmonger.assetId,
        fishmonger.record.id,
        market.id,
        marketScene.id,
        'cursed',
        'trapdoor',
        'Marta',
        'Ambush',
        'Fish Market',
      ]) {
        expect(sent, secret).not.toContain(secret);
      }
    });

    it('closes and opens the curtain for both views', async () => {
      await setCurtain(handle.db, gmScope, false);
      let both = await stages();
      expect([both.gm.curtainOpen, both.player.curtainOpen]).toEqual([false, false]);
      expect(both.gm.sceneLoad).toBe(1);

      await setCurtain(handle.db, gmScope, true);
      both = await stages();
      expect([both.gm.curtainOpen, both.player.curtainOpen]).toEqual([true, true]);
    });

    it('is a copy: changing the saved scene changes nothing on stage', async () => {
      const before = await stages();

      const emptied = await call(
        'PUT',
        `/api/campaigns/${campaign.id}/scenes/${marketScene.id}/objects`,
        gm,
        { objects: [] },
      );
      expect(emptied.statusCode).toBe(200);
      const bare = await call(
        'PATCH',
        `/api/campaigns/${campaign.id}/scenes/${marketScene.id}`,
        gm,
        { spotId: null, name: 'Quiet market' },
      );
      expect(bare.statusCode).toBe(200);

      const after = await stages();
      expect(after.player).toEqual(before.player);
      expect(after.gm.objects).toEqual(before.gm.objects);
      expect(after.gm.backdrop).toEqual(before.gm.backdrop);
      // Only the scene's label follows its current name.
      expect(after.gm.scene).toEqual({ id: marketScene.id, name: 'Quiet market' });
    });

    it('follows each record’s image in use', async () => {
      const redrawn = await giveImage(well.record, 'prop');

      const { player: forPlayers } = await stages();

      expect(forPlayers.objects[0]?.image.assetId).toBe(redrawn);
      well = { ...well, assetId: redrawn };
    });

    it('loads another scene in its place, counting the load, and keeps a closed curtain closed', async () => {
      const lantern = await drawn('item', 'Storm lantern');
      const cellar = await scene('The cellar', null, [
        at(lantern.record.id, { mount: 'hang', up: 0.6 }),
      ]);
      await setCurtain(handle.db, gmScope, false);

      await loadSceneLive(handle.db, gmScope, cellar.id);

      const { gm: forGm, player: forPlayers } = await stages();
      expect(forGm).toMatchObject({
        sceneLoad: 2,
        curtainOpen: false,
        backdrop: null,
        scene: { id: cellar.id, name: 'The cellar' },
      });
      expect(forGm.objects.map((object) => object.subject.name)).toEqual(['Storm lantern']);
      expect(forPlayers.objects).toEqual([
        expect.objectContaining({ mount: 'hang', up: 0.6, image: { ...lanternImage(lantern) } }),
      ]);
    });

    function lanternImage(lantern: { assetId: string }) {
      return { assetId: lantern.assetId, width: 640, height: 1024, version: 3 };
    }

    it('leaves an object whose record lost its image out of the players’ view', async () => {
      const crate = await drawn('prop', 'Fish crate');
      const dock = await scene('The dock', market.id, [at(crate.record.id)]);
      await loadSceneLive(handle.db, gmScope, dock.id);
      expect((await stages()).player.objects).toHaveLength(1);

      await handle.db
        .update(records)
        .set({ visualAssetId: null })
        .where(eq(records.id, crate.record.id));

      const { gm: forGm, player: forPlayers } = await stages();
      expect(forGm.objects).toEqual([expect.objectContaining({ image: null, shown: true })]);
      expect(forPlayers.objects).toEqual([]);
    });

    it('drops an object when its record is deleted, and the backdrop with its Spot', async () => {
      const barrel = await drawn('prop', 'Barrel');
      const quay = await record({ type: 'spot', name: 'The quay', parentId: area.id });
      await giveImage(quay, 'backdrop');
      const quayScene = await scene('On the quay', quay.id, [
        at(barrel.record.id),
        at(well.record.id),
      ]);
      await loadSceneLive(handle.db, gmScope, quayScene.id);
      expect((await stages()).player.objects).toHaveLength(2);
      expect((await stages()).player.backdrop).not.toBeNull();

      for (const gone of [barrel.record.id, quay.id]) {
        const deleted = await call('DELETE', `/api/campaigns/${campaign.id}/records/${gone}`, gm);
        expect(deleted.statusCode, deleted.body).toBe(204);
      }

      const { gm: forGm, player: forPlayers } = await stages();
      expect(forGm.objects.map((object) => object.subject.name)).toEqual(['The cursed well']);
      expect(forPlayers.objects).toHaveLength(1);
      expect(forPlayers.backdrop).toBeNull();
    });

    it('keeps the stage when the loaded scene is deleted, without its name', async () => {
      const [row] = await handle.db
        .select({ sceneId: playSessions.sceneId })
        .from(playSessions)
        .where(and(eq(playSessions.campaignId, campaign.id), isNull(playSessions.endedAt)));
      const deleted = await call(
        'DELETE',
        `/api/campaigns/${campaign.id}/scenes/${row?.sceneId ?? ''}`,
        gm,
      );
      expect(deleted.statusCode).toBe(204);

      const { gm: forGm } = await stages();
      expect(forGm.scene).toBeNull();
      expect(forGm.objects).toHaveLength(1);
    });

    it('refuses a scene of another campaign, and one that does not exist', async () => {
      const elsewhere = await scene('Elsewhere', null, [], other);
      const before = await stages();

      await expect(loadSceneLive(handle.db, gmScope, elsewhere.id)).rejects.toMatchObject({
        statusCode: 404,
        message: 'Scene not found',
      });
      await expect(loadSceneLive(handle.db, gmScope, randomUUID())).rejects.toMatchObject({
        statusCode: 404,
      });

      expect(await stages()).toEqual(before);
    });

    it('refuses to load a scene or move the curtain with no session running', async () => {
      const otherScope = await scopeOf(gm, other);
      const elsewhere = await scene('Nobody is here', null, [], other);

      await expect(loadSceneLive(handle.db, otherScope, elsewhere.id)).rejects.toMatchObject({
        statusCode: 409,
        message: NO_SESSION,
      });
      await expect(setCurtain(handle.db, otherScope, true)).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('clears the stage when the session ends', async () => {
      const session = await running(gm);
      await end();

      const left = await handle.db
        .select({ id: playSessionObjects.id })
        .from(playSessionObjects)
        .where(eq(playSessionObjects.playSessionId, session?.id ?? ''));
      expect(left).toEqual([]);
      expect(await stagesOf(handle.db, gmScope)).toBeNull();
    });
  });

  describe('the control desk', () => {
    let desk: Campaign;
    let deskScope: CampaignScope;
    let lantern: Awaited<ReturnType<typeof drawn>>;
    let crate: Awaited<ReturnType<typeof drawn>>;
    let marta: Awaited<ReturnType<typeof drawn>>;
    let mira: { id: string; assetId: string };
    let faceless: { id: string };
    let deskScene: Scene;
    let sessionId: string;

    /** A PC, with an image in use when `withImage`. */
    async function pc(name: string, withImage: boolean, c: Campaign) {
      const response = await call('POST', `/api/campaigns/${c.id}/characters`, gm, { name });
      expect(response.statusCode, response.body).toBe(201);
      const { id } = response.json<{ id: string }>();
      if (!withImage) return { id, assetId: '' };
      const assetId = randomUUID();
      await handle.db.insert(assets).values({
        id: assetId,
        campaignId: c.id,
        characterId: id,
        createdBy: gm.id,
        kind: 'character',
        status: 'approved',
        prompt: 'a test image',
        model: 'test/model',
        styleBibleVersion: 1,
        quality: 'medium',
        aspectRatio: '2:3',
        originalPath: originalKey(c.id, assetId, 'png'),
        mediaType: 'image/png',
        processedPath: processedKey(c.id, assetId),
        processedWidth: 640,
        processedHeight: 1024,
        processingVersion: 3,
      });
      await handle.db
        .update(characters)
        .set({ visualAssetId: assetId })
        .where(eq(characters.id, id));
      return { id, assetId };
    }

    async function revealedAt(recordId: string) {
      const [row] = await handle.db
        .select({ revealedAt: records.revealedAt })
        .from(records)
        .where(eq(records.id, recordId));
      return row?.revealedAt ?? null;
    }

    async function events() {
      const rows = await handle.db
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.playSessionId, sessionId))
        .orderBy(sessionEvents.at);
      return rows.map((row) => ({
        kind: row.kind,
        actorUserId: row.actorUserId,
        recordId: row.recordId,
      }));
    }

    const objectOf = async (id: string) =>
      (await stages(desk)).gm.objects.find((object) => object.id === id);

    beforeAll(async () => {
      desk = await newCampaign('Desk Campaign');
      deskScope = await scopeOf(gm, desk);
      lantern = await drawn('prop', 'Storm lantern', desk);
      crate = await drawn('prop', 'Fish crate', desk);
      marta = await drawn('npc', 'Old Marta', desk);
      mira = await pc('Mira', true, desk);
      faceless = await pc('Faceless', false, desk);
      deskScene = await scene(
        'The quay',
        null,
        [at(lantern.record.id), at(crate.record.id, { shown: false }), at(marta.record.id)],
        desk,
      );
      sessionId = (await start(desk)).id;
    });

    afterAll(async () => {
      if ((await running(gm, desk)) !== null) await end(desk);
    });

    it('lists the PCs that have an image for the stage', async () => {
      const response = await call('GET', `/api/campaigns/${desk.id}/stage-records`, gm);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<{ characters: unknown[] }>().characters).toEqual([
        {
          id: mira.id,
          name: 'Mira',
          image: { assetId: mira.assetId, width: 640, height: 1024, version: 3 },
        },
      ]);
    });

    it('loads behind the closed curtain, reveals nothing, and logs the load', async () => {
      await loadSceneLive(handle.db, deskScope, deskScene.id);

      expect((await stages(desk)).gm.curtainOpen).toBe(false);
      expect(await revealedAt(lantern.record.id)).toBeNull();
      expect(await events()).toEqual([{ kind: 'scene_load', actorUserId: gm.id, recordId: null }]);
    });

    it('reveals what is in sight when the curtain opens, and only that', async () => {
      await setCurtain(handle.db, deskScope, true);

      expect(await revealedAt(lantern.record.id)).not.toBeNull();
      expect(await revealedAt(crate.record.id)).toBeNull();
      expect(await revealedAt(marta.record.id)).toBeNull();
      expect((await events()).slice(1)).toEqual([
        { kind: 'reveal', actorUserId: null, recordId: lantern.record.id },
      ]);
      const [first] = (await stages(desk)).gm.objects;
      expect(first?.subject).toEqual({
        kind: 'record',
        id: lantern.record.id,
        type: 'prop',
        name: 'Storm lantern',
        revealed: true,
      });

      // Opening an open curtain again changes nothing.
      await setCurtain(handle.db, deskScope, true);
      expect(await events()).toHaveLength(2);
    });

    it('reveals a prop shown and a puppet raised while the curtain is open', async () => {
      const [, hidden, waiting] = deskScene.objects;
      await setLiveObjectShown(handle.db, deskScope, hidden?.id ?? '', 'prop', true);
      await setLiveObjectShown(handle.db, deskScope, waiting?.id ?? '', 'puppet', true);

      expect(await revealedAt(crate.record.id)).not.toBeNull();
      expect(await revealedAt(marta.record.id)).not.toBeNull();
      const { player: forPlayers } = await stages(desk);
      expect(forPlayers.objects.map((object) => object.id)).toEqual(
        deskScene.objects.map((object) => object.id),
      );
      expect(JSON.stringify(forPlayers)).not.toContain('Marta');
    });

    it('refuses a prop raised as a puppet, a puppet shown as a prop, and what is not there', async () => {
      const [prop, , puppet] = deskScene.objects;
      await expect(
        setLiveObjectShown(handle.db, deskScope, prop?.id ?? '', 'puppet', true),
      ).rejects.toMatchObject({ statusCode: 400, message: 'That is not a puppet' });
      await expect(
        setLiveObjectShown(handle.db, deskScope, puppet?.id ?? '', 'prop', false),
      ).rejects.toMatchObject({ statusCode: 400, message: 'That is not a prop' });
      await expect(
        setLiveObjectShown(handle.db, deskScope, randomUUID(), 'prop', true),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('keeps an un-reveal while the record stays in sight, until it comes into sight again', async () => {
      const [, hidden] = deskScene.objects;
      await setRecordRevealed(handle.db, deskScope, crate.record.id, false);
      expect(await revealedAt(crate.record.id)).toBeNull();
      // Still in sight, but no longer something players may inspect (F3.5).
      const inSight = (await stages(desk)).player.objects.find(
        (object) => object.id === hidden?.id,
      );
      expect(inSight).toMatchObject({ recordId: null });
      expect(await events()).toContainEqual({
        kind: 'unreveal',
        actorUserId: gm.id,
        recordId: crate.record.id,
      });

      await moveLiveObject(handle.db, deskScope, { id: hidden?.id ?? '', across: 0.9 });
      await setCurtain(handle.db, deskScope, false);
      expect(await revealedAt(crate.record.id)).toBeNull();

      await setCurtain(handle.db, deskScope, true);
      expect(await revealedAt(crate.record.id)).not.toBeNull();
    });

    it('adds a prop hidden, and an NPC and a PC waiting below, without touching the scene', async () => {
      const extraLantern = randomUUID();
      const gull = await drawn('npc', 'Gull the smuggler', desk);
      const gullId = randomUUID();
      const miraId = randomUUID();
      await addLiveObject(handle.db, deskScope, { id: extraLantern, recordId: lantern.record.id });
      await addLiveObject(handle.db, deskScope, { id: gullId, recordId: gull.record.id });
      await addLiveObject(handle.db, deskScope, {
        id: miraId,
        characterId: mira.id,
        across: 0.2,
        depthTick: 1,
      });

      expect(await objectOf(extraLantern)).toMatchObject({
        kind: 'prop',
        shown: false,
        mount: 'stand',
        up: 0,
        depthTick: 5,
      });
      expect(await objectOf(gullId)).toMatchObject({ kind: 'puppet', shown: false, mount: null });
      expect(await objectOf(miraId)).toMatchObject({
        kind: 'puppet',
        shown: false,
        across: 0.2,
        up: 0.1,
        depthTick: 1,
        subject: { kind: 'pc', id: mira.id, name: 'Mira' },
        image: { assetId: mira.assetId },
      });
      const ids = (await stages(desk)).player.objects.map((object) => object.id);
      expect(ids).not.toContain(miraId);
      expect(await revealedAt(gull.record.id)).toBeNull();

      const saved = await call('GET', `/api/campaigns/${desk.id}/scenes/${deskScene.id}`, gm);
      expect(saved.json<Scene>().objects).toHaveLength(3);

      // A PC raised reaches players, as an image and a place only: nothing to inspect.
      await setLiveObjectShown(handle.db, deskScope, miraId, 'puppet', true);
      const raised = (await stages(desk)).player.objects.find((object) => object.id === miraId);
      expect(raised).toMatchObject({
        kind: 'puppet',
        image: { assetId: mira.assetId },
        recordId: null,
      });
      expect(JSON.stringify(raised)).not.toContain('Mira');
    });

    it('adds a prop already in sight when asked, revealing it', async () => {
      const net = await drawn('item', 'Fishing net', desk);
      const id = randomUUID();
      await addLiveObject(handle.db, deskScope, {
        id,
        recordId: net.record.id,
        shown: true,
        mount: 'hang',
      });
      expect(await objectOf(id)).toMatchObject({ shown: true, mount: 'hang' });
      expect(await revealedAt(net.record.id)).not.toBeNull();
    });

    it('refuses what cannot go on the stage', async () => {
      const coast = await record({ type: 'area', name: 'The coast' }, desk);
      const spot = await record({ type: 'spot', name: 'The pier', parentId: coast.id }, desk);
      const elsewhere = await drawn('prop', 'Far away', other);
      const stranger = await pc('Stranger', true, other);
      const add = (request: Parameters<typeof addLiveObject>[2]) =>
        addLiveObject(handle.db, deskScope, request);

      await expect(add({ id: randomUUID(), characterId: faceless.id })).rejects.toMatchObject({
        statusCode: 409,
        message: 'Faceless has no image for the stage yet',
      });
      await expect(add({ id: randomUUID(), characterId: mira.id })).rejects.toMatchObject({
        statusCode: 409,
        message: 'Mira is already on the stage',
      });
      await expect(add({ id: randomUUID(), recordId: marta.record.id })).rejects.toMatchObject({
        statusCode: 409,
        message: 'Old Marta is already on the stage',
      });
      await expect(
        add({ id: deskScene.objects[0]?.id ?? '', recordId: lantern.record.id }),
      ).rejects.toMatchObject({ statusCode: 409, message: 'That is already on the stage' });
      await expect(add({ id: randomUUID(), recordId: elsewhere.record.id })).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(add({ id: randomUUID(), characterId: stranger.id })).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(add({ id: randomUUID(), recordId: spot.id })).rejects.toMatchObject({
        statusCode: 400,
        message: 'Only Props, Items and NPCs can go on the stage',
      });
      const gullTwo = await drawn('npc', 'Second gull', desk);
      await expect(
        add({ id: randomUUID(), recordId: gullTwo.record.id, shown: true }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('moves, flips and resizes an object, and keeps a puppet on its stick', async () => {
      const [prop, , puppet] = deskScene.objects;
      await moveLiveObject(handle.db, deskScope, {
        id: prop?.id ?? '',
        across: 0.1,
        up: 0.4,
        depthTick: 9,
        scale: 2,
        flipped: true,
        mount: 'hang',
      });
      expect(await objectOf(prop?.id ?? '')).toMatchObject({
        across: 0.1,
        up: 0.4,
        depthTick: 9,
        scale: 2,
        flipped: true,
        mount: 'hang',
      });

      await expect(
        moveLiveObject(handle.db, deskScope, { id: puppet?.id ?? '', mount: 'stand' }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        moveLiveObject(handle.db, deskScope, { id: randomUUID(), across: 0.5 }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('removes an object from the stage and leaves the saved scene alone', async () => {
      const [prop] = deskScene.objects;
      await removeLiveObject(handle.db, deskScope, prop?.id ?? '');
      expect(await objectOf(prop?.id ?? '')).toBeUndefined();
      await expect(removeLiveObject(handle.db, deskScope, prop?.id ?? '')).rejects.toMatchObject({
        statusCode: 404,
      });

      const saved = await call('GET', `/api/campaigns/${desk.id}/scenes/${deskScene.id}`, gm);
      expect(saved.json<Scene>().objects).toHaveLength(3);
    });

    it('holds at most 30 props and puppets', async () => {
      const placed = (await stages(desk)).gm.objects.length;
      for (let n = placed; n < 30; n += 1) {
        await addLiveObject(handle.db, deskScope, { id: randomUUID(), recordId: crate.record.id });
      }
      await expect(
        addLiveObject(handle.db, deskScope, { id: randomUUID(), recordId: crate.record.id }),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'The stage holds at most 30 props and puppets',
      });
    });

    it('drops a PC’s puppet when the PC is deleted', async () => {
      const before = (await stages(desk)).gm.objects.length;
      const deleted = await call('DELETE', `/api/campaigns/${desk.id}/characters/${mira.id}`, gm);
      expect(deleted.statusCode, deleted.body).toBe(204);

      const { gm: forGm } = await stages(desk);
      expect(forGm.objects).toHaveLength(before - 1);
      expect(forGm.objects.some((object) => object.subject.kind === 'pc')).toBe(false);
    });

    it('refuses every desk action with no session running', async () => {
      const otherScope = await scopeOf(gm, other);
      const id = randomUUID();
      for (const action of [
        () => addLiveObject(handle.db, otherScope, { id, recordId: randomUUID() }),
        () => moveLiveObject(handle.db, otherScope, { id, across: 0.5 }),
        () => removeLiveObject(handle.db, otherScope, id),
        () => setLiveObjectShown(handle.db, otherScope, id, 'prop', true),
      ]) {
        await expect(action()).rejects.toMatchObject({ statusCode: 409, message: NO_SESSION });
      }
    });

    describe('Reveal and Un-reveal', () => {
      const revealUrl = (recordId: string, action: 'reveal' | 'unreveal', c = desk) =>
        `/api/campaigns/${c.id}/records/${recordId}/${action}`;

      it('reveals and un-reveals a record for the GM, logging each during a session', async () => {
        const lore = await record({ type: 'lore', name: 'The drowned bell' }, desk);
        const before = (await events()).length;

        const revealed = await call('POST', revealUrl(lore.id, 'reveal'), gm);
        expect(revealed.statusCode, revealed.body).toBe(200);
        expect(revealed.json<CampaignRecord>().revealedAt).not.toBeNull();
        expect(revealed.json<CampaignRecord>().updatedAt).toBe(lore.updatedAt);

        // Revealing again changes nothing and logs nothing.
        expect((await call('POST', revealUrl(lore.id, 'reveal'), gm)).statusCode).toBe(200);

        const hidden = await call('POST', revealUrl(lore.id, 'unreveal'), gm);
        expect(hidden.statusCode, hidden.body).toBe(200);
        expect(hidden.json<CampaignRecord>().revealedAt).toBeNull();

        expect((await events()).slice(before)).toEqual([
          { kind: 'reveal', actorUserId: gm.id, recordId: lore.id },
          { kind: 'unreveal', actorUserId: gm.id, recordId: lore.id },
        ]);
      });

      it('reveals with no session running, logging nothing', async () => {
        const lore = await record({ type: 'lore', name: 'Quiet legend' }, other);
        const revealed = await call('POST', revealUrl(lore.id, 'reveal', other), gm);
        expect(revealed.statusCode, revealed.body).toBe(200);
        expect(revealed.json<CampaignRecord>().revealedAt).not.toBeNull();
        const logged = await handle.db
          .select()
          .from(sessionEvents)
          .where(eq(sessionEvents.recordId, lore.id));
        expect(logged).toEqual([]);
      });

      it('refuses a player, and a record of another campaign', async () => {
        const lore = await record({ type: 'lore', name: 'Players’ secret' });
        const asPlayer = await call('POST', revealUrl(lore.id, 'reveal', campaign), player);
        expect(asPlayer.statusCode).toBe(403);
        expect(await revealedAt(lore.id)).toBeNull();

        const crossed = await call('POST', revealUrl(lore.id, 'reveal', desk), gm);
        expect(crossed.statusCode).toBe(404);
      });
    });
  });

  describe('what a player may load', () => {
    let harbour: CampaignRecord;
    let backdropAsset: string;
    let anchor: Awaited<ReturnType<typeof drawn>>;
    let chest: Awaited<ReturnType<typeof drawn>>;
    let captain: Awaited<ReturnType<typeof drawn>>;
    let unused: Awaited<ReturnType<typeof drawn>>;

    beforeAll(async () => {
      harbour = await record({ type: 'spot', name: 'The harbour', parentId: area.id });
      backdropAsset = await giveImage(harbour, 'backdrop');
      anchor = await drawn('prop', 'Rusty anchor');
      chest = await drawn('prop', 'Hidden chest');
      captain = await drawn('npc', 'Captain Reyes');
      unused = await drawn('prop', 'Not in any scene');
      const harbourScene = await scene('Harbour at dusk', harbour.id, [
        at(anchor.record.id),
        at(chest.record.id, { shown: false }),
        at(captain.record.id),
      ]);
      await start();
      await loadSceneLive(handle.db, await scopeOf(gm), harbourScene.id);
    });

    const status = async (assetId: string, who: Person, query = '?p=3') =>
      (await call('GET', `${imageUrl(assetId)}${query}`, who)).statusCode;

    it('serves the backdrop and the props in sight, as the stage’s version', async () => {
      for (const assetId of [backdropAsset, anchor.assetId]) {
        const response = await call('GET', `${imageUrl(assetId)}?p=3`, player);

        expect(response.statusCode, response.body).toBe(200);
        expect(response.headers['content-type']).toBe('image/webp');
        expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
        expect(response.body).toBe('the stage version');
      }
    });

    it('answers 404 for a hidden prop, a puppet waiting below and anything not on stage', async () => {
      for (const assetId of [chest.assetId, captain.assetId, unused.assetId, randomUUID()]) {
        expect(await status(assetId, player), assetId).toBe(404);
        expect(await status(assetId, player, ''), assetId).toBe(404);
      }
    });

    it('never serves a player the original, even of something in sight', async () => {
      expect(await status(anchor.assetId, player, '?v=original')).toBe(404);
      expect(await status(backdropAsset, player, '?v=original')).toBe(404);
    });

    it('serves the image of a record in the journal, on stage or not (F3.5)', async () => {
      const gmScope = await scopeOf(gm);
      await setRecordRevealed(handle.db, gmScope, unused.record.id, true);
      expect(await status(unused.assetId, player)).toBe(200);
      expect(await status(unused.assetId, player, '?v=original')).toBe(404);

      await setRecordRevealed(handle.db, gmScope, unused.record.id, false);
      expect(await status(unused.assetId, player)).toBe(404);
    });

    it('still serves the GM everything', async () => {
      for (const assetId of [backdropAsset, anchor.assetId, chest.assetId, captain.assetId]) {
        expect(await status(assetId, gm), assetId).toBe(200);
        expect(await status(assetId, gm, '?v=original'), assetId).toBe(200);
      }
    });

    it('stops serving a prop once it is no longer on stage', async () => {
      const emptyScene = await scene('Empty stage', null, []);
      await loadSceneLive(handle.db, await scopeOf(gm), emptyScene.id);

      expect(await status(anchor.assetId, player)).toBe(404);
      expect(await status(backdropAsset, player)).toBe(404);
    });

    it('serves nothing once the session has ended', async () => {
      const again = await scene('Harbour again', harbour.id, [at(anchor.record.id)]);
      await loadSceneLive(handle.db, await scopeOf(gm), again.id);
      expect(await status(anchor.assetId, player)).toBe(200);

      await end();

      expect(await status(anchor.assetId, player)).toBe(404);
      expect(await status(backdropAsset, player)).toBe(404);
    });
  });

  describe('transition scenes (F5.4)', () => {
    let road: CampaignRecord;
    let crate: Awaited<ReturnType<typeof drawn>>;
    let gull: Awaited<ReturnType<typeof drawn>>;
    let walker: Awaited<ReturnType<typeof drawn>>;
    let roadScene: Scene;
    let scope: CampaignScope;
    /** The travel clock's time in these tests: each passes its own `now`. */
    const T = Date.now();
    const seconds = (n: number) => T + n * 1000;

    const objectOf = <T extends { id: string }>(stage: { objects: T[] }, id: string | undefined) =>
      stage.objects.find((object) => object.id === id);
    const idOf = (target: { record: { id: string } }) =>
      roadScene.objects.find((object) => object.record.id === target.record.id)?.id ?? '';
    async function stagesAt(now: number) {
      const both = await stagesOf(handle.db, scope, now);
      if (both === null) throw new Error('no session is running');
      return both;
    }

    beforeAll(async () => {
      road = await record({
        type: 'spot',
        name: 'Coastal Road',
        parentId: area.id,
        fields: { spotType: 'transition' },
      });
      await giveImage(road, 'backdrop');
      crate = await drawn('prop', 'Fallen crate');
      gull = await drawn('npc', 'A watching gull');
      walker = await drawn('npc', 'Pip the guide');
      roadScene = await scene('Along the coast', road.id, [
        at(crate.record.id, { shown: true }),
        at(gull.record.id, { travelMode: 'stationary', up: 0.1 }),
        at(walker.record.id, { up: 0.1 }),
      ]);
      scope = await scopeOf(gm);
      if ((await running(gm)) !== null) await end();
      await start();
    });

    afterAll(async () => {
      if ((await running(gm)) !== null) await end();
    });

    it('is a transition scene from its Spot, with every prop saved hidden and each NPC set', async () => {
      expect(roadScene.type).toBe('transition');
      expect(roadScene.objects.map((object) => [object.shown, object.travelMode])).toEqual([
        [false, null],
        [false, 'stationary'],
        [false, 'walking'],
      ]);
      const list = await call('GET', `/api/campaigns/${campaign.id}/scenes`, gm);
      const listed = list.json<{ scenes: { id: string; type: string }[] }>().scenes;
      expect(listed.find((summary) => summary.id === roadScene.id)?.type).toBe('transition');
    });

    it('loads paused at the start of its travel, with nothing passing', async () => {
      await loadSceneLive(handle.db, scope, roadScene.id);

      const { gm: forGm, player: forPlayers } = await stagesAt(seconds(0));
      expect(forGm.travel).toEqual({ playing: false, distance: 0 });
      expect(forPlayers.travel).toEqual({ playing: false, distance: 0 });
      expect(forGm.objects.map((object) => [object.shown, object.passFrom])).toEqual([
        [false, null],
        [false, null],
        [false, null],
      ]);
      expect(forGm.objects.map((object) => object.travelMode)).toEqual([
        null,
        'stationary',
        'walking',
      ]);
    });

    it('plays one backdrop width every 12 seconds, and pauses where it is', async () => {
      await setTravelPlaying(handle.db, scope, true, seconds(0));
      expect((await stagesAt(seconds(6))).gm.travel).toEqual({ playing: true, distance: 0.5 });

      await setTravelPlaying(handle.db, scope, false, seconds(6));
      expect((await stagesAt(seconds(60))).gm.travel).toEqual({ playing: false, distance: 0.5 });
      // Pausing again changes nothing.
      await setTravelPlaying(handle.db, scope, false, seconds(90));
      expect((await stagesAt(seconds(90))).player.travel).toEqual({
        playing: false,
        distance: 0.5,
      });
    });

    it('passes a prop shown from where the travel is, and ends the pass one width on', async () => {
      await setTravelPlaying(handle.db, scope, true, seconds(100));
      await setLiveObjectShown(handle.db, scope, idOf(crate), 'prop', true, seconds(106));

      const passing = await stagesAt(seconds(106));
      expect(objectOf(passing.gm, idOf(crate))).toMatchObject({ shown: true, passFrom: 1 });
      expect(objectOf(passing.player, idOf(crate))).toMatchObject({ passFrom: 1 });

      // Just before the end it is still passing; just after, the views count it hidden at once.
      expect(objectOf((await stagesAt(seconds(117.9))).gm, idOf(crate))?.shown).toBe(true);
      const over = await stagesAt(seconds(118));
      expect(objectOf(over.gm, idOf(crate))).toMatchObject({ shown: false, passFrom: null });
      expect(objectOf(over.player, idOf(crate))).toBeUndefined();

      expect(await settlePasses(handle.db, scope, seconds(118))).toBe(true);
      const [row] = await handle.db
        .select({ shown: playSessionObjects.shown, passFrom: playSessionObjects.passFrom })
        .from(playSessionObjects)
        .where(eq(playSessionObjects.id, idOf(crate)));
      expect(row).toEqual({ shown: false, passFrom: null });
      expect(await settlePasses(handle.db, scope, seconds(119))).toBe(false);
    });

    it('passes a stationary NPC raised, revealed as it comes into sight; a walking one stays', async () => {
      await setCurtain(handle.db, scope, true, seconds(120));
      await setLiveObjectShown(handle.db, scope, idOf(gull), 'puppet', true, seconds(120));
      await setLiveObjectShown(handle.db, scope, idOf(walker), 'puppet', true, seconds(120));

      const { gm: forGm } = await stagesAt(seconds(120));
      // 0.5 when it paused, then 20 s at a width every 12 s.
      expect(objectOf(forGm, idOf(gull))).toMatchObject({ shown: true });
      expect(objectOf(forGm, idOf(gull))?.passFrom).toBeCloseTo(0.5 + 20 / 12);
      expect(objectOf(forGm, idOf(walker))).toMatchObject({ shown: true, passFrom: null });
      const [revealed] = await handle.db
        .select({ revealedAt: records.revealedAt })
        .from(records)
        .where(eq(records.id, gull.record.id));
      expect(revealed?.revealedAt).not.toBeNull();
    });

    it("refuses to move a passer across, and sets an NPC's travel only while it waits below", async () => {
      const across = moveLiveObject(
        handle.db,
        scope,
        { id: idOf(gull), across: 0.2 },
        seconds(121),
      );
      await expect(across).rejects.toMatchObject({ statusCode: 409 });
      // Up, depth and the rest still work while it passes.
      await moveLiveObject(handle.db, scope, { id: idOf(gull), depthTick: 3 }, seconds(121));

      const raised = moveLiveObject(
        handle.db,
        scope,
        { id: idOf(walker), travelMode: 'stationary' },
        seconds(121),
      );
      await expect(raised).rejects.toMatchObject({ statusCode: 409 });
      const onProp = moveLiveObject(
        handle.db,
        scope,
        { id: idOf(crate), travelMode: 'walking' },
        seconds(121),
      );
      await expect(onProp).rejects.toMatchObject({ statusCode: 400 });

      await setLiveObjectShown(handle.db, scope, idOf(walker), 'puppet', false, seconds(121));
      await moveLiveObject(
        handle.db,
        scope,
        { id: idOf(walker), travelMode: 'stationary' },
        seconds(121),
      );
      expect(objectOf((await stagesAt(seconds(121))).gm, idOf(walker))?.travelMode).toBe(
        'stationary',
      );
    });

    it('ends a pass when the passer is lowered, and passes a prop added in sight', async () => {
      await setLiveObjectShown(handle.db, scope, idOf(gull), 'puppet', false, seconds(122));
      expect(objectOf((await stagesAt(seconds(122))).gm, idOf(gull))).toMatchObject({
        shown: false,
        passFrom: null,
      });

      const added = randomUUID();
      await addLiveObject(
        handle.db,
        scope,
        { id: added, recordId: crate.record.id, shown: true },
        seconds(123),
      );
      expect(objectOf((await stagesAt(seconds(123))).gm, added)).toMatchObject({
        shown: true,
        travelMode: null,
      });
      expect(objectOf((await stagesAt(seconds(123))).gm, added)?.passFrom).toBeCloseTo(
        0.5 + 23 / 12,
      );
    });

    it('starts again from the start, paused, when the scene is loaded again', async () => {
      await loadSceneLive(handle.db, scope, roadScene.id);
      const { gm: forGm } = await stagesAt(seconds(200));
      expect(forGm.travel).toEqual({ playing: false, distance: 0 });
      expect(forGm.objects.every((object) => object.passFrom === null && !object.shown)).toBe(true);
    });

    it('refuses play and pause in a static scene, and has no travel there', async () => {
      const square = await record({ type: 'spot', name: 'Quiet Square', parentId: area.id });
      const still = await scene('Standing still', square.id, [at(crate.record.id)]);
      expect(still.type).toBe('static');
      expect(still.objects[0]?.shown).toBe(true);
      await loadSceneLive(handle.db, scope, still.id);

      expect((await stagesAt(seconds(300))).gm.travel).toBeNull();
      await expect(setTravelPlaying(handle.db, scope, true, seconds(300))).rejects.toMatchObject({
        statusCode: 409,
        message: 'Load a transition scene first',
      });
    });

    it('keeps a playing clock off a static scene, and a pass off what is out of sight', async () => {
      const [session] = await handle.db
        .select({ id: playSessions.id })
        .from(playSessions)
        .where(and(eq(playSessions.campaignId, campaign.id), isNull(playSessions.endedAt)));
      const clock = await handle.db
        .update(playSessions)
        .set({ transition: false, travelSince: new Date() })
        .where(eq(playSessions.id, session?.id ?? ''))
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(pgCode(clock)).toBe('23514');

      const pass = await handle.db
        .update(playSessionObjects)
        .set({ shown: false, passFrom: 1 })
        .where(eq(playSessionObjects.playSessionId, session?.id ?? ''))
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(pgCode(pass)).toBe('23514');
    });
  });
});
