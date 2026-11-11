/**
 * Record search and filters (F1.6a, D-25), against a real Postgres: the generated
 * `search_vector`, prefix matching, ranking, excerpts, tag and area filters, and isolation.
 * Each test makes its own campaign, so results never depend on another test's records.
 */
import type { Campaign, CampaignRecord, RecordListItem, RichText } from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import { richText } from '../../test/record-fixtures';
import type { DbHandle } from '../db/client';
import { campaignMembers, users } from '../db/schema';

interface Person {
  cookie: string;
  id: string;
}

/** A paragraph of mixed nodes: a bold word split across text nodes and a mention. */
function mixed(): RichText {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hides in the ' },
          { type: 'text', text: 'light', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'house cellar.' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fears' }] }],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'storms' }] }],
          },
        ],
      },
    ],
  };
}

function mentioning(target: { id: string; name: string }): RichText {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Works for ' },
          {
            type: 'mention',
            attrs: { id: target.id, label: target.name, mentionSuggestionChar: '@' },
          },
        ],
      },
    ],
  };
}

describe('Record search API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let player: Person;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('7001', 'Search GM');
    player = await person('7002', 'Search Player');
  });

  afterAll(async () => {
    await app.close();
  });

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    who: Person,
    payload?: Record<string, unknown>,
  ) {
    return app.inject({
      method,
      url,
      headers: { ...SAME_ORIGIN, cookie: who.cookie },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function newCampaign(name = 'Search Campaign'): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', gm, { name });
    expect(response.statusCode).toBe(201);
    return response.json<Campaign>();
  }

  const base = (c: Campaign) => `/api/campaigns/${c.id}/records`;

  async function created(c: Campaign, body: Record<string, unknown>): Promise<CampaignRecord> {
    const response = await call('POST', base(c), gm, body);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    return response.json<CampaignRecord>();
  }

  async function search(c: Campaign, query: string): Promise<RecordListItem[]> {
    const response = await call('GET', `${base(c)}?${query}`, gm);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    return response.json<{ records: RecordListItem[] }>().records;
  }

  const names = (items: RecordListItem[]) => items.map((item) => item.name);
  const q = (text: string) => `q=${encodeURIComponent(text)}`;

  describe('text search', () => {
    it('matches word prefixes in names, case-insensitively', async () => {
      const c = await newCampaign();
      await created(c, { type: 'npc', name: 'Mira Saltwind' });
      await created(c, { type: 'npc', name: 'Old Tom' });

      expect(names(await search(c, q('mir')))).toEqual(['Mira Saltwind']);
      expect(names(await search(c, q('SALT')))).toEqual(['Mira Saltwind']);
      expect(names(await search(c, q('zzz')))).toEqual([]);
    });

    it('finds a name substring in the middle of a word', async () => {
      const c = await newCampaign();
      await created(c, { type: 'area', name: 'Saltmarsh' });

      expect(names(await search(c, q('marsh')))).toEqual(['Saltmarsh']);
    });

    it('needs every word, each anywhere in the name, tags or text', async () => {
      const c = await newCampaign();
      await created(c, {
        type: 'npc',
        name: 'Mira',
        gmNotes: richText('Owes the Tide Guild money'),
      });
      await created(c, { type: 'npc', name: 'Tom', gmNotes: richText('Owes nobody') });

      expect(names(await search(c, q('mira guild')))).toEqual(['Mira']);
      expect(names(await search(c, q('owes')))).toEqual(['Mira', 'Tom']);
      expect(names(await search(c, q('tom guild')))).toEqual([]);
    });

    it('searches the public description and GM notes, with an excerpt of the match', async () => {
      const c = await newCampaign();
      await created(c, {
        type: 'npc',
        name: 'Mira',
        publicDescription: richText('A sailor with a lantern'),
      });
      await created(c, { type: 'npc', name: 'Tom', gmNotes: richText('Secretly a lantern thief') });

      const items = await search(c, q('lantern'));

      expect(names(items)).toEqual(['Mira', 'Tom']);
      expect(items.map((item) => item.match)).toEqual([
        { field: 'publicDescription', snippet: 'A sailor with a lantern' },
        { field: 'gmNotes', snippet: 'Secretly a lantern thief' },
      ]);
    });

    it('prefers the public description for the excerpt when both match', async () => {
      const c = await newCampaign();
      await created(c, {
        type: 'npc',
        name: 'Mira',
        publicDescription: richText('Carries a lantern'),
        gmNotes: richText('The lantern is cursed'),
      });

      expect((await search(c, q('lantern')))[0]?.match?.field).toBe('publicDescription');
    });

    it('gives no excerpt when the name or tags explain the match', async () => {
      const c = await newCampaign();
      await created(c, { type: 'npc', name: 'Mira', gmNotes: richText('Mira is lying') });
      await created(c, {
        type: 'npc',
        name: 'Tom',
        tags: ['smuggler'],
        gmNotes: richText('A smuggler'),
      });

      expect((await search(c, q('mira')))[0]?.match).toBeNull();
      expect((await search(c, q('smuggler')))[0]?.match).toBeNull();
      expect((await search(c, q('tom smug')))[0]?.match).toBeNull();
    });

    it('matches tags', async () => {
      const c = await newCampaign();
      await created(c, { type: 'npc', name: 'Mira', tags: ['harbour', 'act 1'] });

      expect(names(await search(c, q('harb')))).toEqual(['Mira']);
    });

    it('joins formatted text within a paragraph and matches list items and mentions', async () => {
      const c = await newCampaign();
      const guild = await created(c, { type: 'faction', name: 'Tide Guild' });
      await created(c, { type: 'npc', name: 'Mira', gmNotes: mixed() });
      await created(c, { type: 'npc', name: 'Tom', publicDescription: mentioning(guild) });

      expect(names(await search(c, q('lighthouse')))).toEqual(['Mira']);
      expect(names(await search(c, q('fears storms')))).toEqual(['Mira']);
      expect(names(await search(c, q('works tide')))).toEqual(['Tom']);
    });

    it("doesn't search the type fields", async () => {
      const c = await newCampaign();
      await created(c, {
        type: 'npc',
        name: 'Mira',
        fields: { secrets: richText('Smuggles moonstone'), appearance: 'Moonstone earrings' },
      });

      expect(await search(c, q('moonstone'))).toEqual([]);
    });

    it('finds new text after a save', async () => {
      const c = await newCampaign();
      const mira = await created(c, { type: 'npc', name: 'Mira' });
      expect(await search(c, q('kraken'))).toEqual([]);

      const response = await call('PATCH', `${base(c)}/${mira.id}`, gm, {
        gmNotes: richText('Saw the kraken'),
      });
      expect(response.statusCode).toBe(200);

      expect(names(await search(c, q('kraken')))).toEqual(['Mira']);
    });

    it('ranks exact name, then name prefix, then name substring, then text', async () => {
      const c = await newCampaign();
      await created(c, { type: 'npc', name: 'Archer', gmNotes: richText('Rook nests here') });
      await created(c, { type: 'npc', name: 'Brook' });
      await created(c, { type: 'npc', name: 'Rookery' });
      await created(c, { type: 'npc', name: 'Rook' });

      expect(names(await search(c, q('rook')))).toEqual(['Rook', 'Rookery', 'Brook', 'Archer']);
    });

    it('treats punctuation and LIKE and tsquery syntax as plain text', async () => {
      const c = await newCampaign();
      await created(c, { type: 'npc', name: '100% Pure' });
      await created(c, { type: 'npc', name: 'Snake_Eyes' });
      await created(c, { type: 'npc', name: "Mira's Boat" });
      await created(c, { type: 'npc', name: 'Plain' });

      expect(names(await search(c, q('%')))).toEqual(['100% Pure']);
      expect(names(await search(c, q('_')))).toEqual(['Snake_Eyes']);
      expect(names(await search(c, q("mira's")))).toEqual(["Mira's Boat"]);
      for (const text of ['&', '!', ':*', "'", '|', '\\', '(', 'a & !b']) {
        const response = await call('GET', `${base(c)}?${q(text)}`, gm);
        expect(response.statusCode, text).toBe(200);
        expect(names(response.json<{ records: RecordListItem[] }>().records), text).not.toContain(
          'Plain',
        );
      }
    });

    it('treats a blank search as no search', async () => {
      const c = await newCampaign();
      await created(c, { type: 'npc', name: 'Mira' });
      await created(c, { type: 'npc', name: 'Tom' });

      const items = await search(c, q('   '));
      expect(names(items)).toEqual(['Mira', 'Tom']);
      expect(items.every((item) => item.match === null)).toBe(true);
    });

    it('returns at most `limit` records, best first', async () => {
      const c = await newCampaign();
      for (const name of ['Rook', 'Rookery', 'Brook']) await created(c, { type: 'npc', name });

      expect(names(await search(c, `${q('rook')}&limit=2`))).toEqual(['Rook', 'Rookery']);
      expect(names(await search(c, 'limit=1'))).toEqual(['Brook']);
    });
  });

  describe('filters', () => {
    it('keeps records that have every tag given', async () => {
      const c = await newCampaign();
      await created(c, { type: 'npc', name: 'Mira', tags: ['harbour', 'act 1'] });
      await created(c, { type: 'npc', name: 'Tom', tags: ['harbour'] });
      await created(c, { type: 'npc', name: 'Ula', tags: [] });

      expect(names(await search(c, 'tag=harbour'))).toEqual(['Mira', 'Tom']);
      expect(names(await search(c, 'tag=harbour&tag=act%201'))).toEqual(['Mira']);
      expect(names(await search(c, 'tag=Harbour'))).toEqual([]);
    });

    it("keeps an area's spots, and combines with type and search", async () => {
      const c = await newCampaign();
      const marsh = await created(c, { type: 'area', name: 'Saltmarsh' });
      const city = await created(c, { type: 'area', name: 'Port City' });
      await created(c, { type: 'spot', name: 'Docks', parentId: marsh.id });
      await created(c, { type: 'spot', name: 'Tavern', parentId: marsh.id });
      await created(c, { type: 'spot', name: 'Market', parentId: city.id });

      expect(names(await search(c, `areaId=${marsh.id}`))).toEqual(['Docks', 'Tavern']);
      expect(names(await search(c, `areaId=${marsh.id}&type=spot&${q('tav')}`))).toEqual([
        'Tavern',
      ]);
      expect(await search(c, `areaId=${marsh.id}&type=npc`)).toEqual([]);
    });

    it('refuses bad filters', async () => {
      const c = await newCampaign();
      const tooMany = Array.from({ length: 21 }, (_, i) => `tag=t${String(i)}`).join('&');
      for (const query of [
        'areaId=nope',
        q('x'.repeat(201)),
        tooMany,
        'tag=',
        'limit=0',
        'limit=101',
        'limit=two',
      ]) {
        const response = await call('GET', `${base(c)}?${query}`, gm);
        expect(response.statusCode, query.slice(0, 40)).toBe(400);
      }
    });
  });

  describe('access', () => {
    it('is GM only', async () => {
      const c = await newCampaign();
      await handle.db
        .insert(campaignMembers)
        .values({ campaignId: c.id, userId: player.id, role: 'player' });

      const response = await call('GET', `${base(c)}?${q('mira')}`, player);
      expect(response.statusCode).toBe(403);
    });

    it("never returns another campaign's records", async () => {
      const mine = await newCampaign('Mine');
      const other = await newCampaign('Other');
      const otherArea = await created(other, { type: 'area', name: 'Elsewhere' });
      await created(other, {
        type: 'spot',
        name: 'Hidden Cove',
        parentId: otherArea.id,
        tags: ['secret'],
        gmNotes: richText('cove'),
      });

      expect(await search(mine, q('cove'))).toEqual([]);
      expect(await search(mine, 'tag=secret')).toEqual([]);
      expect(await search(mine, `areaId=${otherArea.id}`)).toEqual([]);
    });
  });
});
