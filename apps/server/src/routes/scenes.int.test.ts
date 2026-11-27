/**
 * Scenes API (F3.2a, governance §12 "Scene builder", D-49), against a real Postgres: making a
 * scene with or without a Spot, its backdrop and suggestions, placing props and puppets as one
 * whole list, everything that list refuses, following images in use, what deleting a record,
 * a Spot or a scene does, the tray, archived campaigns and the database rules. Route-level
 * isolation with random ids (outsiders 404, players 403) is in the table in
 * `campaigns.int.test.ts`; this file adds real ids from another campaign.
 */
import { randomUUID } from 'node:crypto';

import {
  SCENE_MAX_OBJECTS,
  type Campaign,
  type CampaignRecord,
  type Scene,
  type SceneObjectInput,
  type SceneSummary,
  type StageRecordsResponse,
} from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import type { DbHandle } from '../db/client';
import {
  assets,
  campaignMembers,
  campaigns,
  records,
  sceneNext,
  sceneObjects,
  scenes,
  users,
} from '../db/schema';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Postgres error code from a failed query (Drizzle wraps the driver error in `cause`). */
function pgCode(error: unknown): unknown {
  const withCause = error as { code?: unknown; cause?: { code?: unknown } };
  return withCause.cause?.code ?? withCause.code;
}

async function failureOf(query: PromiseLike<unknown>): Promise<unknown> {
  return Promise.resolve(query).then(
    () => null,
    (error: unknown) => error,
  );
}

interface Person {
  cookie: string;
  id: string;
}

const NOT_FOUND = { error: 'Not Found', message: 'Scene not found' };

