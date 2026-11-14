/**
 * Generate visual (F2.3, governance §11, D-42), against a real Postgres with OpenRouter faked
 * and the queue run inline: the prompt and anchors per record type and kind, the image file
 * and its route, "Use this one", every failure, the cost guardrails, archived campaigns, and
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
import { IMAGE_MODEL, VISUAL_LIMITS } from '@stagehand/shared';
import { anchorsFor, loadStyleBible } from '@stagehand/style-bible';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  discordUser,
  SAME_ORIGIN,
  signIn,
  TEST_CREDENTIALS_KEY,
} from '../../test/auth-helpers';
import { FULL_FIELDS, richText } from '../../test/record-fixtures';
import { failInterruptedVisuals } from '../campaigns/visuals';
import { saveProviderKey } from '../credentials/store';
import type { DbHandle } from '../db/client';
import { assets, campaignMembers, users } from '../db/schema';
import type { ImageCallInput, ImageCallResult } from '../providers/openrouter';
import { processVisualJob } from '../visuals/job';
import { loadReferences } from '../visuals/references';
import type { AssetStorage } from '../visuals/storage';

import { NO_OPENROUTER_KEY } from './visuals';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Person {
  cookie: string;
  id: string;
}

const GM_KEY = 'sk-or-v1-VisualGmVisualGmVisualGm0123456789abcdefvis1';
/** Marks a record's private appearance, to look for in logs. */
const APPEARANCE_MARK = 'PERIWINKLEGANTRY';
const IMAGE = Buffer.from('not really a png, but bytes all the same');

type Script = (input: ImageCallInput) => ImageCallResult | Promise<ImageCallResult>;

const BIBLE = loadStyleBible();
const anchorBytes = (kind: Parameters<typeof anchorsFor>[1]) =>
  anchorsFor(BIBLE, kind).map((anchor) => readFileSync(anchor.path));

