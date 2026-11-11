/**
 * Stat blocks API (F1.4a), against a real Postgres. Route-level isolation with random ids
 * is in the table in `campaigns.int.test.ts`; this file covers behaviour, linking NPCs,
 * deleting a linked block, stat block ids from another campaign, and the database rules.
 */
import {
  emptyRichText,
  type Campaign,
  type CampaignRecord,
  type StatBlock,
  type StatBlockSummary,
} from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import { FULL_STAT_BLOCK_PATCH } from '../../test/record-fixtures';
import type { DbHandle } from '../db/client';
import { campaignMembers, records, statBlocks, users } from '../db/schema';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

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

const NOT_FOUND = { error: 'Not Found', message: 'Stat block not found' };

describe('Stat blocks API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let player: Person;
  let campaign: Campaign;
  let other: Campaign;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('5101', 'Stat Blocks GM');
    player = await person('5102', 'Stat Blocks Player');
    campaign = await newCampaign('Stat Blocks Campaign');
    other = await newCampaign('Other Stat Blocks Campaign');
    await handle.db
      .insert(campaignMembers)
      .values({ campaignId: campaign.id, userId: player.id, role: 'player' });
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

  const base = (c: Campaign) => `/api/campaigns/${c.id}/stat-blocks`;
  const get = (id: string, c = campaign, who = gm) => call('GET', `${base(c)}/${id}`, who);
  const patch = (id: string, body: unknown, c = campaign) =>
    call('PATCH', `${base(c)}/${id}`, gm, body);
  const remove = (id: string, c = campaign) => call('DELETE', `${base(c)}/${id}`, gm);

  async function created(body: Record<string, unknown>, c = campaign): Promise<StatBlock> {
    const response = await call('POST', base(c), gm, body);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    return response.json<StatBlock>();
  }

  async function list(c = campaign): Promise<StatBlockSummary[]> {
    const response = await call('GET', base(c), gm);
    expect(response.statusCode).toBe(200);
    return response.json<{ statBlocks: StatBlockSummary[] }>().statBlocks;
  }

  async function npc(name: string, c = campaign): Promise<CampaignRecord> {
    const response = await call('POST', `/api/campaigns/${c.id}/records`, gm, {
      type: 'npc',
      name,
    });
    expect(response.statusCode).toBe(201);
    return response.json<CampaignRecord>();
  }

  const link = (recordId: string, statBlockId: string | null, c = campaign) =>
    call('PATCH', `/api/campaigns/${c.id}/records/${recordId}`, gm, { statBlockId });

  describe('creating and reading', () => {
    it('creates a stat block with defaults', async () => {
      const block = await created({ name: ' Gull Swarm ', tier: 1, role: 'Horde' });
      expect(block).toMatchObject({
        name: 'Gull Swarm',
        tier: 1,
        role: 'Horde',
        publicDescription: emptyRichText(),
        difficulty: 0,
        attackModifier: 0,
        standardAttack: null,
        experiences: [],
        motives: [],
        features: [],
        hpMax: 0,
        stressMax: 0,
        usedBy: [],
      });
      expect((await get(block.id)).json()).toEqual(block);
    });

    it('refuses invalid bodies with 400', async () => {
      for (const body of [{}, { name: '' }, { name: 'X', tier: 0 }, { name: 'X', hpMax: 3 }]) {
        const response = await call('POST', base(campaign), gm, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it('lists by name, case-insensitively, with how many NPCs use each', async () => {
      const shelf = await newCampaign('Listing Stat Blocks');
      const zed = await created({ name: 'zombie' }, shelf);
      await created({ name: 'Albatross' }, shelf);
      const villager = await npc('Villager', shelf);
      expect((await link(villager.id, zed.id, shelf)).statusCode).toBe(200);

      expect((await list(shelf)).map((b) => [b.name, b.usedByCount])).toEqual([
        ['Albatross', 0],
        ['zombie', 1],
      ]);
    });
  });

  describe('updating', () => {
    it('stores every key, and replaces lists whole', async () => {
      const block = await created({ name: 'Shark' });
      const response = await patch(block.id, FULL_STAT_BLOCK_PATCH);
      expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
      expect(response.json()).toMatchObject(FULL_STAT_BLOCK_PATCH);

      const next = await patch(block.id, { motives: ['Flee'], standardAttack: null });
      expect(next.json()).toMatchObject({
        motives: ['Flee'],
        standardAttack: null,
        hpMax: FULL_STAT_BLOCK_PATCH.hpMax,
      });
    });

    it('refuses invalid patches with 400', async () => {
      const block = await created({ name: 'Validated Shark' });
      for (const body of [
        {},
        { hpMax: null },
        { tier: 0 },
        { difficulty: -1 },
        { standardAttack: { ...FULL_STAT_BLOCK_PATCH.standardAttack, damageDice: 'lots' } },
        { features: [{ name: 'X', kind: 'bonus', cost: '', description: '' }] },
        { hpCurrent: 3 },
      ]) {
        const response = await patch(block.id, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it('refuses every write on an archived campaign but still reads', async () => {
      const shelf = await newCampaign('Archived Stat Blocks');
      const block = await created({ name: 'Fossil' }, shelf);
      expect((await call('POST', `/api/campaigns/${shelf.id}/archive`, gm)).statusCode).toBe(200);

      const archived = { statusCode: 409, message: 'Campaign is archived' };
      expect((await call('POST', base(shelf), gm, { name: 'X' })).json()).toMatchObject(archived);
      expect((await patch(block.id, { tier: 2 }, shelf)).json()).toMatchObject(archived);
      expect((await remove(block.id, shelf)).json()).toMatchObject(archived);
      expect((await get(block.id, shelf)).statusCode).toBe(200);
      expect(await list(shelf)).toHaveLength(1);
    });
  });

  describe('NPCs and their stat blocks', () => {
    it('links an NPC, shows it under usedBy, and unlinks it with null', async () => {
      const block = await created({ name: 'Pirate' });
      const captain = await npc('Captain Rook');
      expect(captain.statBlockId).toBeNull();

      const linked = await link(captain.id, block.id);
      expect(linked.statusCode).toBe(200);
      expect(linked.json()).toMatchObject({ statBlockId: block.id });
      expect((await get(block.id)).json()).toMatchObject({
        usedBy: [{ id: captain.id, name: 'Captain Rook' }],
      });

      const unlinked = await link(captain.id, null);
      expect(unlinked.json()).toMatchObject({ statBlockId: null });
      expect((await get(block.id)).json()).toMatchObject({ usedBy: [] });
    });

    it('links only NPCs, and only to stat blocks of the same campaign', async () => {
      const block = await created({ name: 'Linkable' });
      const foreign = await created({ name: 'Foreign Block' }, other);
      const lore = await call('POST', `/api/campaigns/${campaign.id}/records`, gm, {
        type: 'lore',
        name: 'Legend',
      });
      const legend = lore.json<CampaignRecord>();

      const notNpc = await link(legend.id, block.id);
      expect(notNpc.statusCode).toBe(400);
      expect(notNpc.json()).toMatchObject({ message: 'Only NPCs have a stat block' });

      const villager = await npc('Villager');
      for (const id of [foreign.id, '00000000-0000-4000-8000-000000000009']) {
        const response = await link(villager.id, id);
        expect(response.statusCode, id).toBe(404);
        expect(response.json()).toMatchObject(NOT_FOUND);
      }
      expect((await link(villager.id, 'not-a-uuid')).statusCode).toBe(400);
    });

    it('deleting a stat block unlinks its NPCs and keeps them', async () => {
      const block = await created({ name: 'Doomed Block' });
      const first = await npc('First Mate');
      const second = await npc('Second Mate');
      await link(first.id, block.id);
      await link(second.id, block.id);

      expect((await remove(block.id)).statusCode).toBe(204);
      expect((await get(block.id)).statusCode).toBe(404);
      for (const record of [first, second]) {
        const response = await call(
          'GET',
          `/api/campaigns/${campaign.id}/records/${record.id}`,
          gm,
        );
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ name: record.name, statBlockId: null });
      }
    });
  });

  describe('players', () => {
    it('are refused every stat block route, even with a real id', async () => {
      const block = await created({ name: 'Secret Monster' });
      for (const [method, url, body] of [
        ['GET', base(campaign), undefined],
        ['POST', base(campaign), { name: 'X' }],
        ['GET', `${base(campaign)}/${block.id}`, undefined],
        ['PATCH', `${base(campaign)}/${block.id}`, { name: 'X' }],
        ['DELETE', `${base(campaign)}/${block.id}`, undefined],
      ] as const) {
        expect((await call(method, url, player, body)).statusCode, `${method} ${url}`).toBe(403);
      }
    });
  });

  describe('isolation of stat block ids', () => {
    it("can't reach another campaign's stat block through its own campaign", async () => {
      const theirs = await created({ name: 'Their Monster' }, other);
      for (const response of [
        await get(theirs.id),
        await patch(theirs.id, { name: 'Hijacked' }),
        await remove(theirs.id),
      ]) {
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject(NOT_FOUND);
      }
      expect((await get(theirs.id, other)).json()).toMatchObject({ name: 'Their Monster' });

      for (const id of ['not-a-uuid', '1', '00000000-0000-4000-8000-000000000009']) {
        expect((await get(id)).statusCode, id).toBe(404);
        expect((await patch(id, { name: 'X' })).statusCode, id).toBe(404);
        expect((await remove(id)).statusCode, id).toBe(404);
      }
    });
  });

  describe('database rules', () => {
    const rawRecord = (values: Partial<typeof records.$inferInsert>) =>
      failureOf(
        handle.db.insert(records).values({
          campaignId: campaign.id,
          type: 'npc',
          name: 'Raw',
          publicDescription: emptyRichText(),
          gmNotes: emptyRichText(),
          ...values,
        }),
      );

    it('lets only NPCs link a stat block (check constraint)', async () => {
      const block = await created({ name: 'Raw Block' });
      expect(pgCode(await rawRecord({ type: 'item', statBlockId: block.id }))).toBe('23514');
      expect(await rawRecord({ statBlockId: block.id })).toBeNull();
    });

    it("keeps an NPC's stat block in the same campaign (composite FK)", async () => {
      const foreign = await created({ name: 'Raw Foreign Block' }, other);
      expect(pgCode(await rawRecord({ statBlockId: foreign.id }))).toBe('23503');
    });

    it('keeps a stat block while an NPC links it (FK backstop)', async () => {
      const block = await created({ name: 'Raw Anchored Block' });
      expect(await rawRecord({ name: 'Anchor', statBlockId: block.id })).toBeNull();
      const error = await failureOf(
        handle.db.delete(statBlocks).where(eq(statBlocks.id, block.id)),
      );
      expect(pgCode(error)).toBe('23503');
    });

    it.each([
      ['tier 0', { tier: 0 }],
      ['a negative number', { hpMax: -1 }],
      ['a long role', { role: 'x'.repeat(81) }],
      ['an empty name', { name: '' }],
    ])('refuses %s (check constraint)', async (_, values) => {
      const error = await failureOf(
        handle.db.insert(statBlocks).values({ campaignId: campaign.id, name: 'Raw', ...values }),
      );
      expect(pgCode(error)).toBe('23514');
    });

    it('allows a negative attack modifier', async () => {
      const error = await failureOf(
        handle.db
          .insert(statBlocks)
          .values({ campaignId: campaign.id, name: 'Clumsy', attackModifier: -3 }),
      );
      expect(error).toBeNull();
    });
  });
});
