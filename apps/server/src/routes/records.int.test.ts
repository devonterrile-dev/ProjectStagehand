/**
 * Records API (F1.3a), against a real Postgres. Route-level isolation with random ids
 * (outsiders get 404, players get 403) is in the table in `campaigns.int.test.ts`; this file
 * covers behaviour, every type's fields, spots and areas, players on real records, and
 * record ids from another campaign.
 */
import {
  emptyRichText,
  RECORD_TYPES,
  type Campaign,
  type CampaignRecord,
  type RecordSummary,
  type RecordType,
} from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import { FOREIGN_FIELD, FULL_FIELDS, richText } from '../../test/record-fixtures';
import type { DbHandle } from '../db/client';
import { campaignMembers, records, users } from '../db/schema';

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

const NOT_FOUND = { error: 'Not Found', message: 'Record not found' };

describe('Records API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let player: Person;
  /** The campaign most tests use; the player is a member. */
  let campaign: Campaign;
  /** The GM's other campaign, for isolation checks. */
  let other: Campaign;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('4001', 'Records GM');
    player = await person('4002', 'Records Player');
    campaign = await newCampaign('Records Campaign');
    other = await newCampaign('Other Records Campaign');
    await handle.db
      .insert(campaignMembers)
      .values({ campaignId: campaign.id, userId: player.id, role: 'player' });
  });

  afterAll(async () => {
    await app.close();
  });

  function call(
    method: Method,
    url: string,
    who: Person | null,
    payload?: Record<string, unknown>,
    headers: Record<string, string> = SAME_ORIGIN,
  ) {
    return app.inject({
      method,
      url,
      headers: { ...headers, cookie: who?.cookie ?? '' },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function newCampaign(name: string): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', gm, { name });
    expect(response.statusCode).toBe(201);
    return response.json<Campaign>();
  }

  const base = (c: Campaign) => `/api/campaigns/${c.id}/records`;

  function create(body: Record<string, unknown>, c = campaign, who = gm) {
    return call('POST', base(c), who, body);
  }

  async function created(body: Record<string, unknown>, c = campaign): Promise<CampaignRecord> {
    const response = await create(body, c);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    return response.json<CampaignRecord>();
  }

  const area = (name = 'Saltmarsh', c = campaign) => created({ type: 'area', name }, c);

  const get = (id: string, c = campaign, who = gm) => call('GET', `${base(c)}/${id}`, who);

  async function list(query = '', c = campaign): Promise<RecordSummary[]> {
    const response = await call('GET', `${base(c)}${query}`, gm);
    expect(response.statusCode).toBe(200);
    return response.json<{ records: RecordSummary[] }>().records;
  }

  const patch = (id: string, body: Record<string, unknown>, c = campaign, who = gm) =>
    call('PATCH', `${base(c)}/${id}`, who, body);

  const remove = (id: string, c = campaign, who = gm) => call('DELETE', `${base(c)}/${id}`, who);

  /** A valid create body for the type, with an Area for Spots. */
  async function bodyFor(type: RecordType, name: string): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { type, name, fields: FULL_FIELDS[type] };
    if (type === 'spot') body['parentId'] = (await area()).id;
    return body;
  }

  describe('every type', () => {
    it.each(RECORD_TYPES)('creates a full %s and reads it back', async (type) => {
      const body = await bodyFor(type, `  A ${type}  `);
      const record = await created(body);

      expect(record).toMatchObject({
        type,
        name: `A ${type}`,
        fields: FULL_FIELDS[type],
        tags: [],
        publicDescription: emptyRichText(),
        gmNotes: emptyRichText(),
        source: 'manual',
        revealedAt: null,
        parentId: type === 'spot' ? body['parentId'] : null,
      });

      const read = await get(record.id);
      expect(read.statusCode).toBe(200);
      expect(read.json()).toEqual(record);
    });

    it.each(RECORD_TYPES)("rejects another type's field on a %s", async (type) => {
      const body = await bodyFor(type, 'Wrong fields');
      const response = await create({ ...body, fields: FOREIGN_FIELD[type] });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'Bad Request',
        issues: [expect.objectContaining({ path: 'fields' })],
      });
    });

    it.each(RECORD_TYPES)('refuses a player every %s route, even with a real id', async (type) => {
      const record = await created(await bodyFor(type, `Private ${type}`));

      expect((await call('GET', `${base(campaign)}?type=${type}`, player)).statusCode).toBe(403);
      expect((await get(record.id, campaign, player)).statusCode).toBe(403);
      expect((await patch(record.id, { name: 'Hijacked' }, campaign, player)).statusCode).toBe(403);
      expect((await remove(record.id, campaign, player)).statusCode).toBe(403);
      expect((await create({ type, name: 'Hijacked' }, campaign, player)).statusCode).toBe(403);

      expect((await get(record.id)).json()).toEqual(record);
    });
  });

  describe('creating', () => {
    it('stores a description, notes and tags when given', async () => {
      const record = await created({
        type: 'faction',
        name: 'Tide Guild',
        publicDescription: richText('Honest traders'),
        gmNotes: richText('They are not'),
        tags: [' harbour ', 'guild'],
      });

      expect(record).toMatchObject({
        publicDescription: richText('Honest traders'),
        gmNotes: richText('They are not'),
        tags: ['harbour', 'guild'],
        fields: {},
      });
    });

    it.each<[string, Record<string, unknown>]>([
      ['an unknown top-level key', { type: 'npc', name: 'X', revealedAt: null }],
      ['a missing type', { name: 'X' }],
      ['an unknown type', { type: 'monster', name: 'X' }],
      ['an unknown field', { type: 'npc', name: 'X', fields: { mood: 'grim' } }],
      ['a bad enum value', { type: 'npc', name: 'X', fields: { status: 'undead' } }],
      [
        'an unknown rich text node',
        {
          type: 'npc',
          name: 'X',
          publicDescription: { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] },
        },
      ],
      [
        'a javascript: link',
        {
          type: 'npc',
          name: 'X',
          gmNotes: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'x',
                    marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                  },
                ],
              },
            ],
          },
        },
      ],
      ['a 121-character name', { type: 'npc', name: 'a'.repeat(121) }],
      ['an empty name', { type: 'npc', name: '   ' }],
      [
        '21 tags',
        { type: 'npc', name: 'X', tags: Array.from({ length: 21 }, (_, i) => `t${String(i)}`) },
      ],
      ['duplicate tags', { type: 'npc', name: 'X', tags: ['a', 'a'] }],
    ])('rejects %s with 400', async (_label, body) => {
      const response = await create(body);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'Bad Request' });
    });

    it('refuses every write on an archived campaign but still reads', async () => {
      const shelf = await newCampaign('Archived Records');
      const record = await created({ type: 'lore', name: 'Old tale' }, shelf);
      expect((await call('POST', `/api/campaigns/${shelf.id}/archive`, gm)).statusCode).toBe(200);

      const archived = { statusCode: 409, message: 'Campaign is archived' };
      expect((await create({ type: 'npc', name: 'X' }, shelf)).json()).toMatchObject(archived);
      expect((await patch(record.id, { name: 'X' }, shelf)).json()).toMatchObject(archived);
      expect((await remove(record.id, shelf)).json()).toMatchObject(archived);

      expect(await list('', shelf)).toHaveLength(1);
      expect((await get(record.id, shelf)).statusCode).toBe(200);
    });
  });

  describe('listing', () => {
    it('returns summaries by name, filtered by type', async () => {
      const c = await newCampaign('List Campaign');
      await created({ type: 'npc', name: 'zeta' }, c);
      const alpha = await created(
        { type: 'area', name: 'Alpha', publicDescription: richText('hidden') },
        c,
      );
      await created({ type: 'npc', name: 'beta', fields: FULL_FIELDS.npc }, c);

      const all = await list('', c);
      expect(all.map((r) => r.name)).toEqual(['Alpha', 'beta', 'zeta']);
      expect(all[0]).toEqual({
        id: alpha.id,
        type: 'area',
        name: 'Alpha',
        tags: [],
        parentId: null,
        parentName: null,
        revealedAt: null,
        createdAt: alpha.createdAt,
        updatedAt: alpha.updatedAt,
      });

      expect((await list('?type=npc', c)).map((r) => r.name)).toEqual(['beta', 'zeta']);
      expect(await list('?type=lore', c)).toEqual([]);
      expect((await call('GET', `${base(c)}?type=monster`, gm)).statusCode).toBe(400);
    });
  });

  describe('spots and areas', () => {
    it('needs an area from the same campaign', async () => {
      expect((await create({ type: 'spot', name: 'Market' })).statusCode).toBe(400);

      const home = await area('Harbour');
      expect((await create({ type: 'npc', name: 'X', parentId: home.id })).statusCode).toBe(400);

      const npc = await created({ type: 'npc', name: 'Not an area' });
      const underNpc = await create({ type: 'spot', name: 'Market', parentId: npc.id });
      expect(underNpc.statusCode).toBe(404);
      expect(underNpc.json()).toMatchObject({ message: 'Area not found' });

      const foreign = await area('Foreign Area', other);
      expect(
        (await create({ type: 'spot', name: 'Market', parentId: foreign.id })).statusCode,
      ).toBe(404);

      const market = await created({ type: 'spot', name: 'Market', parentId: home.id });
      expect(market.parentId).toBe(home.id);
      expect(await list('?type=spot')).toContainEqual(
        expect.objectContaining({ id: market.id, parentId: home.id, parentName: 'Harbour' }),
      );
    });

    it('can move a spot to another area, but never away from one', async () => {
      const home = await area('Docks');
      const next = await area('Uptown');
      const spot = await created({ type: 'spot', name: 'Tavern', parentId: home.id });

      const moved = await patch(spot.id, { parentId: next.id });
      expect(moved.statusCode).toBe(200);
      expect(moved.json<CampaignRecord>().parentId).toBe(next.id);

      const detached = await patch(spot.id, { parentId: null });
      expect(detached.statusCode).toBe(400);
      expect(detached.json()).toMatchObject({ message: 'A spot needs an area' });

      const foreign = await area('Foreign Uptown', other);
      expect((await patch(spot.id, { parentId: foreign.id })).statusCode).toBe(404);

      const npc = await created({ type: 'npc', name: 'Landless' });
      const parented = await patch(npc.id, { parentId: home.id });
      expect(parented.statusCode).toBe(400);
      expect(parented.json()).toMatchObject({ message: 'Only spots have a parent' });
      expect((await patch(npc.id, { parentId: null })).statusCode).toBe(200);
    });

    it('refuses to delete an area that still has spots', async () => {
      const home = await area('Doomed');
      const spot = await created({ type: 'spot', name: 'Last stand', parentId: home.id });

      const refused = await remove(home.id);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        message: 'This area still has spots. Move or delete them first.',
      });
      expect((await get(home.id)).statusCode).toBe(200);

      expect((await remove(spot.id)).statusCode).toBe(204);
      expect((await remove(home.id)).statusCode).toBe(204);
      expect((await get(home.id)).statusCode).toBe(404);
      expect((await remove(home.id)).statusCode).toBe(404);
    });
  });

  describe('updating', () => {
    it('merges fields: present keys overwrite, null clears, the rest stay', async () => {
      const npc = await created({ type: 'npc', name: 'Mira', fields: FULL_FIELDS.npc });

      await new Promise((resolve) => setTimeout(resolve, 5));
      const dead = await patch(npc.id, { fields: { status: 'dead' } });
      expect(dead.statusCode).toBe(200);
      expect(dead.json<CampaignRecord>().fields).toEqual({ ...FULL_FIELDS.npc, status: 'dead' });
      expect(new Date(dead.json<CampaignRecord>().updatedAt).getTime()).toBeGreaterThan(
        new Date(npc.updatedAt).getTime(),
      );

      const rest = Object.fromEntries(
        Object.entries({ ...FULL_FIELDS.npc, status: 'dead' }).filter(
          ([key]) => key !== 'appearance',
        ),
      );
      const cleared = await patch(npc.id, { fields: { appearance: null } });
      expect(cleared.json<CampaignRecord>().fields).toEqual(rest);

      const tagged = await patch(npc.id, { tags: ['ally'] });
      expect(tagged.json<CampaignRecord>()).toMatchObject({ tags: ['ally'], fields: rest });
    });

    it('updates the name, description and notes', async () => {
      const item = await created({ type: 'item', name: 'Bell' });
      const response = await patch(item.id, {
        name: '  The Marigold bell  ',
        publicDescription: richText('A bronze bell'),
        gmNotes: richText('Rings for lies'),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        name: 'The Marigold bell',
        publicDescription: richText('A bronze bell'),
        gmNotes: richText('Rings for lies'),
        fields: {},
      });
    });

    it('rejects empty, type-changing and wrong-type patches', async () => {
      const npc = await created({ type: 'npc', name: 'Stable', fields: FULL_FIELDS.npc });

      expect((await patch(npc.id, {})).statusCode).toBe(400);
      expect((await patch(npc.id, { type: 'area' })).statusCode).toBe(400);
      expect((await patch(npc.id, { id: other.id })).statusCode).toBe(400);

      const wrong = await patch(npc.id, { fields: FOREIGN_FIELD.npc });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json()).toMatchObject({ issues: [expect.objectContaining({ path: 'fields' })] });

      expect((await get(npc.id)).json()).toEqual(npc);
    });
  });

  describe('isolation of record ids', () => {
    it("can't reach another campaign's record through its own campaign", async () => {
      const theirs = await created({ type: 'lore', name: 'Their secret' }, other);

      for (const response of [
        await get(theirs.id),
        await patch(theirs.id, { name: 'Hijacked' }),
        await remove(theirs.id),
      ]) {
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject(NOT_FOUND);
      }
      expect((await get(theirs.id, other)).json()).toEqual(theirs);

      for (const id of ['not-a-uuid', '1', '00000000-0000-4000-8000-000000000009']) {
        expect((await get(id)).statusCode, id).toBe(404);
        expect((await patch(id, { name: 'X' })).statusCode, id).toBe(404);
        expect((await remove(id)).statusCode, id).toBe(404);
      }
    });
  });

  describe('database rules', () => {
    const raw = (values: Partial<typeof records.$inferInsert>) =>
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

    it('ties parents to spots (check constraint)', async () => {
      expect(pgCode(await raw({ type: 'spot' }))).toBe('23514');
      const home = await area('Raw Area');
      expect(pgCode(await raw({ type: 'npc', parentId: home.id }))).toBe('23514');
      expect(await raw({ type: 'spot', parentId: home.id })).toBeNull();
    });

    it("keeps a spot's area in the same campaign (composite FK)", async () => {
      const foreign = await area('Raw Foreign Area', other);
      expect(pgCode(await raw({ type: 'spot', parentId: foreign.id }))).toBe('23503');
    });

    it('keeps an area while a spot points at it (FK)', async () => {
      const home = await area('Raw Anchored');
      await created({ type: 'spot', name: 'Anchor', parentId: home.id });
      const error = await failureOf(handle.db.delete(records).where(eq(records.id, home.id)));
      expect(pgCode(error)).toBe('23503');
    });

    it('limits names to 120 characters (check constraint)', async () => {
      expect(pgCode(await raw({ name: 'a'.repeat(121) }))).toBe('23514');
      expect(pgCode(await raw({ name: '' }))).toBe('23514');
    });
  });
});
