/**
 * Links between records (F1.5a, D-24), against a real Postgres: field links with their
 * target types and cardinality, other links with labels, mention sync, backlinks, deletes,
 * Item links on PC inventories, and the table's own rules. Route-level isolation of the
 * backlinks route (outsiders 404, players 403) is in the table in `campaigns.int.test.ts`.
 */
import type {
  BacklinksResponse,
  Campaign,
  CampaignRecord,
  Character,
  CharacterSheet,
  RecordType,
  RichText,
} from '@stagehand/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import { richText } from '../../test/record-fixtures';
import type { DbHandle } from '../db/client';
import { campaignMembers, recordLinks, users } from '../db/schema';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

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

/** Text that @-mentions each record. */
function mentioning(...targets: { id: string; name: string }[]): RichText {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          ...targets.map((target) => ({
            type: 'mention' as const,
            attrs: { id: target.id, label: target.name, mentionSuggestionChar: '@' as const },
          })),
        ],
      },
    ],
  };
}

const ref = (record: CampaignRecord) => ({ id: record.id, type: record.type, name: record.name });

describe('Record links API', () => {
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
    gm = await person('6001', 'Links GM');
    player = await person('6002', 'Links Player');
    campaign = await newCampaign('Links Campaign');
    other = await newCampaign('Other Links Campaign');
    await handle.db
      .insert(campaignMembers)
      .values({ campaignId: campaign.id, userId: player.id, role: 'player' });
  });

  afterAll(async () => {
    await app.close();
  });

  function call(method: Method, url: string, who: Person | null, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: { ...SAME_ORIGIN, cookie: who?.cookie ?? '' },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function newCampaign(name: string): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', gm, { name });
    expect(response.statusCode).toBe(201);
    return response.json<Campaign>();
  }

  const base = (c: Campaign) => `/api/campaigns/${c.id}/records`;

  async function created(body: Record<string, unknown>, c = campaign): Promise<CampaignRecord> {
    const response = await call('POST', base(c), gm, body);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    return response.json<CampaignRecord>();
  }

  async function make(type: RecordType, name: string, c = campaign): Promise<CampaignRecord> {
    if (type !== 'spot') return created({ type, name }, c);
    const home = await created({ type: 'area', name: `${name} Area` }, c);
    return created({ type, name, parentId: home.id }, c);
  }

  const patch = (id: string, body: unknown, c = campaign) =>
    call('PATCH', `${base(c)}/${id}`, gm, body);

  async function patched(id: string, body: unknown): Promise<CampaignRecord> {
    const response = await patch(id, body);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    return response.json<CampaignRecord>();
  }

  async function read(id: string): Promise<CampaignRecord> {
    const response = await call('GET', `${base(campaign)}/${id}`, gm);
    expect(response.statusCode).toBe(200);
    return response.json<CampaignRecord>();
  }

  async function backlinks(id: string): Promise<BacklinksResponse> {
    const response = await call('GET', `${base(campaign)}/${id}/backlinks`, gm);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    return response.json<BacklinksResponse>();
  }

  describe('field links', () => {
    it('come back with the record, every field present and each list sorted by name', async () => {
      const npc = await make('npc', 'Mira');
      expect(npc.links).toEqual({ homeSpot: [], factions: [] });
      expect(npc.otherLinks).toEqual([]);

      const spot = await make('spot', 'Net Loft');
      const tide = await make('faction', 'Tide Guild');
      const ash = await make('faction', 'ash circle');
      const updated = await patched(npc.id, {
        links: { homeSpot: [spot.id], factions: [tide.id, ash.id] },
      });
      expect(updated.links).toEqual({ homeSpot: [ref(spot)], factions: [ref(ash), ref(tide)] });
      expect((await read(npc.id)).links).toEqual(updated.links);
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(npc.updatedAt));
    });

    it('replace only the fields sent, and an empty list clears one', async () => {
      const npc = await make('npc', 'Oskar');
      const spot = await make('spot', 'Bell Tower');
      const tide = await make('faction', 'Tide Watch');
      const ash = await make('faction', 'Ash Watch');
      await patched(npc.id, { links: { homeSpot: [spot.id], factions: [tide.id] } });

      const swapped = await patched(npc.id, { links: { factions: [ash.id] } });
      expect(swapped.links).toEqual({ homeSpot: [ref(spot)], factions: [ref(ash)] });

      const cleared = await patched(npc.id, { links: { homeSpot: [] } });
      expect(cleared.links).toEqual({ homeSpot: [], factions: [ref(ash)] });
    });

    it('can be set when the record is created', async () => {
      const leader = await make('npc', 'Captain Vey');
      const faction = await created({
        type: 'faction',
        name: 'Gull Riders',
        links: { leaders: [leader.id] },
        otherLinks: [{ recordId: leader.id, label: 'founded by' }],
      });
      expect(faction.links['leaders']).toEqual([ref(leader)]);
      expect(faction.otherLinks).toEqual([{ record: ref(leader), label: 'founded by' }]);
    });

    it('accept only the types the field lists', async () => {
      const npc = await make('npc', 'Pell');
      const item = await make('item', 'Brass Key');
      const response = await patch(npc.id, { links: { homeSpot: [item.id] } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ message: 'Home spot can only link Spots' });

      const lore = await make('lore', 'The Drowning');
      const faction = await make('faction', 'Lamplighters');
      const spot = await make('spot', 'Chapel');
      expect(
        (await patch(lore.id, { links: { whoKnowsIt: [npc.id, faction.id] } })).statusCode,
      ).toBe(200);
      expect((await patch(lore.id, { links: { whoKnowsIt: [spot.id] } })).json()).toMatchObject({
        message: 'Who knows it can only link NPCs or Factions',
      });
    });

    it('hold one record on a one field, and no duplicates', async () => {
      const npc = await make('npc', 'Rook');
      const a = await make('spot', 'Dock A');
      const b = await make('spot', 'Dock B');
      const twice = await patch(npc.id, { links: { homeSpot: [a.id, b.id] } });
      expect(twice.statusCode).toBe(400);
      expect(twice.json()).toMatchObject({
        issues: [{ path: 'links.homeSpot', message: 'Home spot holds one record' }],
      });
      expect((await patch(npc.id, { links: { factions: [a.id, a.id] } })).statusCode).toBe(400);
    });

    it('refuse link fields of another type, and unknown keys', async () => {
      const npc = await make('npc', 'Sable');
      const other = await make('npc', 'Sable Too');
      expect((await patch(npc.id, { links: { leaders: [other.id] } })).statusCode).toBe(400);
      expect((await patch(npc.id, { links: { personality: [other.id] } })).statusCode).toBe(400);
    });

    it("refuse a link to the record itself, or to a record that isn't in this campaign", async () => {
      const faction = await make('faction', 'Mirror Guild');
      const self = await patch(faction.id, { links: { alliesAndEnemies: [faction.id] } });
      expect(self.statusCode).toBe(400);
      expect(self.json()).toMatchObject({ message: "A record can't link to itself" });

      const foreign = await make('faction', 'Foreign Guild', other);
      const friend = await make('faction', 'Friend Guild');
      for (const id of [foreign.id, crypto.randomUUID()]) {
        const response = await patch(faction.id, { links: { alliesAndEnemies: [friend.id, id] } });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ message: 'Linked record not found' });
      }
      // Nothing was written by the refused requests.
      expect((await read(faction.id)).links['alliesAndEnemies']).toEqual([]);
    });

    it('are refused while the campaign is archived', async () => {
      const shelf = await newCampaign('Links Shelf');
      const npc = await make('npc', 'Shelved', shelf);
      const faction = await make('faction', 'Shelved Guild', shelf);
      expect((await call('POST', `/api/campaigns/${shelf.id}/archive`, gm)).statusCode).toBe(200);
      const response = await patch(npc.id, { links: { factions: [faction.id] } }, shelf);
      expect(response.statusCode).toBe(409);
      expect((await call('GET', `${base(shelf)}/${faction.id}/backlinks`, gm)).statusCode).toBe(
        200,
      );
    });
  });

  describe('other links', () => {
    it('link any record with an optional label, replacing the whole list', async () => {
      const npc = await make('npc', 'Talla');
      const rival = await make('npc', 'Brann');
      const item = await make('item', 'Locket');

      const first = await patched(npc.id, {
        otherLinks: [
          { recordId: rival.id, label: 'rival of' },
          { recordId: item.id, label: null },
        ],
      });
      expect(first.otherLinks).toEqual([
        { record: ref(rival), label: 'rival of' },
        { record: ref(item), label: null },
      ]);

      const relabelled = await patched(npc.id, {
        otherLinks: [{ recordId: rival.id, label: 'sister of' }],
      });
      expect(relabelled.otherLinks).toEqual([{ record: ref(rival), label: 'sister of' }]);

      expect((await patched(npc.id, { otherLinks: [] })).otherLinks).toEqual([]);
    });

    it('refuse self links, foreign records and long labels', async () => {
      const npc = await make('npc', 'Ivo');
      const foreign = await make('npc', 'Foreign Ivo', other);
      expect(
        (await patch(npc.id, { otherLinks: [{ recordId: npc.id, label: null }] })).statusCode,
      ).toBe(400);
      expect(
        (await patch(npc.id, { otherLinks: [{ recordId: foreign.id, label: null }] })).statusCode,
      ).toBe(404);
      const friend = await make('npc', 'Ivo Friend');
      expect(
        (await patch(npc.id, { otherLinks: [{ recordId: friend.id, label: 'x'.repeat(61) }] }))
          .statusCode,
      ).toBe(400);
    });
  });

  describe('mentions', () => {
    it('in any rich text of the record show up as backlinks, and go when removed', async () => {
      const mira = await make('npc', 'Mira Vale');
      const guild = await make('faction', 'Net Guild');
      const notes = await created({
        type: 'session_notes',
        name: 'Session 1',
        gmNotes: mentioning(mira),
        fields: { keyEvents: mentioning(guild, mira) },
      });
      expect((await backlinks(mira.id)).mentions).toEqual([ref(notes)]);
      expect((await backlinks(guild.id)).mentions).toEqual([ref(notes)]);

      await patched(notes.id, { fields: { keyEvents: null } });
      expect((await backlinks(guild.id)).mentions).toEqual([]);
      expect((await backlinks(mira.id)).mentions).toEqual([ref(notes)]);

      await patched(notes.id, { gmNotes: richText('Nothing to see') });
      expect((await backlinks(mira.id)).mentions).toEqual([]);
    });

    it("of the record itself, other campaigns' records or unknown ids save but link nothing", async () => {
      const npc = await make('npc', 'Quill');
      const foreign = await make('npc', 'Foreign Quill', other);
      const made = { id: crypto.randomUUID(), name: 'Nobody' };
      const response = await patch(npc.id, {
        publicDescription: mentioning({ id: npc.id, name: npc.name }, foreign, made),
      });
      expect(response.statusCode).toBe(200);
      const rows = await handle.db
        .select()
        .from(recordLinks)
        .where(eq(recordLinks.fromRecordId, npc.id));
      expect(rows).toEqual([]);
    });

    it('are refused in character sheets', async () => {
      const npc = await make('npc', 'Sheet Target');
      const pc = await call('POST', `/api/campaigns/${campaign.id}/characters`, gm, {
        name: 'Mentioner',
      });
      const id = pc.json<Character>().id;
      const response = await call('PATCH', `/api/campaigns/${campaign.id}/characters/${id}`, gm, {
        gmNotes: mentioning(npc),
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('backlinks', () => {
    it('list field and other links from their source, by name, with the field or label', async () => {
      const leader = await make('npc', 'Hale');
      const guild = await make('faction', 'Lantern Guild');
      const beat = await make('story_beat', 'A Meeting');
      await patched(guild.id, {
        links: { leaders: [leader.id], members: [leader.id] },
      });
      await patched(beat.id, {
        links: { involved: [leader.id] },
        otherLinks: [{ recordId: leader.id, label: 'betrayed in' }],
      });

      expect(await backlinks(leader.id)).toEqual({
        links: [
          { record: ref(beat), kind: 'field', fieldKey: 'involved', label: null },
          { record: ref(beat), kind: 'other', fieldKey: null, label: 'betrayed in' },
          { record: ref(guild), kind: 'field', fieldKey: 'leaders', label: null },
          { record: ref(guild), kind: 'field', fieldKey: 'members', label: null },
        ],
        mentions: [],
        inventories: [],
      });
    });

    it('404 for a record of another campaign', async () => {
      const foreign = await make('npc', 'Foreign Hale', other);
      const response = await call('GET', `${base(campaign)}/${foreign.id}/backlinks`, gm);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ message: 'Record not found' });
    });

    it('are GM only, on a real record too', async () => {
      const npc = await make('npc', 'Private Hale');
      const response = await call('GET', `${base(campaign)}/${npc.id}/backlinks`, player);
      expect(response.statusCode).toBe(403);
    });
  });

  describe('deleting a record', () => {
    it('removes its links in both directions and leaves mentions of it as text', async () => {
      const doomed = await make('npc', 'Doomed');
      const spot = await make('spot', 'Doomed Home');
      const faction = await make('faction', 'Doomed Guild');
      await patched(doomed.id, { links: { homeSpot: [spot.id] } });
      await patched(faction.id, {
        links: { members: [doomed.id] },
        gmNotes: mentioning(doomed),
      });

      expect((await call('DELETE', `${base(campaign)}/${doomed.id}`, gm)).statusCode).toBe(204);

      const after = await read(faction.id);
      expect(after.links['members']).toEqual([]);
      expect(after.gmNotes).toEqual(mentioning(doomed));
      expect(await backlinks(spot.id)).toMatchObject({ links: [], mentions: [] });
      const rows = await handle.db
        .select()
        .from(recordLinks)
        .where(eq(recordLinks.toRecordId, doomed.id));
      expect(rows).toEqual([]);

      // The stale mention doesn't stop the text from being saved again.
      expect((await patch(faction.id, { gmNotes: after.gmNotes })).statusCode).toBe(200);
    });
  });

  describe('PC inventories', () => {
    const sheets = (c = campaign) => `/api/campaigns/${c.id}/characters`;

    async function newPc(name: string, assignTo?: Person): Promise<Character> {
      const body = assignTo === undefined ? { name } : { name, assignToUserId: assignTo.id };
      const response = await call('POST', sheets(), gm, body);
      expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
      return response.json<Character>();
    }

    const setInventory = (pcId: string, inventory: unknown) =>
      call('PATCH', `${sheets()}/${pcId}`, gm, { inventory });

    it('link Item records, which list the PCs carrying them', async () => {
      const key = await make('item', 'Tide Key');
      const pc = await newPc('Wren');
      const response = await setInventory(pc.id, [
        { name: 'Tide key', detail: 'Cold to the touch', recordId: key.id },
        { name: 'Rope', detail: '' },
      ]);
      expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
      expect(response.json<CharacterSheet>().inventory[0]).toMatchObject({ recordId: key.id });
      expect((await backlinks(key.id)).inventories).toEqual([{ id: pc.id, name: 'Wren' }]);
    });

    it("refuse a record that isn't an Item of this campaign", async () => {
      const pc = await newPc('Finch');
      const npc = await make('npc', 'Not An Item');
      const foreign = await make('item', 'Foreign Item', other);
      for (const id of [npc.id, foreign.id, crypto.randomUUID()]) {
        const response = await setInventory(pc.id, [{ name: 'Thing', detail: '', recordId: id }]);
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ message: 'Item not found' });
      }
    });

    it("never show the Item link on the player's own sheet", async () => {
      const key = await make('item', 'Secret Key');
      const pc = await newPc('Lark', player);
      await setInventory(pc.id, [{ name: 'Odd key', detail: 'Hums', recordId: key.id }]);

      const response = await call('GET', `${sheets()}/${pc.id}`, player);
      expect(response.statusCode).toBe(200);
      expect(response.json<{ inventory: unknown[] }>().inventory).toEqual([
        { name: 'Odd key', detail: 'Hums' },
      ]);
      expect(response.body).not.toContain(key.id);
    });

    it('lose the link, but keep the row, when the Item is deleted', async () => {
      const key = await make('item', 'Melting Key');
      const pc = await newPc('Heron');
      await setInventory(pc.id, [{ name: 'Wax key', detail: '', recordId: key.id }]);

      expect((await call('DELETE', `${base(campaign)}/${key.id}`, gm)).statusCode).toBe(204);
      const sheet = await call('GET', `${sheets()}/${pc.id}`, gm);
      expect(sheet.json<CharacterSheet>().inventory).toEqual([{ name: 'Wax key', detail: '' }]);
    });
  });

  describe('database rules', () => {
    const raw = (values: Partial<typeof recordLinks.$inferInsert>) =>
      failureOf(
        handle.db.insert(recordLinks).values({
          campaignId: campaign.id,
          fromRecordId: crypto.randomUUID(),
          toRecordId: crypto.randomUUID(),
          kind: 'other',
          ...values,
        }),
      );

    it('keep both ends in the link’s campaign (composite FKs)', async () => {
      const here = await make('npc', 'Raw Here');
      const there = await make('npc', 'Raw There', other);
      expect(pgCode(await raw({ fromRecordId: here.id, toRecordId: there.id }))).toBe('23503');
      expect(pgCode(await raw({ fromRecordId: there.id, toRecordId: here.id }))).toBe('23503');
    });

    it('refuse self links and columns the kind does not use (checks)', async () => {
      const a = await make('npc', 'Raw A');
      const b = await make('npc', 'Raw B');
      const ends = { fromRecordId: a.id, toRecordId: b.id };
      expect(pgCode(await raw({ fromRecordId: a.id, toRecordId: a.id }))).toBe('23514');
      expect(pgCode(await raw({ ...ends, kind: 'field' }))).toBe('23514');
      expect(pgCode(await raw({ ...ends, kind: 'other', fieldKey: 'factions' }))).toBe('23514');
      expect(pgCode(await raw({ ...ends, kind: 'field', fieldKey: 'factions', label: 'x' }))).toBe(
        '23514',
      );
      expect(pgCode(await raw({ ...ends, kind: 'mention', label: 'x' }))).toBe('23514');
      expect(pgCode(await raw({ ...ends, label: 'x'.repeat(61) }))).toBe('23514');
      expect(pgCode(await raw({ ...ends, label: '' }))).toBe('23514');
      expect(await raw({ ...ends, label: 'x'.repeat(60) })).toBeNull();
    });

    it('keep each link once per kind (and per field)', async () => {
      const a = await make('npc', 'Raw Twice A');
      const b = await make('faction', 'Raw Twice B');
      const ends = { fromRecordId: a.id, toRecordId: b.id };
      expect(await raw({ ...ends, kind: 'field', fieldKey: 'factions' })).toBeNull();
      expect(pgCode(await raw({ ...ends, kind: 'field', fieldKey: 'factions' }))).toBe('23505');
      expect(await raw({ ...ends, kind: 'field', fieldKey: 'other' })).toBeNull();
      expect(await raw({ ...ends, kind: 'mention' })).toBeNull();
      expect(pgCode(await raw({ ...ends, kind: 'mention' }))).toBe('23505');
      expect(await raw({ ...ends, kind: 'other' })).toBeNull();
      expect(pgCode(await raw({ ...ends, kind: 'other', label: 'again' }))).toBe('23505');
    });

    it('cascade when either end is deleted outside the data layer', async () => {
      const a = await make('npc', 'Raw Gone A');
      const b = await make('npc', 'Raw Gone B');
      expect(await raw({ fromRecordId: a.id, toRecordId: b.id })).toBeNull();
      expect(await raw({ fromRecordId: b.id, toRecordId: a.id, kind: 'mention' })).toBeNull();
      expect((await call('DELETE', `${base(campaign)}/${a.id}`, gm)).statusCode).toBe(204);
      const left = await handle.db
        .select()
        .from(recordLinks)
        .where(and(eq(recordLinks.campaignId, campaign.id), eq(recordLinks.fromRecordId, b.id)));
      expect(left).toEqual([]);
    });
  });
});