describe('Visuals API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let settled: () => Promise<void>;
  let storage: AssetStorage;
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
      expect((await visuals(recordBase(prop))).assets[0]?.status).toBe('generating');

      release();
      await settled();
      const after = await visuals(recordBase(prop));
      expect(after.visualAssetId).toBeNull();
      expect(after.assets).toEqual([
        expect.objectContaining({ id: asset.id, status: 'pending', costUsd: 0.05 }),
      ]);
      expect(after.assets[0]?.finishedAt).not.toBeNull();
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

      const response = await call('GET', imageUrl(asset.id), gm);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(response.rawPayload).toEqual(IMAGE);

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

      expect((await started(recordBase(npc), { kind: 'monster' })).kind).toBe('monster');
      await settled();
      expect(calls[0]).toMatchObject({ aspectRatio: '2:3' });
      expect(calls[0]?.prompt).toContain('Appearance: Tall, salt-stained coat');
      expect(calls[0]?.references.map((r) => r.data)).toEqual(anchorBytes('monster'));

      expect((await started(recordBase(npc), { kind: 'character' })).kind).toBe('character');
      await settled();
      expect(calls[1]?.references.map((r) => r.data)).toEqual(anchorBytes('character'));
      expect((await visuals(recordBase(npc))).assets.map((a) => a.kind)).toEqual([
        'character',
        'monster',
      ]);
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

      expect((await visuals(recordBase(prop))).assets[0]).toMatchObject({
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
      expect((await visuals(recordBase(prop))).assets[0]?.errorCode).toBe('bad_request');
    });

    it('tries a rate-limited call once more', async () => {
      const prop = await aProp('Busy');
      scripts = [() => ({ status: 'rate_limited' })];
      await started(recordBase(prop));
      await settled();
      expect(calls).toHaveLength(2);
      expect((await visuals(recordBase(prop))).assets[0]?.status).toBe('pending');

      scripts = [() => ({ status: 'rate_limited' }), () => ({ status: 'rate_limited' })];
      await started(recordBase(prop));
      await settled();
      expect(calls).toHaveLength(4);
      expect((await visuals(recordBase(prop))).assets[0]?.errorCode).toBe('rate_limited');
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
      expect((await visuals(recordBase(prop))).assets[0]?.errorCode).toBe('internal');
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
      expect((await visuals(recordBase(prop))).assets[0]).toMatchObject({
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
      await started(recordBase(prop));
      await settled();
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
      expect((await call('GET', imageUrl(asset.id, table), player)).statusCode).toBe(403);
      // The player's own sheet doesn't carry the visual (yet).
      const own = await call('GET', pcBase(pc, table), player);
      expect(own.statusCode).toBe(200);
      expect(own.json()).not.toHaveProperty('visualAssetId');
    });
  });

  describe('Use this one', () => {
    it("makes a finished try the record's visual and marks it approved", async () => {
      const prop = await aProp('Chosen Bell');
      const first = await started(recordBase(prop));
      await settled();
      const second = await started(recordBase(prop));
      await settled();

      const response = await call('PUT', `${recordBase(prop)}/visual`, gm, { assetId: first.id });
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<VisualsResponse>();
      expect(body.visualAssetId).toBe(first.id);
      expect(body.assets.map((a) => [a.id, a.status])).toEqual([
        [second.id, 'pending'],
        [first.id, 'approved'],
      ]);

      const record = await call('GET', recordBase(prop), gm);
      expect(record.json<CampaignRecord>().visualAssetId).toBe(first.id);

      await call('PUT', `${recordBase(prop)}/visual`, gm, { assetId: second.id });
      expect((await visuals(recordBase(prop))).visualAssetId).toBe(second.id);
    });

    it("sets a PC's visual", async () => {
      const pc = await makePc('Chosen PC');
      const asset = await started(pcBase(pc));
      await settled();
      const response = await call('PUT', `${pcBase(pc)}/visual`, gm, { assetId: asset.id });
      expect(response.statusCode, response.body).toBe(200);
      const sheet = await call('GET', pcBase(pc), gm);
      expect(sheet.json<CharacterSheet>().visualAssetId).toBe(asset.id);
    });

    it("refuses another record's try, and a try with no image", async () => {
      const prop = await aProp('Picky Bell');
      const other = await aProp('Other Bell');
      const theirs = await started(recordBase(other));
      await settled();
      const notFound = await call('PUT', `${recordBase(prop)}/visual`, gm, { assetId: theirs.id });
      expect(notFound.statusCode).toBe(404);

      scripts = [() => ({ status: 'failed' })];
      const failed = await started(recordBase(prop));
      await settled();
      const refused = await call('PUT', `${recordBase(prop)}/visual`, gm, { assetId: failed.id });
      expect(refused.statusCode).toBe(409);
      expect((await visuals(recordBase(prop))).visualAssetId).toBeNull();
    });

    it('keeps the asset and its image when the record is deleted', async () => {
      const prop = await aProp('Doomed Bell');
      const asset = await started(recordBase(prop));
      await settled();
      await call('PUT', `${recordBase(prop)}/visual`, gm, { assetId: asset.id });

      expect((await call('DELETE', recordBase(prop), gm)).statusCode).toBe(204);
      const [row] = await handle.db.select().from(assets).where(eq(assets.id, asset.id));
      expect(row).toMatchObject({ recordId: null, status: 'approved' });
      expect((await call('GET', imageUrl(asset.id), gm)).statusCode).toBe(200);
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
      expect((await visuals(recordBase(prop))).assets[0]).toMatchObject({
        status: 'failed',
        errorCode: 'interrupted',
      });
      release();
      await settled();
      // The late answer doesn't bring it back.
      expect((await visuals(recordBase(prop))).assets[0]?.status).toBe('failed');
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
      for (const secret of [APPEARANCE_MARK, GM_KEY, GM_KEY.slice(9, 30), 'Tall, salt-stained']) {
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
