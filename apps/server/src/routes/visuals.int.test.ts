/**
 * Generate visual (F2.3, governance §11, D-42), against a real Postgres with OpenRouter faked
 * and the queue run inline: the prompt and anchors per record type and kind, the image file
 * and its route, post-processing and its startup backfill (F2.4, D-43), review (F2.5, D-44: use,
 * replace, discard, regenerate with notes, the startup sweep of discarded files), every
 * failure, the cost guardrails, archived campaigns, uploads (F2.6, D-70), and
 * the two §14 checks (no prompt or key in logs, no key in responses). Route-level isolation
 * (outsiders 404, players 403) is in the table in `campaigns.int.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';

import type {
  AssetSummary,
  Campaign,
  CampaignRecord,
  Character,
  CharacterSheet,
  VisualsResponse,
} from '@stagehand/shared';
import {
  IMAGE_MODEL,
  VISUAL_LIMITS,
  VISUAL_UPLOAD_MAX_BYTES,
  VISUAL_UPLOAD_MESSAGES,
} from '@stagehand/shared';
import { anchorsFor, loadStyleBible } from '@stagehand/style-bible';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  discordUser,
  SAME_ORIGIN,
  signIn,
  TEST_CREDENTIALS_KEY,
} from '../../test/auth-helpers';
import { FULL_FIELDS, richText } from '../../test/record-fixtures';
import { failInterruptedVisuals, purgeDiscarded } from '../campaigns/visuals';
import { saveProviderKey } from '../credentials/store';
import type { DbHandle } from '../db/client';
import { assets, campaignMembers, users } from '../db/schema';
import type { ImageCallInput, ImageCallResult } from '../providers/openrouter';
import { processStoredVisual, processVisualJob, queueStaleProcessing } from '../visuals/job';
import {
  BACKDROP_SIZE,
  CUTOUT_MAX_SIDE,
  PROCESSING_VERSION,
  processImage,
} from '../visuals/process';
import type { VisualQueue } from '../visuals/queue';
import { loadReferences } from '../visuals/references';
import type { AssetStorage } from '../visuals/storage';

import { NO_OPENROUTER_KEY } from './visuals';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Person {
  cookie: string;
  id: string;
}

const GM_KEY = 'sk-or-v1-VisualGmVisualGmVisualGm0123456789abcdefvis1';
/** Marks a GM's revision notes, to look for in logs. */
const NOTES_MARK = 'QUIZZICALMARMALADE';
/** Marks a record's private appearance, to look for in logs. */
const APPEARANCE_MARK = 'PERIWINKLEGANTRY';
/** Not an image at all: the call "succeeds" but post-processing can't read it. */
const IMAGE = Buffer.from('not really a png, but bytes all the same');

/** The GM's own art: an orange box on a transparent background. */
async function transparentPng(width = 200, height = 300): Promise<Buffer> {
  const box = await sharp({
    create: { width: width / 2, height: height / 2, channels: 4, background: '#EB7814FF' },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: box, left: width / 4, top: height / 4 }])
    .png()
    .toBuffer();
}

/** A real cutout as the model draws one: an orange box on its magenta key color. */
async function keyedPng(): Promise<Buffer> {
  const box = await sharp({
    create: { width: 120, height: 200, channels: 3, background: '#EB7814' },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: 300, height: 400, channels: 3, background: '#F203EC' } })
    .composite([{ input: box, left: 90, top: 100 }])
    .png()
    .toBuffer();
}

type Script = (input: ImageCallInput) => ImageCallResult | Promise<ImageCallResult>;

const BIBLE = loadStyleBible();
const anchorBytes = (kind: Parameters<typeof anchorsFor>[1]) =>
  anchorsFor(BIBLE, kind).map((anchor) => readFileSync(anchor.path));