describe('Scenes API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let player: Person;
  let campaign: Campaign;
  let other: Campaign;
  let area: CampaignRecord;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('15201', 'Scenes GM');
    player = await person('15202', 'Scenes Player');
    campaign = await newCampaign('Scenes Campaign');
    other = await newCampaign('Other Scenes Campaign');
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

  async function spot(name: string, body: Record<string, unknown> = {}): Promise<CampaignRecord> {
    return record({ type: 'spot', name, parentId: area.id, ...body });
  }

  /**
   * Gives a record an image in use, as "Use this" leaves it: an approved asset with a stage
   * version (or without one, as when post-processing failed).
   */
  async function giveImage(
    target: { id: string },
    kind: 'character' | 'monster' | 'prop' | 'backdrop',
    options: { processed?: boolean; campaignId?: string; width?: number; height?: number } = {},
  ): Promise<string> {
    const processed = options.processed ?? true;
    const [asset] = await handle.db
      .insert(assets)
      .values({
        campaignId: options.campaignId ?? campaign.id,
        recordId: target.id,
        createdBy: gm.id,
        kind,
        status: 'approved',
        prompt: 'a test image',
        model: 'test/model',
        styleBibleVersion: 1,
        quality: 'medium',
        aspectRatio: kind === 'backdrop' ? '16:9' : '2:3',
        originalPath: `test/${randomUUID()}/original.png`,
        mediaType: 'image/png',
        ...(processed
          ? {
              processedPath: `test/${randomUUID()}/processed.webp`,
              processedWidth: options.width ?? 640,
              processedHeight: options.height ?? 1024,
              processingVersion: 3,
            }
          : {}),
      })
      .returning({ id: assets.id });
    const assetId = asset?.id ?? '';
    await handle.db
      .update(records)
      .set({ visualAssetId: assetId })
      .where(eq(records.id, target.id));
    return assetId;
  }

  /** A record of a placeable type that already has its image. */
  async function drawn(
    type: 'prop' | 'item' | 'npc',
    name: string,
    c = campaign,
  ): Promise<CampaignRecord> {
    const made = await record({ type, name }, c);
    await giveImage(made, type === 'npc' ? 'character' : 'prop', { campaignId: c.id });
    return made;
  }

  const base = (c: Campaign) => `/api/campaigns/${c.id}/scenes`;

  async function created(body: Record<string, unknown>, c = campaign): Promise<Scene> {
    const response = await call('POST', base(c), gm, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<Scene>();
  }

  async function loaded(sceneId: string, c = campaign): Promise<Scene> {
    const response = await call('GET', `${base(c)}/${sceneId}`, gm);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Scene>();
  }

  async function list(c = campaign): Promise<SceneSummary[]> {
    const response = await call('GET', base(c), gm);
    expect(response.statusCode).toBe(200);
    return response.json<{ scenes: SceneSummary[] }>().scenes;
  }

  const put = (sceneId: string, objects: unknown[], c = campaign, who = gm) =>
    call('PUT', `${base(c)}/${sceneId}/objects`, who, { objects });

  async function placed(sceneId: string, objects: unknown[]): Promise<Scene> {
    const response = await put(sceneId, objects);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Scene>();
  }

  /** An object as the builder sends it, in the middle of the opening. */
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

  describe('creating and reading', () => {
    it('creates an empty theater: static, no Spot, nothing placed', async () => {
      const scene = await created({ name: '  The Empty Stage  ' });

      expect(scene).toMatchObject({
        name: 'The Empty Stage',
        type: 'static',
        spot: null,
        objects: [],
        suggestions: [],
      });
      expect(await loaded(scene.id)).toEqual(scene);
    });

    it("starts from a Spot with that Spot's image in use as the backdrop", async () => {
      const market = await spot('Fish Market');
      const backdrop = await giveImage(market, 'backdrop', { width: 1536, height: 864 });

      const scene = await created({ name: 'Market at dawn', spotId: market.id });

      expect(scene.spot).toEqual({
        id: market.id,
        name: 'Fish Market',
        areaName: 'Saltmarsh',
        backdrop: { assetId: backdrop, width: 1536, height: 864, version: 3 },
      });
    });

    it('leaves the wall bare while the Spot has no image, or none for the stage', async () => {
      const bare = await spot('Bare Cellar');
      expect((await created({ name: 'Cellar', spotId: bare.id })).spot).toMatchObject({
        id: bare.id,
        backdrop: null,
      });

      const unprocessed = await spot('Unprocessed Attic');
      await giveImage(unprocessed, 'backdrop', { processed: false });
      expect((await created({ name: 'Attic', spotId: unprocessed.id })).spot?.backdrop).toBeNull();
    });

    it("suggests the Spot's props, NPCs and items, by name, with or without an image", async () => {
      const keeper = await drawn('npc', 'Old Keeper');
      const rope = await record({ type: 'item', name: 'coil of rope' });
      const lighthouse = await spot('Lighthouse', {
        links: { npcsHere: [keeper.id], itemsHere: [rope.id] },
      });
      const lamp = await record({
        type: 'prop',
        name: 'Great Lamp',
        links: { spot: [lighthouse.id] },
      });
      const lampImage = await giveImage(lamp, 'prop');
      // Placed elsewhere, so not suggested here.
      await drawn('prop', 'Distant Buoy');

      const scene = await created({ name: 'Lighthouse', spotId: lighthouse.id });

      expect(scene.suggestions).toEqual([
        { record: { id: rope.id, type: 'item', name: 'coil of rope' }, kind: 'prop', image: null },
        {
          record: { id: lamp.id, type: 'prop', name: 'Great Lamp' },
          kind: 'prop',
          image: { assetId: lampImage, width: 640, height: 1024, version: 3 },
        },
        expect.objectContaining({
          record: { id: keeper.id, type: 'npc', name: 'Old Keeper' },
          kind: 'puppet',
        }),
      ]);
      // Suggestions are only offered: nothing is placed for the GM.
      expect(scene.objects).toEqual([]);
    });

    it('rejects a bad name, unknown keys, and a Spot that is not one of this campaign', async () => {
      const npc = await record({ type: 'npc', name: 'Not A Place' });
      const foreign = await record({ type: 'area', name: 'Elsewhere' }, other);
      const foreignSpot = await record(
        { type: 'spot', name: 'Elsewhere Inn', parentId: foreign.id },
        other,
      );

      for (const body of [
        { name: '  ' },
        { name: 'x'.repeat(121) },
        { name: 'S', type: 'battle' },
      ]) {
        const response = await call('POST', base(campaign), gm, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      for (const spotId of [npc.id, foreignSpot.id, randomUUID()]) {
        const response = await call('POST', base(campaign), gm, { name: 'S', spotId });
        expect(response.statusCode, spotId).toBe(404);
        expect(response.json()).toMatchObject({ message: 'Spot not found' });
      }
    });

    it('lists scenes by name with their Spot and how many objects they hold', async () => {
      const c = await newCampaign('Listed Scenes');
      const region = await record({ type: 'area', name: 'Region' }, c);
      const quay = await record({ type: 'spot', name: 'Quay', parentId: region.id }, c);
      const crate = await drawn('prop', 'Crate', c);
      const zebra = await created({ name: 'zebra crossing' }, c);
      const apple = await created({ name: 'Apple cart', spotId: quay.id }, c);
      const response = await put(apple.id, [at(crate.id), at(crate.id, { across: 0.2 })], c);
      expect(response.statusCode, response.body).toBe(200);

      expect(await list(c)).toEqual([
        expect.objectContaining({
          id: apple.id,
          name: 'Apple cart',
          type: 'static',
          spot: { id: quay.id, name: 'Quay' },
          objectCount: 2,
        }),
        expect.objectContaining({
          id: zebra.id,
          name: 'zebra crossing',
          spot: null,
          objectCount: 0,
        }),
      ]);
      expect(await list(other)).not.toContainEqual(expect.objectContaining({ id: apple.id }));
    });
  });

  describe('renaming and changing the Spot', () => {
    it('renames, moves to another Spot, and clears the Spot', async () => {
      const first = await spot('First Room');
      const second = await spot('Second Room');
      const secondImage = await giveImage(second, 'backdrop', { width: 1536, height: 864 });
      const scene = await created({ name: 'Rooms', spotId: first.id });
      const url = `${base(campaign)}/${scene.id}`;

      const renamed = await call('PATCH', url, gm, { name: ' Two Rooms ' });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(renamed.json()).toMatchObject({ name: 'Two Rooms', spot: { id: first.id } });

      const moved = await call('PATCH', url, gm, { spotId: second.id });
      expect(moved.json<Scene>().spot).toMatchObject({
        id: second.id,
        backdrop: { assetId: secondImage },
      });

      const cleared = await call('PATCH', url, gm, { spotId: null });
      expect(cleared.json()).toMatchObject({ name: 'Two Rooms', spot: null, suggestions: [] });
    });

    it('rejects an empty patch, a bad Spot, and scenes it cannot find', async () => {
      const scene = await created({ name: 'Steady' });
      const elsewhere = await created({ name: 'Elsewhere' }, other);
      const url = `${base(campaign)}/${scene.id}`;

      expect((await call('PATCH', url, gm, {})).statusCode).toBe(400);
      expect((await call('PATCH', url, gm, { objects: [] })).statusCode).toBe(400);
      expect((await call('PATCH', url, gm, { spotId: area.id })).statusCode).toBe(404);

      for (const id of [elsewhere.id, randomUUID(), 'not-a-uuid']) {
        for (const [method, path, body] of [
          ['GET', '', undefined],
          ['PATCH', '', { name: 'Taken' }],
          ['DELETE', '', undefined],
          ['PUT', '/objects', { objects: [] }],
        ] as const) {
          const response = await call(method, `${base(campaign)}/${id}${path}`, gm, body);
          expect(response.statusCode, `${method} ${id}`).toBe(404);
          expect(response.json()).toMatchObject(NOT_FOUND);
        }
      }
      expect((await loaded(elsewhere.id, other)).name).toBe('Elsewhere');
    });
  });

  describe('placing props and puppets', () => {
    let well: CampaignRecord;
    let pendant: CampaignRecord;
    let smith: CampaignRecord;

    beforeAll(async () => {
      well = await drawn('prop', 'Stone Well');
      pendant = await drawn('item', 'Tide Pendant');
      smith = await drawn('npc', 'Smith Orla');
    });

    it('saves the list in order, working out each kind from its record', async () => {
      const scene = await created({ name: 'Village Square' });
      const objects = [
        at(well.id, { across: 0.25, up: 0, depthTick: 7, scale: 1.4 }),
        at(pendant.id, { across: 0.6, up: 0.35, depthTick: 2, flipped: true }),
        at(smith.id, { across: 0.8, up: 0.1, depthTick: 4, scale: 0.9 }),
      ];

      const saved = await placed(scene.id, objects);

      expect(saved.objects).toEqual([
        expect.objectContaining({
          id: objects[0]?.id,
          kind: 'prop',
          record: { id: well.id, type: 'prop', name: 'Stone Well' },
          across: 0.25,
          up: 0,
          depthTick: 7,
          scale: 1.4,
          flipped: false,
          shown: true,
          mount: 'stand',
        }),
        expect.objectContaining({
          id: objects[1]?.id,
          kind: 'prop',
          record: { id: pendant.id, type: 'item', name: 'Tide Pendant' },
          across: 0.6,
          up: 0.35,
          flipped: true,
          shown: true,
          mount: 'stand',
        }),
        // A puppet waits below: never shown, always on its stick.
        expect.objectContaining({
          id: objects[2]?.id,
          kind: 'puppet',
          record: { id: smith.id, type: 'npc', name: 'Smith Orla' },
          across: 0.8,
          up: 0.1,
          shown: false,
          mount: null,
        }),
      ]);
      expect(saved.objects.every((object) => object.image !== null)).toBe(true);
      expect((await loaded(scene.id)).objects).toEqual(saved.objects);
      expect(Date.parse(saved.updatedAt)).toBeGreaterThanOrEqual(Date.parse(scene.updatedAt));
    });

    it('moves, hides, hangs, reorders and removes by sending the whole list again', async () => {
      const scene = await created({ name: 'Rearranged' });
      const a = at(well.id, { across: 0.1 });
      const b = at(pendant.id, { across: 0.5 });
      const c = at(smith.id, { across: 0.9 });
      await placed(scene.id, [a, b, c]);

      const saved = await placed(scene.id, [
        { ...c, across: 0.3, depthTick: 0 },
        { ...a, shown: false, mount: 'hang', up: 0.8 },
      ]);

      expect(saved.objects).toEqual([
        expect.objectContaining({ id: c.id, kind: 'puppet', across: 0.3, depthTick: 0 }),
        expect.objectContaining({ id: a.id, kind: 'prop', shown: false, mount: 'hang', up: 0.8 }),
      ]);
      expect((await placed(scene.id, [])).objects).toEqual([]);
    });

    it('lets one prop record stand in a scene several times, up to the cap', async () => {
      const scene = await created({ name: 'Barrel Store' });
      const full = Array.from({ length: SCENE_MAX_OBJECTS }, (_unused, index) =>
        at(well.id, { across: index / SCENE_MAX_OBJECTS }),
      );

      expect((await placed(scene.id, full)).objects).toHaveLength(SCENE_MAX_OBJECTS);

      const over = await put(scene.id, [...full, at(well.id)]);
      expect(over.statusCode).toBe(400);
      expect((await loaded(scene.id)).objects).toHaveLength(SCENE_MAX_OBJECTS);
    });

    it('refuses what cannot be placed, and then writes nothing', async () => {
      const scene = await created({ name: 'Strict' });
      const kept = at(well.id, { across: 0.42 });
      await placed(scene.id, [kept]);
      const undrawn = await record({ type: 'prop', name: 'Undrawn Anvil' });
      const unprocessed = await record({ type: 'prop', name: 'Unprocessed Anvil' });
      await giveImage(unprocessed, 'prop', { processed: false });
      const faction = await record({ type: 'faction', name: 'The Guild' });
      const foreign = await drawn('prop', 'Foreign Well', other);
      const elsewhere = await created({ name: 'Elsewhere' });
      const taken = at(well.id);
      await placed(elsewhere.id, [taken]);

      const refused: [number, unknown[], string][] = [
        [404, [at(foreign.id)], 'Record not found'],
        [404, [at(randomUUID())], 'Record not found'],
        [400, [at(faction.id)], 'Only Props, Items and NPCs can be placed in a scene'],
        [400, [at(area.id)], 'Only Props, Items and NPCs can be placed in a scene'],
        [400, [at(undrawn.id)], "A record with no image for the stage can't be placed in a scene"],
        [
          400,
          [at(unprocessed.id)],
          "A record with no image for the stage can't be placed in a scene",
        ],
        [400, [at(smith.id), at(smith.id)], 'An NPC can only be in a scene once'],
        [
          400,
          [at(well.id, { travelMode: 'walking' })],
          'Only NPC puppets walk or stay where they are',
        ],
        [
          400,
          [at(smith.id, { shown: true })],
          'Only props can be shown or hung: a puppet starts lowered, on a stick',
        ],
        [
          400,
          [at(smith.id, { mount: 'stand' })],
          'Only props can be shown or hung: a puppet starts lowered, on a stick',
        ],
        [409, [{ ...taken, across: 0.1 }], 'An object id is already used by another scene'],
      ];
      for (const [status, objects, message] of refused) {
        const response = await put(scene.id, [at(pendant.id), ...objects]);
        expect(response.statusCode, message).toBe(status);
        expect(response.json()).toMatchObject({ message });
      }

      for (const bad of [
        { across: 1.2 },
        { up: -0.1 },
        { depthTick: 10 },
        { scale: 3 },
        { scale: 0.1 },
        { kind: 'puppet' },
      ]) {
        const response = await put(scene.id, [{ ...at(well.id), ...bad }]);
        expect(response.statusCode, JSON.stringify(bad)).toBe(400);
      }
      const twin = at(well.id);
      expect((await put(scene.id, [twin, twin])).statusCode).toBe(400);
      expect((await call('PUT', `${base(campaign)}/${scene.id}/objects`, gm, {})).statusCode).toBe(
        400,
      );

      // Every refusal left both scenes exactly as they were.
      expect((await loaded(scene.id)).objects).toEqual([
        expect.objectContaining({ id: kept.id, across: 0.42 }),
      ]);
      expect((await loaded(elsewhere.id)).objects).toEqual([
        expect.objectContaining({ id: taken.id, across: 0.5 }),
      ]);
    });

    it('follows the image in use, and keeps an object whose record lost its image', async () => {
      const scene = await created({ name: 'Following' });
      const cart = await drawn('prop', 'Hand Cart');
      const object = at(cart.id);
      const first = (await placed(scene.id, [object])).objects[0]?.image;

      // "Replace" (D-44): the record points at a new asset.
      const replacement = await giveImage(cart, 'prop', { width: 900, height: 700 });
      const after = (await loaded(scene.id)).objects[0]?.image;
      expect(after).toEqual({ assetId: replacement, width: 900, height: 700, version: 3 });
      expect(after?.assetId).not.toBe(first?.assetId);

      await handle.db.update(records).set({ visualAssetId: null }).where(eq(records.id, cart.id));
      const moved = await placed(scene.id, [{ ...object, across: 0.9 }]);
      expect(moved.objects).toEqual([
        expect.objectContaining({ id: object.id, across: 0.9, image: null }),
      ]);
      // But it can't be placed anew.
      expect((await put(scene.id, [{ ...object, across: 0.9 }, at(cart.id)])).statusCode).toBe(400);
    });
  });

  describe('deleting', () => {
    it('takes a deleted record out of every scene, and bares the wall of a deleted Spot', async () => {
      const cove = await spot('Hidden Cove');
      await giveImage(cove, 'backdrop');
      const chest = await drawn('prop', 'Sea Chest');
      const gull = await drawn('npc', 'Gull Whisperer');
      const scene = await created({ name: 'Cove', spotId: cove.id });
      const stays = at(gull.id);
      await placed(scene.id, [at(chest.id), stays, at(chest.id, { across: 0.1 })]);

      const records_ = `/api/campaigns/${campaign.id}/records`;
      expect((await call('DELETE', `${records_}/${chest.id}`, gm)).statusCode).toBe(204);
      expect((await loaded(scene.id)).objects).toEqual([expect.objectContaining({ id: stays.id })]);

      expect((await call('DELETE', `${records_}/${cove.id}`, gm)).statusCode).toBe(204);
      expect(await loaded(scene.id)).toMatchObject({ name: 'Cove', spot: null, suggestions: [] });
    });

    it('deletes a scene with its objects, and leaves the records alone', async () => {
      const lantern = await drawn('prop', 'Storm Lantern');
      const scene = await created({ name: 'Short Lived' });
      await placed(scene.id, [at(lantern.id)]);
      const url = `${base(campaign)}/${scene.id}`;

      expect((await call('DELETE', url, gm)).statusCode).toBe(204);

      expect((await call('GET', url, gm)).statusCode).toBe(404);
      expect((await call('DELETE', url, gm)).statusCode).toBe(404);
      const left = await handle.db
        .select()
        .from(sceneObjects)
        .where(eq(sceneObjects.sceneId, scene.id));
      expect(left).toEqual([]);
      const still = await call('GET', `/api/campaigns/${campaign.id}/records/${lantern.id}`, gm);
      expect(still.statusCode).toBe(200);
    });
  });

  describe('the tray', () => {
    it('offers every Prop, Item and NPC with a stage image, and every Spot', async () => {
      const c = await newCampaign('Tray Campaign');
      const region = await record({ type: 'area', name: 'Region' }, c);
      const anchor = await drawn('prop', 'anchor', c);
      const bosun = await drawn('npc', 'Bosun', c);
      const compass = await drawn('item', 'Compass', c);
      await record({ type: 'prop', name: 'No Image Yet' }, c);
      const halfDone = await record({ type: 'item', name: 'Half Done' }, c);
      await giveImage(halfDone, 'prop', { processed: false, campaignId: c.id });
      await record({ type: 'faction', name: 'Crew' }, c);
      const deck = await record({ type: 'spot', name: 'Deck', parentId: region.id }, c);
      const deckImage = await giveImage(deck, 'backdrop', {
        campaignId: c.id,
        width: 1536,
        height: 864,
      });
      const hold = await record({ type: 'spot', name: 'Hold', parentId: region.id }, c);

      const response = await call('GET', `/api/campaigns/${c.id}/stage-records`, gm);
      expect(response.statusCode, response.body).toBe(200);
      const tray = response.json<StageRecordsResponse>();

      expect(tray.records.map((entry) => [entry.record.id, entry.kind])).toEqual([
        [anchor.id, 'prop'],
        [bosun.id, 'puppet'],
        [compass.id, 'prop'],
      ]);
      expect(tray.records.every((entry) => entry.image !== null)).toBe(true);
      expect(tray.spots).toEqual([
        {
          id: deck.id,
          name: 'Deck',
          areaName: 'Region',
          backdrop: { assetId: deckImage, width: 1536, height: 864, version: 3 },
        },
        { id: hold.id, name: 'Hold', areaName: 'Region', backdrop: null },
      ]);
    });
  });

  describe('likely next scenes (F5.2)', () => {
    const patch = (sceneId: string, nextSceneIds: string[], c = campaign) =>
      call('PATCH', `${base(c)}/${sceneId}`, gm, { nextSceneIds });

    it('starts empty, then sets, reorders and clears the list, in the list endpoint too', async () => {
      const c = await newCampaign('Leading On');
      const docks = await created({ name: 'Docks' }, c);
      const fire = await created({ name: 'Warehouse fire' }, c);
      const master = await created({ name: 'Harbour master' }, c);
      expect(docks.nextScenes).toEqual([]);

      const set = await patch(docks.id, [fire.id, master.id], c);
      expect(set.statusCode, set.body).toBe(200);
      expect(set.json<Scene>().nextScenes).toEqual([
        { id: fire.id, name: 'Warehouse fire' },
        { id: master.id, name: 'Harbour master' },
      ]);
      expect(set.json<Scene>().updatedAt > docks.updatedAt).toBe(true);
      expect((await list(c)).find((entry) => entry.id === docks.id)?.nextSceneIds).toEqual([
        fire.id,
        master.id,
      ]);

      expect((await patch(docks.id, [master.id, fire.id], c)).json<Scene>().nextScenes).toEqual([
        { id: master.id, name: 'Harbour master' },
        { id: fire.id, name: 'Warehouse fire' },
      ]);
      // A rename on the scene listed shows on the next read.
      await call('PATCH', `${base(c)}/${master.id}`, gm, { name: 'The harbour master' });
      expect((await loaded(docks.id, c)).nextScenes[0]?.name).toBe('The harbour master');

      expect((await patch(docks.id, [], c)).json<Scene>().nextScenes).toEqual([]);
      expect((await list(c)).every((entry) => entry.nextSceneIds.length === 0)).toBe(true);
    });

    it('leaves the list alone when a patch changes something else', async () => {
      const c = await newCampaign('Kept Lists');
      const a = await created({ name: 'A' }, c);
      const b = await created({ name: 'B' }, c);
      await patch(a.id, [b.id], c);
      const renamed = await call('PATCH', `${base(c)}/${a.id}`, gm, { name: 'A again' });
      expect(renamed.json<Scene>().nextScenes).toEqual([{ id: b.id, name: 'B' }]);
    });

    it('refuses the scene itself, a repeat, a seventh, and scenes it cannot find', async () => {
      const c = await newCampaign('Bad Lists');
      const docks = await created({ name: 'Docks' }, c);
      const fire = await created({ name: 'Warehouse fire' }, c);
      const six: string[] = [];
      for (let n = 1; n <= 6; n += 1)
        six.push((await created({ name: `Next ${String(n)}` }, c)).id);
      const elsewhere = await created({ name: 'Elsewhere' }, other);
      await patch(docks.id, [fire.id], c);

      const itself = await patch(docks.id, [fire.id, docks.id], c);
      expect(itself.statusCode).toBe(400);
      expect(itself.json<{ message: string }>().message).toBe("A scene can't lead to itself");
      expect((await patch(docks.id, [fire.id, fire.id], c)).statusCode).toBe(400);
      expect((await patch(docks.id, [...six, fire.id], c)).statusCode).toBe(400);
      expect((await patch(docks.id, six, c)).statusCode).toBe(200);
      expect((await patch(docks.id, [elsewhere.id], c)).statusCode).toBe(404);
      expect((await patch(docks.id, [randomUUID()], c)).statusCode).toBe(404);
      // Nothing refused was written: the six from the good patch are still there.
      expect((await loaded(docks.id, c)).nextScenes.map((entry) => entry.id)).toEqual(six);
    });

    it('drops a deleted scene from every list, and a deleted scene takes its own list along', async () => {
      const c = await newCampaign('Deleted Leads');
      const a = await created({ name: 'A' }, c);
      const b = await created({ name: 'B' }, c);
      const gone = await created({ name: 'Gone' }, c);
      await patch(a.id, [gone.id, b.id], c);
      await patch(gone.id, [a.id], c);

      expect((await call('DELETE', `${base(c)}/${gone.id}`, gm)).statusCode).toBe(204);
      expect((await loaded(a.id, c)).nextScenes).toEqual([{ id: b.id, name: 'B' }]);
      const rows = await handle.db.select().from(sceneNext).where(eq(sceneNext.campaignId, c.id));
      expect(rows).toEqual([expect.objectContaining({ sceneId: a.id, nextSceneId: b.id })]);
    });
  });

  describe('players and archived campaigns', () => {
    it('keeps players out of a real scene', async () => {
      const scene = await created({ name: 'GM Eyes Only' });
      const url = `${base(campaign)}/${scene.id}`;

      for (const [method, path, body] of [
        ['GET', url, undefined],
        ['PATCH', url, { name: 'Mine Now' }],
        ['PATCH', url, { nextSceneIds: [] }],
        ['PUT', `${url}/objects`, { objects: [] }],
        ['DELETE', url, undefined],
        ['GET', base(campaign), undefined],
        ['GET', `/api/campaigns/${campaign.id}/stage-records`, undefined],
      ] as const) {
        const response = await call(method, path, player, body);
        expect(response.statusCode, `${method} ${path}`).toBe(403);
      }
      expect((await loaded(scene.id)).name).toBe('GM Eyes Only');
    });

    it('makes an archived campaign read-only', async () => {
      const c = await newCampaign('Archived Scenes');
      const crate = await drawn('prop', 'Crate', c);
      const scene = await created({ name: 'Frozen' }, c);
      const object = at(crate.id);
      expect((await put(scene.id, [object], c)).statusCode).toBe(200);
      expect((await call('POST', `/api/campaigns/${c.id}/archive`, gm)).statusCode).toBe(200);
      const url = `${base(c)}/${scene.id}`;

      for (const [method, path, body] of [
        ['POST', base(c), { name: 'New' }],
        ['PATCH', url, { name: 'Thawed' }],
        ['PATCH', url, { nextSceneIds: [] }],
        ['PUT', `${url}/objects`, { objects: [] }],
        ['DELETE', url, undefined],
      ] as const) {
        const response = await call(method, path, gm, body);
        expect(response.statusCode, `${method} ${path}`).toBe(409);
      }
      expect(await loaded(scene.id, c)).toMatchObject({
        name: 'Frozen',
        objects: [expect.objectContaining({ id: object.id })],
      });
      expect(await list(c)).toHaveLength(1);
    });
  });

  describe('database rules', () => {
    it('keeps puppets lowered and on sticks, and objects inside the theater', async () => {
      const scene = await created({ name: 'Rules' });
      const npc = await drawn('npc', 'Rule Keeper');
      const prop = await drawn('prop', 'Rule Book');
      const row = {
        sceneId: scene.id,
        campaignId: campaign.id,
        across: 0.5,
        up: 0.5,
        depthTick: 3,
        position: 0,
      };
      const puppet = {
        ...row,
        kind: 'puppet' as const,
        recordId: npc.id,
        shown: false,
        travelMode: 'walking' as const,
      };
      const standing = {
        ...row,
        kind: 'prop' as const,
        recordId: prop.id,
        shown: true,
        mount: 'stand' as const,
      };

      for (const bad of [
        { ...puppet, shown: true },
        { ...puppet, mount: 'hang' as const },
        // Every puppet has a travel mode, and a prop has none (F5.4).
        { ...puppet, travelMode: null },
        { ...standing, travelMode: 'walking' as const },
        { ...standing, mount: null },
        { ...standing, across: 1.5 },
        { ...standing, up: -0.5 },
        { ...standing, depthTick: 10 },
        { ...standing, scale: 9 },
        { ...standing, position: -1 },
      ]) {
        const error = await failureOf(handle.db.insert(sceneObjects).values(bad));
        expect(pgCode(error), JSON.stringify(bad)).toBe('23514');
      }

      await handle.db.insert(sceneObjects).values(puppet);
      const again = await failureOf(
        handle.db.insert(sceneObjects).values({ ...puppet, position: 1 }),
      );
      expect(pgCode(again)).toBe('23505');
      // A prop record may repeat.
      await handle.db.insert(sceneObjects).values([standing, { ...standing, position: 2 }]);

      const longName = await failureOf(
        handle.db.insert(scenes).values({ campaignId: campaign.id, name: 'x'.repeat(121) }),
      );
      expect(pgCode(longName)).toBe('23514');
    });

    it('removes scenes with their campaign', async () => {
      const c = await newCampaign('Doomed Scenes');
      const crate = await drawn('prop', 'Crate', c);
      const scene = await created({ name: 'Doomed' }, c);
      expect((await put(scene.id, [at(crate.id)], c)).statusCode).toBe(200);

      await handle.db.delete(campaigns).where(eq(campaigns.id, c.id));

      const objectsLeft = await handle.db
        .select()
        .from(sceneObjects)
        .where(eq(sceneObjects.sceneId, scene.id));
      expect(objectsLeft).toEqual([]);
      expect(await handle.db.select().from(scenes).where(eq(scenes.id, scene.id))).toEqual([]);
    });
  });
});
