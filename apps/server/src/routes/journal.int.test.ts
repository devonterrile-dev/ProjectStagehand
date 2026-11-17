/**
 * The player journal (F3.5, governance §7), against a real Postgres: revealed records as players
 * read them, the players' entries, and the notes on both, with who may change what. Route-level
 * isolation with random ids (outsiders 404) is in the table in `campaigns.int.test.ts`; the
 * images players may load are in `play-sessions.int.test.ts`.
 */
import { randomUUID } from 'node:crypto';

import type {
  Campaign,
  CampaignRecord,
  JournalRecord,
  JournalRecordListResponse,
  PlayerEntry,
  PlayerEntryListResponse,
  PlayerNote,
  PlayerNoteListResponse,
  RichText,
} from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import type { DbHandle } from '../db/client';
import { campaignMembers, playerNotes, users } from '../db/schema';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface Person {
  cookie: string;
  id: string;
}

/** A paragraph of text, with an @-mention of each record given after it. */
function text(words: string, ...mentions: { id: string; name: string }[]): RichText {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: words },
          ...mentions.flatMap((record) => [
            { type: 'text' as const, text: ' ' },
            { type: 'mention' as const, attrs: { id: record.id, label: record.name } },
          ]),
        ],
      },
    ],
  };
}

describe('Player journal API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let player: Person;
  let otherPlayer: Person;
  let campaign: Campaign;
  let other: Campaign;

  let area: CampaignRecord;
  let hiddenArea: CampaignRecord;
  let spot: CampaignRecord;
  let lighthouse: CampaignRecord;
  let keeper: CampaignRecord;
  let secret: CampaignRecord;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('17301', 'Journal GM');
    player = await person('17302', 'Journal Player');
    otherPlayer = await person('17303', 'Second Player');
    campaign = await newCampaign('Journal Campaign');
    other = await newCampaign('Other Journal Campaign');
    for (const who of [player, otherPlayer]) {
      await handle.db
        .insert(campaignMembers)
        .values({ campaignId: campaign.id, userId: who.id, role: 'player' });
    }

    area = await record({ type: 'area', name: 'Gull Coast' });
    hiddenArea = await record({ type: 'area', name: 'Drowned Vale' });
    spot = await record({ type: 'spot', name: 'Cliff stairs', parentId: area.id });
    secret = await record({
      type: 'npc',
      name: 'The smuggler queen',
      gmNotes: text('She owns the lighthouse'),
      tags: ['villain'],
    });
    keeper = await record({
      type: 'npc',
      name: 'Old Maren',
      publicDescription: text('A keeper with salt-white hair.'),
      gmNotes: text('Secretly a cartographer'),
      tags: ['ally'],
    });
    lighthouse = await record({
      type: 'prop',
      name: 'Lighthouse lamp',
      publicDescription: text('Its glass is cracked. Tended by', keeper, secret),
      gmNotes: text('Hides a coded map'),
      tags: ['clue'],
    });
    const hiddenSpot = await record({
      type: 'spot',
      name: 'Sunken chapel',
      parentId: hiddenArea.id,
    });
    for (const revealed of [area, spot, keeper, lighthouse, hiddenSpot]) await reveal(revealed);
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

  async function reveal(target: { id: string }, revealed = true, c = campaign) {
    const action = revealed ? 'reveal' : 'unreveal';
    const response = await call(
      'POST',
      `/api/campaigns/${c.id}/records/${target.id}/${action}`,
      gm,
    );
    expect(response.statusCode, response.body).toBe(200);
  }

  const journal = (c = campaign) => `/api/campaigns/${c.id}/journal`;

  async function list(who: Person, query = '') {
    const response = await call('GET', `${journal()}/records${query}`, who);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<JournalRecordListResponse>().records;
  }

  async function notesOf(path: string, who: Person) {
    const response = await call('GET', `${path}/notes`, who);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PlayerNoteListResponse>().notes;
  }

  async function post(path: string, who: Person, body: string): Promise<PlayerNote> {
    const response = await call('POST', `${path}/notes`, who, { body });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<PlayerNote>();
  }

  describe('revealed records', () => {
    it('lists only revealed records, by name, with nothing private', async () => {
      const records = await list(player);
      expect(records.map((r) => r.name)).toEqual([
        'Cliff stairs',
        'Gull Coast',
        'Lighthouse lamp',
        'Old Maren',
        'Sunken chapel',
      ]);
      for (const r of records) {
        expect(Object.keys(r).sort()).toEqual(['id', 'name', 'parentName', 'revealedAt', 'type']);
      }
      // A Spot's Area is named only when players have that Area too.
      expect(records.find((r) => r.name === 'Cliff stairs')?.parentName).toBe('Gull Coast');
      expect(records.find((r) => r.name === 'Sunken chapel')?.parentName).toBeNull();
      const sent = JSON.stringify(records);
      for (const hidden of ['smuggler', 'Drowned', 'villain', 'ally', 'clue']) {
        expect(sent, hidden).not.toContain(hidden);
      }
    });

    it('filters by type', async () => {
      expect((await list(player, '?type=npc')).map((r) => r.name)).toEqual(['Old Maren']);
    });

    it('searches names and public descriptions, never tags or GM notes', async () => {
      expect((await list(player, '?q=salt')).map((r) => r.name)).toEqual(['Old Maren']);
      expect((await list(player, '?q=lamp')).map((r) => r.name)).toEqual(['Lighthouse lamp']);
      for (const privateWord of ['cartographer', 'coded', 'ally', 'clue']) {
        expect(await list(player, `?q=${privateWord}`), privateWord).toEqual([]);
      }
      // A hidden record's name is found only where the GM wrote it into public text, as here.
      expect((await list(player, '?q=smuggler')).map((r) => r.name)).toEqual(['Lighthouse lamp']);
    });

    it('reads a revealed record’s public layer, its hidden mentions as plain text', async () => {
      const response = await call('GET', `${journal()}/records/${lighthouse.id}`, player);
      expect(response.statusCode, response.body).toBe(200);
      const read = response.json<JournalRecord>();
      expect(Object.keys(read).sort()).toEqual([
        'id',
        'image',
        'name',
        'parentName',
        'publicDescription',
        'revealedAt',
        'type',
      ]);
      expect(read).toMatchObject({ type: 'prop', name: 'Lighthouse lamp', image: null });
      expect(read.publicDescription.content[0]).toEqual({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Its glass is cracked. Tended by' },
          { type: 'text', text: ' ' },
          { type: 'mention', attrs: { id: keeper.id, label: 'Old Maren' } },
          { type: 'text', text: ' ' },
          // The GM's words stay; the un-revealed record's id does not.
          { type: 'text', text: 'The smuggler queen' },
        ],
      });
      expect(response.body).not.toContain(secret.id);
      expect(response.body).not.toContain('coded');
    });

    it('answers 404 for a record that is not revealed, or not this campaign’s', async () => {
      const elsewhere = await record({ type: 'lore', name: 'Elsewhere' }, other);
      await reveal(elsewhere, true, other);
      for (const id of [secret.id, elsewhere.id, randomUUID()]) {
        const response = await call('GET', `${journal()}/records/${id}`, player);
        expect(response.statusCode, id).toBe(404);
        expect(response.json()).toMatchObject({ message: 'Record not found' });
      }
    });

    it('lets the GM read the journal too', async () => {
      expect((await list(gm)).map((r) => r.name)).toContain('Old Maren');
    });
  });

  describe('notes on records', () => {
    const lampPath = () => `${journal()}/records/${lighthouse.id}`;

    it('takes notes from players and the GM, newest first, with author and time', async () => {
      const first = await post(lampPath(), player, '  The glass hums\r\nat night.  ');
      expect(first).toMatchObject({
        body: 'The glass hums\nat night.',
        author: { userId: player.id, displayName: 'Journal Player' },
      });
      await post(lampPath(), gm, 'Noted by the GM');
      await post(lampPath(), otherPlayer, 'Smells of oil');

      const notes = await notesOf(lampPath(), player);
      expect(notes.map((n) => n.body)).toEqual([
        'Smells of oil',
        'Noted by the GM',
        'The glass hums\nat night.',
      ]);
      expect(notes.map((n) => n.author.displayName)).toEqual([
        'Second Player',
        'Journal GM',
        'Journal Player',
      ]);
    });

    it('refuses empty and too-long notes', async () => {
      for (const body of ['', '   ', 'x'.repeat(501)]) {
        const response = await call('POST', `${lampPath()}/notes`, player, { body });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      const extra = await call('POST', `${lampPath()}/notes`, player, { body: 'ok', pin: true });
      expect(extra.statusCode).toBe(400);
    });

    it('refuses notes on a record players do not have', async () => {
      const response = await call('POST', `${journal()}/records/${secret.id}/notes`, player, {
        body: 'I know',
      });
      expect(response.statusCode).toBe(404);
      expect((await call('GET', `${journal()}/records/${secret.id}/notes`, gm)).statusCode).toBe(
        404,
      );
    });

    it('lets only the author edit a note', async () => {
      const mine = await post(lampPath(), player, 'Draft');
      const notesUrl = `/api/campaigns/${campaign.id}/notes/${mine.id}`;

      for (const who of [otherPlayer, gm]) {
        const response = await call('PATCH', notesUrl, who, { body: 'Changed' });
        expect(response.statusCode).toBe(403);
      }
      const edited = await call('PATCH', notesUrl, player, { body: 'Final' });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(edited.json<PlayerNote>()).toMatchObject({ id: mine.id, body: 'Final' });
    });

    it('lets the author or the GM delete a note, and no one else', async () => {
      const mine = await post(lampPath(), player, 'Delete me');
      const theirs = await post(lampPath(), otherPlayer, 'GM removes this');
      const url = (note: PlayerNote) => `/api/campaigns/${campaign.id}/notes/${note.id}`;

      expect((await call('DELETE', url(mine), otherPlayer)).statusCode).toBe(403);
      expect((await call('DELETE', url(mine), player)).statusCode).toBe(204);
      expect((await call('DELETE', url(theirs), gm)).statusCode).toBe(204);

      const bodies = (await notesOf(lampPath(), player)).map((n) => n.body);
      expect(bodies).not.toContain('Delete me');
      expect(bodies).not.toContain('GM removes this');
    });

    it('hides a record’s notes while it is un-revealed, and brings them back', async () => {
      const kept = await post(`${journal()}/records/${keeper.id}`, player, 'Kind eyes');
      await reveal(keeper, false);

      expect(
        (await call('GET', `${journal()}/records/${keeper.id}/notes`, player)).statusCode,
      ).toBe(404);
      const patch = await call('PATCH', `/api/campaigns/${campaign.id}/notes/${kept.id}`, player, {
        body: 'Changed',
      });
      expect(patch.statusCode).toBe(404);

      await reveal(keeper);
      expect(
        (await notesOf(`${journal()}/records/${keeper.id}`, player)).map((n) => n.body),
      ).toEqual(['Kind eyes']);
    });

    it('answers 404 for another campaign’s note', async () => {
      const elsewhere = await record({ type: 'lore', name: 'Far shore' }, other);
      await reveal(elsewhere, true, other);
      const note = await post(`${journal(other)}/records/${elsewhere.id}`, gm, 'Theirs');

      const response = await call('DELETE', `/api/campaigns/${campaign.id}/notes/${note.id}`, gm);
      expect(response.statusCode).toBe(404);
    });

    it('deletes a record’s notes with it', async () => {
      const doomed = await record({ type: 'lore', name: 'Doomed rumour' });
      await reveal(doomed);
      const note = await post(`${journal()}/records/${doomed.id}`, player, 'Gone soon');

      const deleted = await call(
        'DELETE',
        `/api/campaigns/${campaign.id}/records/${doomed.id}`,
        gm,
      );
      expect(deleted.statusCode).toBe(204);
      const rows = await handle.db.select().from(playerNotes).where(eq(playerNotes.id, note.id));
      expect(rows).toEqual([]);
    });
  });

  describe('player entries', () => {
    let entry: PlayerEntry;

    it('lets a player make an entry, and refuses the GM', async () => {
      const response = await call('POST', `${journal()}/entries`, player, {
        title: '  Map of the caves ',
        description: 'Left at the fork,\r\nthen down.',
      });
      expect(response.statusCode, response.body).toBe(201);
      entry = response.json<PlayerEntry>();
      expect(entry).toMatchObject({
        title: 'Map of the caves',
        description: 'Left at the fork,\nthen down.',
        author: { userId: player.id, displayName: 'Journal Player' },
      });

      const byGm = await call('POST', `${journal()}/entries`, gm, { title: 'GM', description: '' });
      expect(byGm.statusCode).toBe(403);
    });

    it('refuses an empty title and a too-long description', async () => {
      for (const body of [
        { title: ' ', description: '' },
        { title: 'Long', description: 'x'.repeat(4001) },
        { title: 'x'.repeat(121), description: '' },
      ]) {
        const response = await call('POST', `${journal()}/entries`, player, body);
        expect(response.statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
      }
    });

    it('shows entries to every member, newest first', async () => {
      const second = await call('POST', `${journal()}/entries`, otherPlayer, {
        title: 'Tide times',
        description: '',
      });
      expect(second.statusCode).toBe(201);

      for (const who of [player, otherPlayer, gm]) {
        const response = await call('GET', `${journal()}/entries`, who);
        expect(response.statusCode).toBe(200);
        expect(response.json<PlayerEntryListResponse>().entries.map((e) => e.title)).toEqual([
          'Tide times',
          'Map of the caves',
        ]);
      }
      const one = await call('GET', `${journal()}/entries/${entry.id}`, gm);
      expect(one.json<PlayerEntry>()).toMatchObject({ title: 'Map of the caves' });
    });

    it('lets only the author change an entry', async () => {
      const url = `${journal()}/entries/${entry.id}`;
      for (const who of [otherPlayer, gm]) {
        expect((await call('PATCH', url, who, { title: 'Hijacked' })).statusCode).toBe(403);
      }
      const changed = await call('PATCH', url, player, { description: 'Right at the fork.' });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.json<PlayerEntry>()).toMatchObject({
        title: 'Map of the caves',
        description: 'Right at the fork.',
      });
      expect((await call('PATCH', url, player, {})).statusCode).toBe(400);
    });

    it('takes notes on an entry from anyone', async () => {
      const path = `${journal()}/entries/${entry.id}`;
      await post(path, otherPlayer, 'I copied this');
      await post(path, gm, 'Mostly right');
      expect((await notesOf(path, player)).map((n) => n.body)).toEqual([
        'Mostly right',
        'I copied this',
      ]);
    });

    it('lets the GM delete an entry, with its notes, and no other player', async () => {
      const url = `${journal()}/entries/${entry.id}`;
      expect((await call('DELETE', url, otherPlayer)).statusCode).toBe(403);
      expect((await call('DELETE', url, gm)).statusCode).toBe(204);
      expect((await call('GET', url, player)).statusCode).toBe(404);
      const rows = await handle.db
        .select()
        .from(playerNotes)
        .where(eq(playerNotes.entryId, entry.id));
      expect(rows).toEqual([]);
    });

    it('shows "Former player" once an author’s account is gone', async () => {
      const leaving = await (async () => {
        const cookie = await signIn(app, discordUser({ id: '17304', global_name: 'Leaving' }));
        const [row] = await handle.db.select().from(users).where(eq(users.discordId, '17304'));
        return { cookie, id: row?.id ?? '' };
      })();
      await handle.db
        .insert(campaignMembers)
        .values({ campaignId: campaign.id, userId: leaving.id, role: 'player' });
      const made = await call('POST', `${journal()}/entries`, leaving, {
        title: 'Last words',
        description: '',
      });
      const left = made.json<PlayerEntry>();
      await post(`${journal()}/records/${lighthouse.id}`, leaving, 'Farewell');

      await handle.db.delete(users).where(eq(users.id, leaving.id));

      const entry = await call('GET', `${journal()}/entries/${left.id}`, player);
      expect(entry.json<PlayerEntry>().author).toEqual({
        userId: null,
        displayName: 'Former player',
      });
      const farewell = (await notesOf(`${journal()}/records/${lighthouse.id}`, player)).find(
        (n) => n.body === 'Farewell',
      );
      expect(farewell?.author).toEqual({ userId: null, displayName: 'Former player' });
    });
  });

  describe('an archived campaign', () => {
    it('can be read but not written', async () => {
      const shelf = await newCampaign('Archived Journal');
      await handle.db
        .insert(campaignMembers)
        .values({ campaignId: shelf.id, userId: player.id, role: 'player' });
      const lore = await record({ type: 'lore', name: 'Old tale' }, shelf);
      await reveal(lore, true, shelf);
      const note = await post(`${journal(shelf)}/records/${lore.id}`, player, 'Before');
      const archived = await call('POST', `/api/campaigns/${shelf.id}/archive`, gm);
      expect(archived.statusCode).toBe(200);

      expect((await call('GET', `${journal(shelf)}/records`, player)).statusCode).toBe(200);
      const writes = [
        call('POST', `${journal(shelf)}/records/${lore.id}/notes`, player, { body: 'After' }),
        call('PATCH', `/api/campaigns/${shelf.id}/notes/${note.id}`, player, { body: 'After' }),
        call('DELETE', `/api/campaigns/${shelf.id}/notes/${note.id}`, player),
        call('POST', `${journal(shelf)}/entries`, player, { title: 'After', description: '' }),
      ];
      for (const response of await Promise.all(writes)) {
        expect(response.statusCode, response.body).toBe(409);
      }
    });
  });
});