describe('Visuals API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let settled: () => Promise<void>;
  let storage: AssetStorage;
  let visualQueue: VisualQueue;
  let gm: Person;
  let player: Person;
  let keyless: Person;
  let campaign: Campaign;
  /** One answer per image call, in order; with none queued, the image comes back. */
  let scripts: Script[] = [];
  const calls: ImageCallInput[] = [];
  const logLines: string[] = [];
  const responseBodies: string[] = [];

  async function generateImage(input: ImageCallInput): Promise<ImageCallResult> {
    calls.push(input);
    const script = scripts.shift();
    if (script !== undefined) return script(input);
    return { status: 'ok', image: IMAGE, mediaType: 'image/png', costUsd: 0.0612 };
  }

  beforeAll(async () => {
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logLines.push(chunk.toString('utf8'));
        callback();
      },
    });
    ({
      app,
      handle,
      storage,
      visualsSettled: settled,
      visualQueue,
    } = await buildTestApp({
      logger: { level: 'trace', stream: logStream },
      openrouter: { generateImage },
    }));
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('10001', 'Visual GM');
    player = await person('10002', 'Visual Player');
    keyless = await person('10003', 'Keyless GM');
    await saveProviderKey(handle.db, TEST_CREDENTIALS_KEY, gm.id, 'openrouter', GM_KEY);
    campaign = await newCampaign('Painted Coast');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await settled();
    scripts = [];
    calls.length = 0;
    // Each test starts with a fresh hourly quota.
    await handle.db
      .update(assets)
      .set({ createdAt: sql`${assets.createdAt} - interval '2 hours'` });
  });

  async function call(method: Method, url: string, who: Person | null, payload?: unknown) {
    const response = await app.inject({
      method,
      url,
      headers: { ...SAME_ORIGIN, cookie: who?.cookie ?? '' },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    responseBodies.push(`${JSON.stringify(response.headers)}\n${response.body}`);
    return response;
  }

  async function newCampaign(name: string, owner = gm): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', owner, { name });
    expect(response.statusCode).toBe(201);
    return response.json<Campaign>();
  }

  async function makeRecord(
    body: Record<string, unknown>,
    c: Campaign = campaign,
    who: Person = gm,
  ): Promise<CampaignRecord> {
    const response = await call('POST', `/api/campaigns/${c.id}/records`, who, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<CampaignRecord>();
  }

  async function makePc(name: string, c: Campaign = campaign): Promise<Character> {
    const response = await call('POST', `/api/campaigns/${c.id}/characters`, gm, { name });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<Character>();
  }

  const recordBase = (r: { id: string }, c: Campaign = campaign) =>
    `/api/campaigns/${c.id}/records/${r.id}`;
  const pcBase = (pc: { id: string }, c: Campaign = campaign) =>
    `/api/campaigns/${c.id}/characters/${pc.id}`;
  const imageUrl = (assetId: string, c: Campaign = campaign) =>
    `/api/campaigns/${c.id}/assets/${assetId}/image`;

  async function generate(base: string, body: unknown = {}, who: Person = gm) {
    return call('POST', `${base}/visuals`, who, body);
  }

  async function started(base: string, body: unknown = {}): Promise<AssetSummary> {
    const response = await generate(base, body);
    expect(response.statusCode, response.body).toBe(202);
    return response.json<AssetSummary>();
  }

  async function discard(base: string, assetId: string): Promise<VisualsResponse> {
    const response = await call('DELETE', `${base}/visuals/${assetId}`, gm);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<VisualsResponse>();
  }

  async function revise(base: string, assetId: string, notes: unknown, who: Person = gm) {
    return call('POST', `${base}/visuals/${assetId}/revise`, who, { notes });
  }

  async function use(base: string, assetId: string) {
    return call('PUT', `${base}/visual`, gm, { assetId });
  }

  async function rowOf(assetId: string) {
    const [row] = await handle.db.select().from(assets).where(eq(assets.id, assetId));
    return row;
  }

  async function visuals(base: string): Promise<VisualsResponse> {
    const response = await call('GET', `${base}/visuals`, gm);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<VisualsResponse>();
  }

  async function aProp(name = 'Harbour Bell'): Promise<CampaignRecord> {
    return makeRecord({
      type: 'prop',
      name,
      publicDescription: richText('It rings at every tide.'),
      fields: { appearance: `A barnacled bell on a post ${APPEARANCE_MARK}` },
    });
  }

  /** Makes image calls wait until `release()`. */
  function hold(): { release: () => void } {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting: Script = async () => {
      await gate;
      return { status: 'ok', image: IMAGE, mediaType: 'image/png', costUsd: 0.05 };
    };
    scripts = Array.from({ length: 10 }, () => waiting);
    return { release };
  }

  describe('making an image', () => {
    it('answers 202 at once and finishes in the background', async () => {
      const prop = await aProp();
      const { release } = hold();

      const asset = await started(recordBase(prop));
      expect(asset).toMatchObject({
        kind: 'prop',
        status: 'generating',
        errorCode: null,
        costUsd: null,
        finishedAt: null,
      });
      expect((await visuals(recordBase(prop))).drafts.at(-1)?.status).toBe('generating');

      release();
      await settled();
      const after = await visuals(recordBase(prop));
      expect(after.visualAssetId).toBeNull();
      expect(after.drafts).toEqual([
        expect.objectContaining({ id: asset.id, status: 'pending', costUsd: 0.05 }),
      ]);
      expect(after.drafts[0]?.finishedAt).not.toBeNull();
    });

    it("sends the prop prompt and the prop anchors under the GM's key", async () => {
      const prop = await aProp('Tide Bell');
      await started(recordBase(prop));
      await settled();

      expect(calls).toHaveLength(1);
      const [input] = calls;
      expect(input).toMatchObject({
        apiKey: GM_KEY,
        model: IMAGE_MODEL,
        aspectRatio: '1:1',
        quality: 'medium',
      });
      expect(input?.prompt).toContain(BIBLE.base);
      expect(input?.prompt).toContain('Tide Bell');
      expect(input?.prompt).toContain(`Appearance: A barnacled bell on a post ${APPEARANCE_MARK}`);
      expect(input?.prompt).toContain('Description: It rings at every tide.');
      expect(input?.prompt).toContain('#FF00FF');
      expect(input?.references.map((r) => r.data)).toEqual(anchorBytes('prop'));
    });

    it('serves the image to the GM, with its cost recorded', async () => {
      const prop = await aProp('Lamp Post');
      const asset = await started(recordBase(prop));
      await settled();

      // These bytes can't be post-processed, so the try keeps only its original: served on
      // the plain URL until a stage version exists (so not cached), and on ?v=original.
      const response = await call('GET', imageUrl(asset.id), gm);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('private, no-cache');
      expect(response.rawPayload).toEqual(IMAGE);
      const original = await call('GET', `${imageUrl(asset.id)}?v=original`, gm);
      expect(original.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(original.rawPayload).toEqual(IMAGE);
      expect((await visuals(recordBase(prop))).drafts.at(-1)?.processed).toBeNull();
      expect(logLines.join('')).toContain('"stage":"process"');

      const [row] = await handle.db.select().from(assets).where(eq(assets.id, asset.id));
      expect(row).toMatchObject({
        status: 'pending',
        costUsd: 0.0612,
        model: IMAGE_MODEL,
        styleBibleVersion: BIBLE.version,
        mediaType: 'image/png',
        originalPath: `campaigns/${campaign.id}/${asset.id}.png`,
        processedPath: null,
      });
      expect(row?.startedAt).not.toBeNull();
    });

    it('draws an Item with its kind line and the prop template', async () => {
      const item = await makeRecord({
        type: 'item',
        name: 'Green Lantern',
        fields: { kind: 'Light source', appearance: 'Brass with green glass' },
      });
      expect((await started(recordBase(item))).kind).toBe('prop');
      await settled();
      expect(calls[0]?.prompt).toContain('Kind: Light source\nAppearance: Brass with green glass');
      expect(calls[0]?.references.map((r) => r.data)).toEqual(anchorBytes('prop'));
    });

    it("draws a Spot as a backdrop with its Area's description", async () => {
      const area = await makeRecord({
        type: 'area',
        name: 'Saltreach',
        publicDescription: richText('A harbour town built on stilts'),
      });
      const spot = await makeRecord({
        type: 'spot',
        name: 'Fish Market',
        parentId: area.id,
        fields: { backdropNotes: 'Wide dock at dusk' },
      });
      expect((await started(recordBase(spot))).kind).toBe('backdrop');
      await settled();
      expect(calls[0]).toMatchObject({ aspectRatio: '16:9' });
      expect(calls[0]?.prompt).toContain(
        'Backdrop notes: Wide dock at dusk\nArea: A harbour town built on stilts',
      );
      expect(calls[0]?.prompt).not.toContain('#FF00FF');
      expect(calls[0]?.references.map((r) => r.data)).toEqual(anchorBytes('backdrop'));
    });

    it('asks an NPC whether it is a humanoid or a monster, and draws it as told', async () => {
      const npc = await makeRecord({ type: 'npc', name: 'Old Gnarl', fields: FULL_FIELDS.npc });

      const unsure = await generate(recordBase(npc), {});
      expect(unsure.statusCode).toBe(400);
      expect(unsure.json()).toMatchObject({
        issues: [{ path: 'kind', message: 'Choose whether this is a humanoid or a monster' }],
      });
      expect((await generate(recordBase(npc), { kind: 'prop' })).statusCode).toBe(400);

      const monster = await started(recordBase(npc), { kind: 'monster' });
      expect(monster.kind).toBe('monster');
      await settled();
      expect(calls[0]).toMatchObject({ aspectRatio: '2:3' });
      expect(calls[0]?.prompt).toContain('Appearance: Tall, salt-stained coat');
      expect(calls[0]?.references.map((r) => r.data)).toEqual(anchorBytes('monster'));

      await discard(recordBase(npc), monster.id);
      expect((await started(recordBase(npc), { kind: 'character' })).kind).toBe('character');
      await settled();
      expect(calls[1]?.references.map((r) => r.data)).toEqual(anchorBytes('character'));
      expect((await visuals(recordBase(npc))).drafts.map((a) => a.kind)).toEqual(['character']);
    });

    it('draws a PC as a humanoid, from its class and description', async () => {
      const pc = await makePc('Wren');
      const patched = await call('PATCH', pcBase(pc), gm, {
        className: 'Ranger',
        publicDescription: richText('Freckles and a wide grin'),
      });
      expect(patched.statusCode, patched.body).toBe(200);

      expect((await generate(pcBase(pc), { kind: 'monster' })).statusCode).toBe(400);
      expect((await started(pcBase(pc))).kind).toBe('character');
      await settled();
      expect(calls[0]?.references.map((r) => r.data)).toEqual(anchorBytes('character'));
      expect(calls[0]?.prompt).toContain('Wren');
      expect(calls[0]?.prompt).toContain(
        'Class or role: Ranger\nDescription: Freckles and a wide grin',
      );
    });

    it('refuses a prop drawn as anything but a prop, and records with no visual', async () => {
      const prop = await aProp('Anchor Stone');
      expect((await generate(recordBase(prop), { kind: 'backdrop' })).statusCode).toBe(400);
      expect((await generate(recordBase(prop), { kind: 'dragon' })).statusCode).toBe(400);

      for (const type of ['area', 'faction', 'lore', 'story_beat', 'session_notes']) {
        const record = await makeRecord({
          type,
          name: `No visual ${type}`,
          fields: FULL_FIELDS[type as keyof typeof FULL_FIELDS],
        });
        const response = await generate(recordBase(record), {});
        expect(response.statusCode, type).toBe(400);
        expect(response.json<{ message: string }>().message).toBe(
          'Only NPCs, Props, Items and Spots have a visual',
        );
        expect((await call('GET', `${recordBase(record)}/visuals`, gm)).statusCode).toBe(400);
      }
      expect(calls).toHaveLength(0);
    });

    it('answers 404 for a record, PC or image of another campaign', async () => {
      const other = await newCampaign('Other Shore');
      const theirs = await makeRecord({ type: 'prop', name: 'Their Bell' }, other);
      const theirPc = await makePc('Their PC', other);
      const asset = await started(recordBase(theirs, other));
      await settled();

      expect((await generate(recordBase(theirs), {})).statusCode).toBe(404);
      expect((await call('GET', `${recordBase(theirs)}/visuals`, gm)).statusCode).toBe(404);
      expect((await generate(pcBase(theirPc), { kind: 'character' })).statusCode).toBe(404);
      expect((await call('GET', imageUrl(asset.id), gm)).statusCode).toBe(404);
      expect((await call('GET', imageUrl(asset.id, other), gm)).statusCode).toBe(200);
      // A stat block has no Generate visual: its id is no record.
      const block = await call('POST', `/api/campaigns/${campaign.id}/stat-blocks`, gm, {
        name: 'Bog Troll',
      });
      expect((await generate(recordBase(block.json<{ id: string }>()), {})).statusCode).toBe(404);
    });
  });

  describe('post-processing (F2.4)', () => {
    it('stores a cut-out stage version beside the original and serves it by default', async () => {
      const prop = await aProp('Copper Kettle');
      const png = await keyedPng();
      scripts = [() => ({ status: 'ok', image: png, mediaType: 'image/png', costUsd: 0.07 })];
      const asset = await started(recordBase(prop));
      await settled();

      const [summary] = (await visuals(recordBase(prop))).drafts;
      expect(summary?.status).toBe('pending');
      expect(summary?.processed).toEqual({
        width: expect.any(Number) as number,
        height: 1024,
        version: PROCESSING_VERSION,
      });

      const response = await call(
        'GET',
        `${imageUrl(asset.id)}?p=${String(PROCESSING_VERSION)}`,
        gm,
      );
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/webp');
      expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      const meta = await sharp(response.rawPayload).metadata();
      expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual([
        'webp',
        summary?.processed?.width,
        1024,
        true,
      ]);

      const original = await call('GET', `${imageUrl(asset.id)}?v=original`, gm);
      expect(original.headers['content-type']).toBe('image/png');
      expect(original.rawPayload).toEqual(png);

      const [row] = await handle.db.select().from(assets).where(eq(assets.id, asset.id));
      expect(row?.processedPath).toBe(`campaigns/${campaign.id}/processed/${asset.id}.webp`);
    });

    it('sizes a backdrop to the stage', async () => {
      const area = await makeRecord({ type: 'area', name: 'Gull Point' });
      const spot = await makeRecord({ type: 'spot', name: 'Lighthouse Steps', parentId: area.id });
      const png = await sharp({
        create: { width: 320, height: 180, channels: 3, background: '#21B0E8' },
      })
        .png()
        .toBuffer();
      scripts = [() => ({ status: 'ok', image: png, mediaType: 'image/png', costUsd: 0.04 })];
      await started(recordBase(spot));
      await settled();

      expect((await visuals(recordBase(spot))).drafts.at(-1)?.processed).toMatchObject({
        width: BACKDROP_SIZE.width,
        height: BACKDROP_SIZE.height,
      });
    });

    it('refuses an unknown image variant', async () => {
      const prop = await aProp('Rope Coil');
      const asset = await started(recordBase(prop));
      await settled();
      expect((await call('GET', `${imageUrl(asset.id)}?v=thumbnail`, gm)).statusCode).toBe(400);
    });

    it('makes stage versions at startup for images without one or from an older version', async () => {
      const prop = await aProp('Ship in a Bottle');
      const asset = await started(recordBase(prop));
      await settled();
      expect((await visuals(recordBase(prop))).drafts.at(-1)?.processed).toBeNull();

      // The original becomes a real image (as if made before post-processing existed).
      const [row] = await handle.db.select().from(assets).where(eq(assets.id, asset.id));
      await storage.put(row?.originalPath ?? '', await keyedPng());
      expect(await queueStaleProcessing(handle.db, visualQueue)).toBeGreaterThan(0);
      await settled();
      expect((await visuals(recordBase(prop))).drafts.at(-1)?.processed?.version).toBe(
        PROCESSING_VERSION,
      );

      // An older version is made again; one already current is left alone.
      await handle.db
        .update(assets)
        .set({ processingVersion: PROCESSING_VERSION - 1 })
        .where(eq(assets.id, asset.id));
      const stale = await queueStaleProcessing(handle.db, visualQueue);
      await settled();
      expect((await visuals(recordBase(prop))).drafts.at(-1)?.processed?.version).toBe(
        PROCESSING_VERSION,
      );
      const again = await queueStaleProcessing(handle.db, visualQueue);
      await settled();
      expect(again).toBe(stale - 1);
    });
  });

  describe('failures', () => {
    it.each([
      ['rejected', 'key_rejected'],
      ['forbidden', 'key_forbidden'],
      ['no_credit', 'no_credit'],
      ['failed', 'failed'],
      ['unreachable', 'unreachable'],
      ['aborted', 'interrupted'],
    ] as const)('stores OpenRouter %s as %s, with no image', async (status, code) => {
      const prop = await aProp(`Failing ${status}`);
      scripts = [() => ({ status })];
      const asset = await started(recordBase(prop));
      await settled();

      expect((await visuals(recordBase(prop))).drafts.at(-1)).toMatchObject({
        status: 'failed',
        errorCode: code,
        costUsd: null,
      });
      expect((await call('GET', imageUrl(asset.id), gm)).statusCode).toBe(404);
    });

    it('stores a refused request as bad_request', async () => {
      const prop = await aProp('Refused');
      scripts = [() => ({ status: 'bad_request', message: 'content policy' })];
      await started(recordBase(prop));
      await settled();
      expect((await visuals(recordBase(prop))).drafts.at(-1)?.errorCode).toBe('bad_request');
    });

    it('tries a rate-limited call once more', async () => {
      const prop = await aProp('Busy');
      scripts = [() => ({ status: 'rate_limited' })];
      await started(recordBase(prop));
      await settled();
      expect(calls).toHaveLength(2);
      const first = (await visuals(recordBase(prop))).drafts.at(-1);
      expect(first?.status).toBe('pending');
      await discard(recordBase(prop), first?.id ?? '');

      scripts = [() => ({ status: 'rate_limited' }), () => ({ status: 'rate_limited' })];
      await started(recordBase(prop));
      await settled();
      expect(calls).toHaveLength(4);
      expect((await visuals(recordBase(prop))).drafts.at(-1)?.errorCode).toBe('rate_limited');
    });

    it('stores a crash as internal and logs only its kind', async () => {
      const prop = await aProp('Crashing');
      scripts = [
        () => {
          throw new TypeError(`boom ${APPEARANCE_MARK}`);
        },
      ];
      await started(recordBase(prop));
      await settled();
      expect((await visuals(recordBase(prop))).drafts.at(-1)?.errorCode).toBe('internal');
      expect(logLines.join('')).toContain('"errorName":"TypeError"');
    });

    it('fails a queued try whose GM has no key any more as key_missing', async () => {
      // Queued while the key was there, run after the GM deleted it.
      const prop = await makeRecord({ type: 'prop', name: 'Keyless Later' });
      const [row] = await handle.db
        .insert(assets)
        .values({
          campaignId: campaign.id,
          recordId: prop.id,
          createdBy: keyless.id,
          kind: 'prop',
          prompt: 'seeded',
          model: IMAGE_MODEL,
          styleBibleVersion: 1,
          quality: 'medium',
          aspectRatio: '1:1',
        })
        .returning();
      await processVisualJob(
        {
          db: handle.db,
          credentialsKey: TEST_CREDENTIALS_KEY,
          openrouter: { generateImage },
          storage,
          references: loadReferences(BIBLE),
        },
        row?.id ?? '',
      );
      expect(calls).toHaveLength(0);
      expect((await visuals(recordBase(prop))).drafts.at(-1)).toMatchObject({
        status: 'failed',
        errorCode: 'key_missing',
      });
    });

    it('makes one image for a job delivered twice', async () => {
      const prop = await aProp('Delivered Twice');
      const asset = await started(recordBase(prop));
      await settled();
      const deps = {
        db: handle.db,
        credentialsKey: TEST_CREDENTIALS_KEY,
        openrouter: { generateImage },
        storage,
        references: loadReferences(BIBLE),
      };
      await processVisualJob(deps, asset.id);
      expect(calls).toHaveLength(1);
    });
  });

  describe('guardrails', () => {
    it('refuses a GM with no OpenRouter key, saving nothing', async () => {
      const own = await newCampaign('Keyless Coast', keyless);
      const prop = await makeRecord({ type: 'prop', name: 'Unpaid Bell' }, own, keyless);
      const response = await generate(recordBase(prop, own), {}, keyless);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ message: NO_OPENROUTER_KEY });
      expect(response.json<{ message: string }>().message).toContain('Settings');
      const rows = await handle.db.select().from(assets).where(eq(assets.campaignId, own.id));
      expect(rows).toEqual([]);
    });

    it('allows one try in flight per record or PC', async () => {
      const prop = await aProp('Twice Clicked');
      const { release } = hold();
      await started(recordBase(prop));
      const again = await generate(recordBase(prop), {});
      expect(again.statusCode).toBe(409);
      expect(again.json<{ message: string }>().message).toMatch(/already being made/);
      release();
      await settled();
      const waiting = await generate(recordBase(prop), {});
      expect(waiting.statusCode).toBe(409);
      expect(waiting.json<{ message: string }>().message).toBe(
        'Use or discard the new image first.',
      );
    });

    it(`allows ${String(VISUAL_LIMITS.generatingAtOnce)} tries in flight per GM`, async () => {
      const { release } = hold();
      for (let i = 0; i < VISUAL_LIMITS.generatingAtOnce; i += 1) {
        await started(recordBase(await aProp(`Busy ${String(i)}`)));
      }
      const extra = await generate(recordBase(await aProp('One Too Many')), {});
      expect(extra.statusCode).toBe(409);
      expect(extra.json<{ message: string }>().message).toMatch(/Wait for one to finish/);
      release();
      await settled();
    });

    it(`allows ${String(VISUAL_LIMITS.jobsPerHour)} tries an hour per GM`, async () => {
      const prop = await aProp('Hourly');
      await handle.db.insert(assets).values(
        Array.from({ length: VISUAL_LIMITS.jobsPerHour }, () => ({
          campaignId: campaign.id,
          createdBy: gm.id,
          kind: 'prop' as const,
          status: 'failed' as const,
          errorCode: 'failed' as const,
          prompt: 'seeded',
          model: IMAGE_MODEL,
          styleBibleVersion: 1,
          quality: 'medium' as const,
          aspectRatio: '1:1' as const,
        })),
      );
      const response = await generate(recordBase(prop), {});
      expect(response.statusCode).toBe(429);
      expect(calls).toHaveLength(0);
    });

    it('refuses to start or choose on an archived campaign, but still lists and serves', async () => {
      const shelf = await newCampaign('Shelved Coast');
      const prop = await makeRecord({ type: 'prop', name: 'Shelved Bell' }, shelf);
      const asset = await started(recordBase(prop, shelf));
      await settled();
      expect((await call('POST', `/api/campaigns/${shelf.id}/archive`, gm)).statusCode).toBe(200);

      const archived = { statusCode: 409, message: 'Campaign is archived' };
      expect((await generate(recordBase(prop, shelf), {})).json()).toMatchObject(archived);
      expect(
        (await call('PUT', `${recordBase(prop, shelf)}/visual`, gm, { assetId: asset.id })).json(),
      ).toMatchObject(archived);
      expect((await revise(recordBase(prop, shelf), asset.id, 'bigger')).json()).toMatchObject(
        archived,
      );
      expect(
        (await call('DELETE', `${recordBase(prop, shelf)}/visuals/${asset.id}`, gm)).json(),
      ).toMatchObject(archived);
      expect((await call('GET', `${recordBase(prop, shelf)}/visuals`, gm)).statusCode).toBe(200);
      expect((await call('GET', imageUrl(asset.id, shelf), gm)).statusCode).toBe(200);
    });

    it('keeps players out, even of their own PC', async () => {
      const table = await newCampaign('Shared Coast');
      await handle.db
        .insert(campaignMembers)
        .values({ campaignId: table.id, userId: player.id, role: 'player' });
      const pc = await makePc('Player PC', table);
      const assign = await call(
        'PUT',
        `/api/campaigns/${table.id}/members/${player.id}/character`,
        gm,
        {
          characterId: pc.id,
        },
      );
      expect(assign.statusCode, assign.body).toBe(204);
      const asset = await started(pcBase(pc, table), { kind: 'character' });
      await settled();

      expect((await call('GET', `${pcBase(pc, table)}/visuals`, player)).statusCode).toBe(403);
      expect((await generate(pcBase(pc, table), { kind: 'character' }, player)).statusCode).toBe(
        403,
      );
      expect((await revise(pcBase(pc, table), asset.id, 'taller', player)).statusCode).toBe(403);
      // An image is a player's to load only while the live stage shows it (F3.3,
      // `play-sessions.int.test.ts`); otherwise it is answered as if it didn't exist.
      expect((await call('GET', imageUrl(asset.id, table), player)).statusCode).toBe(404);
      // The player's own sheet doesn't carry the visual (yet).
      const own = await call('GET', pcBase(pc, table), player);
      expect(own.statusCode).toBe(200);
      expect(own.json()).not.toHaveProperty('visualAssetId');
    });
  });

  describe('review (F2.5)', () => {
    /** A draft for `base` with a real, processable image, finished. */
    async function aDraft(base: string): Promise<AssetSummary> {
      const png = await keyedPng();
      scripts = [() => ({ status: 'ok', image: png, mediaType: 'image/png', costUsd: 0.07 })];
      const asset = await started(base);
      await settled();
      return asset;
    }

    /** The asset's row, and whether each of its files is still in storage. */
    async function filesOf(assetId: string) {
      const row = await rowOf(assetId);
      return { row, original: row?.originalPath, processed: row?.processedPath };
    }

    async function expectDiscarded(assetId: string, keys: (string | null | undefined)[]) {
      expect(await rowOf(assetId)).toMatchObject({
        status: 'rejected',
        errorCode: null,
        originalPath: null,
        processedPath: null,
        processingVersion: null,
      });
      for (const key of keys) {
        if (key !== null && key !== undefined) expect(await storage.read(key)).toBeNull();
      }
      expect((await call('GET', imageUrl(assetId), gm)).statusCode).toBe(404);
      expect((await call('GET', `${imageUrl(assetId)}?v=original`, gm)).statusCode).toBe(404);
    }

    it("Use this makes a draft the record's visual, shown as the image in use", async () => {
      const prop = await aProp('Chosen Bell');
      const asset = await aDraft(recordBase(prop));

      const response = await use(recordBase(prop), asset.id);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<VisualsResponse>();
      expect(body.visualAssetId).toBe(asset.id);
      expect(body.inUse).toMatchObject({ id: asset.id, status: 'approved' });
      expect(body.drafts).toEqual([]);
      expect((await call('GET', recordBase(prop), gm)).json<CampaignRecord>().visualAssetId).toBe(
        asset.id,
      );
      // Using it again changes nothing.
      expect((await use(recordBase(prop), asset.id)).statusCode).toBe(200);
    });

    it("sets a PC's visual", async () => {
      const pc = await makePc('Chosen PC');
      const asset = await started(pcBase(pc));
      await settled();
      const response = await use(pcBase(pc), asset.id);
      expect(response.statusCode, response.body).toBe(200);
      const sheet = await call('GET', pcBase(pc), gm);
      expect(sheet.json<CharacterSheet>().visualAssetId).toBe(asset.id);
    });

    it('shows the image in use first, beside a newer draft', async () => {
      const prop = await aProp('Two Bells');
      const current = await aDraft(recordBase(prop));
      await use(recordBase(prop), current.id);
      const draft = await aDraft(recordBase(prop));

      const body = await visuals(recordBase(prop));
      expect(body.inUse?.id).toBe(current.id);
      expect(body.drafts.map((a) => [a.id, a.status])).toEqual([[draft.id, 'pending']]);
    });

    it('Replace discards the image it replaces, files and all', async () => {
      const prop = await aProp('Replaced Bell');
      const old = await aDraft(recordBase(prop));
      await use(recordBase(prop), old.id);
      const { original, processed } = await filesOf(old.id);
      expect(original).not.toBeNull();
      expect(processed).not.toBeNull();
      const fresh = await aDraft(recordBase(prop));

      const body = (await use(recordBase(prop), fresh.id)).json<VisualsResponse>();
      expect(body.inUse?.id).toBe(fresh.id);
      expect(body.drafts).toEqual([]);
      await expectDiscarded(old.id, [original, processed]);
    });

    it('Discard and Keep current discard the draft and keep the image in use', async () => {
      const prop = await aProp('Kept Bell');
      const draft = await aDraft(recordBase(prop));
      const { original, processed } = await filesOf(draft.id);
      const body = await discard(recordBase(prop), draft.id);
      expect(body).toMatchObject({ visualAssetId: null, inUse: null, drafts: [] });
      await expectDiscarded(draft.id, [original, processed]);

      const current = await aDraft(recordBase(prop));
      await use(recordBase(prop), current.id);
      const newer = await aDraft(recordBase(prop));
      const kept = await discard(recordBase(prop), newer.id);
      expect(kept.inUse?.id).toBe(current.id);
      expect(kept.drafts).toEqual([]);
      // Discarding again changes nothing.
      expect((await discard(recordBase(prop), newer.id)).inUse?.id).toBe(current.id);
    });

    it('never discards the image in use', async () => {
      const prop = await aProp('Clung Bell');
      const asset = await aDraft(recordBase(prop));
      await use(recordBase(prop), asset.id);
      const refused = await call('DELETE', `${recordBase(prop)}/visuals/${asset.id}`, gm);
      expect(refused.statusCode).toBe(409);
      expect(refused.json<{ message: string }>().message).toMatch(/image in use/);
      expect((await rowOf(asset.id))?.status).toBe('approved');
    });

    it('refuses a fresh try while a draft waits for review', async () => {
      const prop = await aProp('Waiting Bell');
      await aDraft(recordBase(prop));
      const response = await generate(recordBase(prop), {});
      expect(response.statusCode).toBe(409);
      expect(response.json<{ message: string }>().message).toBe(
        'Use or discard the new image first.',
      );
    });

    it("Regenerate with notes sends only the draft's untouched original, with the notes", async () => {
      const prop = await aProp('Revised Bell');
      const base = await aDraft(recordBase(prop));
      const { row } = await filesOf(base.id);
      const original = await storage.read(row?.originalPath ?? '');

      const response = await revise(recordBase(prop), base.id, `  bigger clapper ${NOTES_MARK} `);
      expect(response.statusCode, response.body).toBe(202);
      const revision = response.json<AssetSummary>();
      expect(revision).toMatchObject({
        kind: 'prop',
        status: 'generating',
        revisedFromId: base.id,
        revisionNotes: `bigger clapper ${NOTES_MARK}`,
      });
      await settled();

      const input = calls.at(-1);
      expect(input?.references).toHaveLength(1);
      expect(input?.references[0]?.data).toEqual(original);
      expect(input?.references[0]?.mediaType).toBe('image/png');
      expect(input?.prompt.startsWith(BIBLE.base)).toBe(true);
      expect(input?.prompt).toContain(`Appearance: A barnacled bell on a post ${APPEARANCE_MARK}`);
      expect(input?.prompt).toContain('reference image');
      expect(input?.prompt.endsWith(`bigger clapper ${NOTES_MARK}`)).toBe(true);
      const [stored] = await handle.db
        .select({ prompt: assets.prompt })
        .from(assets)
        .where(eq(assets.id, revision.id));
      expect(stored?.prompt).toBe(input?.prompt);

      // Both versions wait side by side for Keep new or Go back.
      const body = await visuals(recordBase(prop));
      expect(body.drafts.map((a) => [a.id, a.status, a.revisedFromId])).toEqual([
        [base.id, 'pending', null],
        [revision.id, 'pending', base.id],
      ]);
    });

    it('Keep new and Go back settle a comparison; nothing else may happen until then', async () => {
      const prop = await aProp('Compared Bell');
      const base = await aDraft(recordBase(prop));
      const first = (await revise(recordBase(prop), base.id, 'add a rope')).json<AssetSummary>();
      await settled();

      const compareFirst = 'Keep the new version or go back to the old one first.';
      for (const response of [
        await use(recordBase(prop), first.id),
        await use(recordBase(prop), base.id),
        await revise(recordBase(prop), base.id, 'again'),
        await revise(recordBase(prop), first.id, 'again'),
      ]) {
        expect(response.statusCode).toBe(409);
        expect(response.json<{ message: string }>().message).toBe(compareFirst);
      }
      expect((await generate(recordBase(prop), {})).statusCode).toBe(409);

      // Keep new: the old version goes, and the new one is the draft.
      const kept = await discard(recordBase(prop), base.id);
      expect(kept.drafts.map((a) => a.id)).toEqual([first.id]);

      // Revise again, then Go back: the newest goes.
      const second = (await revise(recordBase(prop), first.id, 'brass')).json<AssetSummary>();
      await settled();
      const back = await discard(recordBase(prop), second.id);
      expect(back.drafts.map((a) => a.id)).toEqual([first.id]);
      expect((await use(recordBase(prop), first.id)).json<VisualsResponse>().inUse?.id).toBe(
        first.id,
      );
    });

    it('regenerates the image in use, then Replace swaps it', async () => {
      const prop = await aProp('Retouched Bell');
      const current = await aDraft(recordBase(prop));
      await use(recordBase(prop), current.id);
      const { row } = await filesOf(current.id);
      const original = await storage.read(row?.originalPath ?? '');

      const revision = (await revise(recordBase(prop), current.id, 'shinier')).json<AssetSummary>();
      await settled();
      expect(calls.at(-1)?.references.map((r) => r.data)).toEqual([original]);
      const body = await visuals(recordBase(prop));
      expect(body.inUse?.id).toBe(current.id);
      expect(body.drafts.map((a) => a.id)).toEqual([revision.id]);
      // With a draft waiting, the image in use can't be changed again.
      expect((await revise(recordBase(prop), current.id, 'again')).statusCode).toBe(409);

      const replaced = (await use(recordBase(prop), revision.id)).json<VisualsResponse>();
      expect(replaced.inUse?.id).toBe(revision.id);
      await expectDiscarded(current.id, [row?.originalPath, row?.processedPath]);
    });

    it('refuses notes that are empty or too long, and images that are not this one', async () => {
      const prop = await aProp('Picky Bell');
      const other = await aProp('Other Bell');
      const mine = await aDraft(recordBase(prop));
      const theirs = await aDraft(recordBase(other));

      expect((await revise(recordBase(prop), mine.id, '   ')).statusCode).toBe(400);
      expect(
        (await revise(recordBase(prop), mine.id, 'x'.repeat(VISUAL_LIMITS.notesMax + 1)))
          .statusCode,
      ).toBe(400);
      expect((await revise(recordBase(prop), theirs.id, 'mine now')).statusCode).toBe(404);
      expect((await use(recordBase(prop), theirs.id)).statusCode).toBe(404);
      expect(
        (await call('DELETE', `${recordBase(prop)}/visuals/${theirs.id}`, gm)).statusCode,
      ).toBe(404);
      expect((await rowOf(theirs.id))?.status).toBe('pending');

      await discard(recordBase(prop), mine.id);
      expect((await revise(recordBase(prop), mine.id, 'come back')).statusCode).toBe(404);
      expect((await use(recordBase(prop), mine.id)).statusCode).toBe(404);
      expect(calls).toHaveLength(2);
    });

    it('refuses a revision when the GM has no key', async () => {
      const own = await newCampaign('Keyless Review', keyless);
      const prop = await makeRecord({ type: 'prop', name: 'Unpaid Revision' }, own, keyless);
      const [row] = await handle.db
        .insert(assets)
        .values({
          campaignId: own.id,
          recordId: prop.id,
          createdBy: keyless.id,
          kind: 'prop',
          status: 'pending',
          prompt: 'seeded',
          model: IMAGE_MODEL,
          styleBibleVersion: 1,
          quality: 'medium',
          aspectRatio: '1:1',
          originalPath: `campaigns/${own.id}/seeded.png`,
        })
        .returning();
      const response = await revise(recordBase(prop, own), row?.id ?? '', 'redder', keyless);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ message: NO_OPENROUTER_KEY });
    });

    it('refuses to use or discard while an image is being made', async () => {
      const prop = await aProp('Busy Review');
      const base = await aDraft(recordBase(prop));
      const { release } = hold();
      await revise(recordBase(prop), base.id, 'wait for me');
      for (const response of [
        await use(recordBase(prop), base.id),
        await call('DELETE', `${recordBase(prop)}/visuals/${base.id}`, gm),
      ]) {
        expect(response.statusCode).toBe(409);
        expect(response.json<{ message: string }>().message).toMatch(/already being made/);
      }
      release();
      await settled();
    });

    it('fails a revision whose image has lost its file, and lets the GM dismiss it', async () => {
      const prop = await aProp('Lost Bell');
      const base = await aDraft(recordBase(prop));
      const { original } = await filesOf(base.id);
      await storage.remove(original ?? '');

      const revision = (await revise(recordBase(prop), base.id, 'anything')).json<AssetSummary>();
      await settled();
      const body = await visuals(recordBase(prop));
      expect(body.drafts.map((a) => [a.id, a.status, a.errorCode])).toEqual([
        [base.id, 'pending', null],
        [revision.id, 'failed', 'source_missing'],
      ]);
      expect(calls).toHaveLength(1);

      const dismissed = await discard(recordBase(prop), revision.id);
      expect(dismissed.drafts.map((a) => a.id)).toEqual([base.id]);
      expect(await rowOf(revision.id)).toMatchObject({ status: 'rejected', errorCode: null });
    });

    it('dismisses a failed try when the next one starts', async () => {
      const prop = await aProp('Retried Bell');
      scripts = [() => ({ status: 'failed' })];
      const failed = await started(recordBase(prop));
      await settled();
      expect((await use(recordBase(prop), failed.id)).statusCode).toBe(409);

      const next = await started(recordBase(prop));
      await settled();
      expect((await visuals(recordBase(prop))).drafts.map((a) => a.id)).toEqual([next.id]);
      expect((await rowOf(failed.id))?.status).toBe('rejected');
    });

    it('keeps the image in use when the record is deleted, and discards its draft', async () => {
      const prop = await aProp('Doomed Bell');
      const asset = await aDraft(recordBase(prop));
      await use(recordBase(prop), asset.id);
      const draft = await aDraft(recordBase(prop));
      const { original, processed } = await filesOf(draft.id);

      expect((await call('DELETE', recordBase(prop), gm)).statusCode).toBe(204);
      expect(await rowOf(asset.id)).toMatchObject({ recordId: null, status: 'approved' });
      expect((await call('GET', imageUrl(asset.id), gm)).statusCode).toBe(200);

      // The startup sweep discards the orphaned draft and deletes its files.
      expect(await purgeDiscarded(handle.db, storage)).toBeGreaterThanOrEqual(1);
      await expectDiscarded(draft.id, [original, processed]);
      expect((await rowOf(asset.id))?.status).toBe('approved');
    });

    it('deletes at startup the files a discard left behind', async () => {
      const prop = await aProp('Half Discarded');
      const draft = await aDraft(recordBase(prop));
      const { original, processed } = await filesOf(draft.id);
      // As if the server stopped between marking it discarded and deleting its files.
      await handle.db.update(assets).set({ status: 'rejected' }).where(eq(assets.id, draft.id));
      expect(await storage.read(original ?? '')).not.toBeNull();

      expect(await purgeDiscarded(handle.db, storage)).toBeGreaterThanOrEqual(1);
      await expectDiscarded(draft.id, [original, processed]);
      expect(await purgeDiscarded(handle.db, storage)).toBe(0);
    });

    it('leaves no stage version behind for a try discarded while it was processed', async () => {
      const prop = await aProp('Raced Bell');
      const draft = await aDraft(recordBase(prop));
      await handle.db
        .update(assets)
        .set({ processingVersion: PROCESSING_VERSION - 1 })
        .where(eq(assets.id, draft.id));
      const { processed } = await filesOf(draft.id);
      await storage.remove(processed ?? '');

      await processStoredVisual(
        {
          db: handle.db,
          storage,
          processImage: async (input, kind) => {
            await discard(recordBase(prop), draft.id);
            return processImage(input, kind);
          },
        },
        draft.id,
      );
      expect(await storage.read(processed ?? '')).toBeNull();
      expect((await rowOf(draft.id))?.processedPath).toBeNull();
    });
  });

  describe('uploads (F2.6)', () => {
    async function upload(
      base: string,
      body: Buffer | string,
      options: { query?: string; type?: string; who?: Person } = {},
    ) {
      const response = await app.inject({
        method: 'POST',
        url: `${base}/visuals/upload${options.query === undefined ? '' : `?${options.query}`}`,
        headers: {
          ...SAME_ORIGIN,
          cookie: (options.who ?? gm).cookie,
          'content-type': options.type ?? 'image/png',
        },
        payload: body,
      });
      responseBodies.push(response.body);
      return response;
    }

    async function uploaded(
      base: string,
      body: Buffer,
      options: { query?: string; type?: string } = {},
    ): Promise<AssetSummary> {
      const response = await upload(base, body, options);
      expect(response.statusCode, response.body).toBe(201);
      const draft = response.json<VisualsResponse>().drafts.at(-1);
      if (draft === undefined) throw new Error('the upload left no draft');
      return draft;
    }

    it('stores an upload as a draft with a cut-out stage version, without the model', async () => {
      const prop = await aProp('Uploaded Bell');
      const draft = await uploaded(recordBase(prop), await transparentPng());

      expect(calls).toHaveLength(0);
      expect(draft).toMatchObject({
        kind: 'prop',
        status: 'pending',
        source: 'uploaded',
        finished: false,
        mediaType: 'image/png',
        costUsd: null,
        revisedFromId: null,
      });
      // The 100×150 box is cut out of its transparency and bordered at the stage size.
      expect(draft.processed?.height).toBe(CUTOUT_MAX_SIDE);
      expect(draft.processed?.version).toBe(PROCESSING_VERSION);

      const row = await rowOf(draft.id);
      expect(row).toMatchObject({
        source: 'uploaded',
        prompt: null,
        model: null,
        styleBibleVersion: null,
        createdBy: gm.id,
        originalPath: `campaigns/${campaign.id}/${draft.id}.png`,
        processedPath: `campaigns/${campaign.id}/processed/${draft.id}.webp`,
      });
      const original = await call('GET', `${imageUrl(draft.id)}?v=original`, gm);
      expect(original.headers['content-type']).toBe('image/png');
      expect((await sharp(original.rawPayload).metadata()).width).toBe(200);
      const stage = await call('GET', imageUrl(draft.id), gm);
      expect(stage.headers['content-type']).toBe('image/webp');

      // Use this, as for a generated image.
      expect((await use(recordBase(prop), draft.id)).statusCode).toBe(200);
      expect((await visuals(recordBase(prop))).visualAssetId).toBe(draft.id);
    });

    it('stores a finished stage image as it is, with no second border', async () => {
      const stage = await processImage(await keyedPng(), 'prop');
      const prop = await aProp('Copied Bell');
      const draft = await uploaded(recordBase(prop), stage.data, {
        query: 'finished=true',
        type: 'image/webp',
      });
      expect(draft.finished).toBe(true);
      expect(draft.processed).toMatchObject({ width: stage.width, height: stage.height });

      // Remade at startup in the same mode: still no second border.
      await handle.db
        .update(assets)
        .set({
          processedPath: null,
          processedWidth: null,
          processedHeight: null,
          processingVersion: null,
        })
        .where(eq(assets.id, draft.id));
      await processStoredVisual({ db: handle.db, storage }, draft.id);
      expect((await visuals(recordBase(prop))).drafts.at(-1)?.processed).toMatchObject({
        width: stage.width,
        height: stage.height,
      });

      // Its original already has a border, so it can't go back to the model.
      const revision = await revise(recordBase(prop), draft.id, 'bigger');
      expect(revision.statusCode).toBe(409);
      expect(revision.json()).toMatchObject({
        message: VISUAL_UPLOAD_MESSAGES.finishedNotRevisable,
      });
      expect(calls).toHaveLength(0);
    });

    it("processes a downloaded original exactly as the model's own image", async () => {
      const prop = await aProp('Twin Bell');
      const draft = await uploaded(recordBase(prop), await keyedPng());
      const expected = await processImage(await keyedPng(), 'prop');
      expect(draft.processed).toMatchObject({ width: expected.width, height: expected.height });

      // An ordinary upload can be changed with notes: its original goes to the model.
      const response = await revise(recordBase(prop), draft.id, 'a rope on the bell');
      expect(response.statusCode, response.body).toBe(202);
      await settled();
      expect(calls).toHaveLength(1);
      const sent = calls[0]?.references[0]?.data;
      expect(sent).toEqual(await storage.read((await rowOf(draft.id))?.originalPath ?? ''));
    });

    it('ignores finished for a backdrop, and takes a JPEG', async () => {
      const area = await makeRecord({ type: 'area', name: 'Upload Point' });
      const spot = await makeRecord({ type: 'spot', name: 'Uploaded Cove', parentId: area.id });
      const jpeg = await sharp({
        create: { width: 800, height: 600, channels: 3, background: '#336699' },
      })
        .jpeg()
        .toBuffer();
      const draft = await uploaded(recordBase(spot), jpeg, {
        query: 'finished=true',
        type: 'image/jpeg',
      });
      expect(draft).toMatchObject({ kind: 'backdrop', finished: false, mediaType: 'image/png' });
      expect(draft.processed).toMatchObject(BACKDROP_SIZE);
      expect((await rowOf(draft.id))?.originalPath).toBe(
        `campaigns/${campaign.id}/${draft.id}.png`,
      );
    });

    it('asks an NPC whether it is a humanoid or a monster, and uploads for a PC', async () => {
      const npc = await makeRecord({ type: 'npc', name: 'Uploaded Goblin' });
      const unasked = await upload(recordBase(npc), await transparentPng());
      expect(unasked.statusCode).toBe(400);
      expect(
        (await uploaded(recordBase(npc), await transparentPng(), { query: 'kind=monster' })).kind,
      ).toBe('monster');

      const pc = await makePc('Uploaded Hero');
      expect((await uploaded(pcBase(pc), await transparentPng())).kind).toBe('character');
      const wrong = await upload(recordBase(await aProp('Wrong Kind')), await transparentPng(), {
        query: 'kind=backdrop',
      });
      expect(wrong.statusCode).toBe(400);
    });

    it('refuses files that are not usable images, saving nothing', async () => {
      const prop = await aProp('Refused Bell');
      const notImage = await upload(recordBase(prop), Buffer.from('plain words, not a picture'));
      expect(notImage.statusCode).toBe(400);
      expect(notImage.json()).toMatchObject({ message: VISUAL_UPLOAD_MESSAGES.notImage });

      const gif = await sharp({
        create: { width: 10, height: 10, channels: 3, background: '#000000' },
      })
        .gif()
        .toBuffer();
      expect((await upload(recordBase(prop), gif)).statusCode).toBe(400);
      expect((await upload(recordBase(prop), 'words', { type: 'text/plain' })).statusCode).toBe(
        415,
      );
      expect(
        (await upload(recordBase(prop), '{"a":1}', { type: 'application/json' })).statusCode,
      ).toBe(415);

      const tooBig = await upload(recordBase(prop), Buffer.alloc(VISUAL_UPLOAD_MAX_BYTES + 1));
      expect(tooBig.statusCode).toBe(413);
      expect(tooBig.json()).toMatchObject({ message: VISUAL_UPLOAD_MESSAGES.tooBig });
      const wayTooBig = await upload(recordBase(prop), Buffer.alloc(VISUAL_UPLOAD_MAX_BYTES * 2));
      expect(wayTooBig.statusCode).toBe(413);

      // Nothing left once the background is cleared.
      const empty = await sharp({
        create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .png()
        .toBuffer();
      const blank = await upload(recordBase(prop), empty, { query: 'finished=true' });
      expect(blank.statusCode).toBe(400);
      expect(blank.json()).toMatchObject({ message: VISUAL_UPLOAD_MESSAGES.empty });

      const rows = await handle.db.select().from(assets).where(eq(assets.recordId, prop.id));
      expect(rows).toEqual([]);
    });

    it('follows the review rules: not while a draft waits or an image is being made', async () => {
      const prop = await aProp('Busy Bell');
      const { release } = hold();
      await started(recordBase(prop));
      const whileMaking = await upload(recordBase(prop), await transparentPng());
      expect(whileMaking.statusCode).toBe(409);
      release();
      await settled();

      const waiting = await upload(recordBase(prop), await transparentPng());
      expect(waiting.statusCode).toBe(409);
      expect(waiting.json()).toMatchObject({ message: 'Use or discard the new image first.' });
      const [generated] = (await visuals(recordBase(prop))).drafts;
      await use(recordBase(prop), generated?.id ?? '');

      // Beside the image in use, an upload is a draft to Replace with or discard.
      const draft = await uploaded(recordBase(prop), await transparentPng());
      const shown = await visuals(recordBase(prop));
      expect(shown.inUse?.id).toBe(generated?.id);
      expect(shown.drafts.map((d) => d.id)).toEqual([draft.id]);
      const after = await discard(recordBase(prop), draft.id);
      expect(after.drafts).toEqual([]);
      expect(await storage.read((await rowOf(draft.id))?.originalPath ?? 'x.png')).toBeNull();
    });

    it('needs no OpenRouter key and does not count toward the hourly limit', async () => {
      const own = await newCampaign('Upload Coast', keyless);
      const prop = await makeRecord({ type: 'prop', name: 'Free Bell' }, own, keyless);
      const response = await upload(recordBase(prop, own), await transparentPng(), {
        who: keyless,
      });
      expect(response.statusCode, response.body).toBe(201);

      // Thirty uploads an hour leave room for a generated image.
      await handle.db.insert(assets).values(
        Array.from({ length: VISUAL_LIMITS.jobsPerHour }, () => ({
          campaignId: campaign.id,
          createdBy: gm.id,
          kind: 'prop' as const,
          status: 'rejected' as const,
          source: 'uploaded' as const,
        })),
      );
      expect((await generate(recordBase(await aProp('Still Allowed')), {})).statusCode).toBe(202);
      await settled();
    });

    it('keeps players out and refuses on an archived campaign', async () => {
      const table = await newCampaign('Upload Table');
      await handle.db
        .insert(campaignMembers)
        .values({ campaignId: table.id, userId: player.id, role: 'player' });
      const prop = await makeRecord({ type: 'prop', name: 'Player Bell' }, table);
      const response = await upload(recordBase(prop, table), await transparentPng(), {
        who: player,
      });
      expect(response.statusCode).toBe(403);

      expect((await call('POST', `/api/campaigns/${table.id}/archive`, gm)).statusCode).toBe(200);
      const archived = await upload(recordBase(prop, table), await transparentPng());
      expect(archived.json()).toMatchObject({ statusCode: 409, message: 'Campaign is archived' });
    });

    it("answers 404 for another campaign's record", async () => {
      const other = await newCampaign('Other Upload Coast');
      const prop = await aProp('Home Bell');
      const response = await upload(recordBase(prop, other), await transparentPng());
      expect(response.statusCode).toBe(404);
    });
  });

  describe('lost jobs', () => {
    it('shows a try stuck generating for too long as interrupted', async () => {
      const prop = await aProp('Stuck Bell');
      const { release } = hold();
      const asset = await started(recordBase(prop));
      await handle.db
        .update(assets)
        .set({ createdAt: sql`now() - interval '20 minutes'` })
        .where(eq(assets.id, asset.id));
      expect((await visuals(recordBase(prop))).drafts.at(-1)).toMatchObject({
        status: 'failed',
        errorCode: 'interrupted',
      });
      release();
      await settled();
      // The late answer doesn't bring it back.
      expect((await visuals(recordBase(prop))).drafts.at(-1)?.status).toBe('failed');
    });

    it('fails tries cut off by a restart, and leaves queued ones to run', async () => {
      const prop = await aProp('Restarted Bell');
      const [cut, queued] = await handle.db
        .insert(assets)
        .values(
          [new Date(), null].map((startedAt) => ({
            campaignId: campaign.id,
            recordId: prop.id,
            createdBy: gm.id,
            kind: 'prop' as const,
            prompt: 'seeded',
            model: IMAGE_MODEL,
            styleBibleVersion: 1,
            quality: 'medium' as const,
            aspectRatio: '1:1' as const,
            startedAt,
          })),
        )
        .returning();

      expect(await failInterruptedVisuals(handle.db)).toBeGreaterThanOrEqual(1);
      const rows = await handle.db.select().from(assets).where(eq(assets.recordId, prop.id));
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(cut?.id ?? '')).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
      expect(byId.get(queued?.id ?? '')).toMatchObject({ status: 'generating', errorCode: null });
      await handle.db.delete(assets).where(eq(assets.id, queued?.id ?? ''));
    });
  });

  // Keep these two last: they scan everything the tests above produced.
  describe('privacy (§14)', () => {
    it('never writes the prompt or the key to the logs', () => {
      const everything = logLines.join('');

      // The logger really ran at trace level for these requests.
      expect(everything).toContain('/visuals');
      expect(logLines.length).toBeGreaterThan(50);
      for (const secret of [
        APPEARANCE_MARK,
        NOTES_MARK,
        GM_KEY,
        GM_KEY.slice(9, 30),
        'Tall, salt-stained',
      ]) {
        expect(everything).not.toContain(secret);
      }

      // And anything that does try to log a prompt is redacted.
      const before = logLines.length;
      app.log.info({ prompt: APPEARANCE_MARK, asset: { prompt: APPEARANCE_MARK } }, 'probe');
      const probe = logLines.slice(before).join('');
      expect(probe).toContain('[redacted]');
      expect(probe).not.toContain(APPEARANCE_MARK);
    });

    it('never sends the key or the prompt in any response', () => {
      const everything = responseBodies.join('\n');

      expect(responseBodies.length).toBeGreaterThan(50);
      expect(everything).not.toContain(GM_KEY);
      expect(everything).not.toContain(GM_KEY.slice(9, 30));
      expect(everything).not.toMatch(/apiKey|encryptedKey|encrypted_key|"prompt"/);
    });
  });
});
