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
import { loadSceneLive, NO_SESSION, setCurtain, stagesOf } from '../campaigns/play-sessions';
import { loadCampaignScope, type CampaignScope } from '../campaigns/scope';
import type { DbHandle } from '../db/client';
import {
  assets,
  campaignMembers,
  playSessionObjects,
  playSessions,
  records,
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
        objects: [],
      });
    });

    it('loads a scene as saved, and opens the curtain on it', async () => {
      await loadSceneLive(handle.db, gmScope, marketScene.id);

      const { gm: forGm } = await stages();
      expect(forGm).toMatchObject({
        sceneLoad: 1,
        curtainOpen: true,
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
          record: object.record,
          image: object.image,
          shown: object.shown,
        })),
      );
      expect(forGm.objects.map((object) => object.shown)).toEqual([true, false, false]);
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
          image: { assetId: well.assetId, width: 640, height: 1024, version: 3 },
        },
      ]);

      // Nothing of the hidden prop or the puppet waiting below, and no names or record ids.
      const sent = JSON.stringify(forPlayers);
      for (const secret of [
        trapdoor.assetId,
        trapdoor.record.id,
        fishmonger.assetId,
        fishmonger.record.id,
        well.record.id,
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

    it('loads another scene in its place, counting the load', async () => {
      const lantern = await drawn('item', 'Storm lantern');
      const cellar = await scene('The cellar', null, [
        at(lantern.record.id, { mount: 'hang', up: 0.6 }),
      ]);
      await setCurtain(handle.db, gmScope, false);

      await loadSceneLive(handle.db, gmScope, cellar.id);

      const { gm: forGm, player: forPlayers } = await stages();
      expect(forGm).toMatchObject({
        sceneLoad: 2,
        curtainOpen: true,
        backdrop: null,
        scene: { id: cellar.id, name: 'The cellar' },
      });
      expect(forGm.objects.map((object) => object.record.name)).toEqual(['Storm lantern']);
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
      expect(forGm.objects.map((object) => object.record.name)).toEqual(['The cursed well']);
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
});
