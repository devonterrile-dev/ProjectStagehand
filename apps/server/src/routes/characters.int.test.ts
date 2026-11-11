/**
 * Character sheets API (F1.4a), against a real Postgres. Route-level isolation with random
 * ids is in the table in `campaigns.int.test.ts`; this file covers the sheet itself, the
 * player's own-sheet view (the allow-list), validation against the ruleset, deleting, and
 * PC ids from another campaign.
 */
import {
  emptyRichText,
  PLAYER_CHARACTER_SHEET_KEYS,
  type Campaign,
  type Character,
  type CharacterSheet,
  type MemberListResponse,
} from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import { FULL_SHEET_PATCH, richText } from '../../test/record-fixtures';
import type { DbHandle } from '../db/client';
import { campaignMembers, characters, users } from '../db/schema';

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

const NOT_FOUND = { error: 'Not Found', message: 'Character not found' };
/** Written into the GM's notes; must never reach a player's response. */
const SENTINEL = 'GM-ONLY-SENTINEL-7f3a';

describe('Character sheets API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let player: Person;
  let otherPlayer: Person;
  /** The campaign most tests use; both players are members. */
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
    gm = await person('5001', 'Sheets GM');
    player = await person('5002', 'Sheets Player');
    otherPlayer = await person('5003', 'Sheets Other Player');
    campaign = await newCampaign('Sheets Campaign');
    other = await newCampaign('Other Sheets Campaign');
    for (const who of [player, otherPlayer]) {
      await handle.db
        .insert(campaignMembers)
        .values({ campaignId: campaign.id, userId: who.id, role: 'player' });
    }
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

  const base = (c: Campaign) => `/api/campaigns/${c.id}/characters`;

  async function newPc(name: string, assignTo?: Person, c = campaign): Promise<Character> {
    const body = assignTo === undefined ? { name } : { name, assignToUserId: assignTo.id };
    const response = await call('POST', base(c), gm, body);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    return response.json<Character>();
  }

  const get = (id: string, who = gm, c = campaign) => call('GET', `${base(c)}/${id}`, who);
  const patch = (id: string, body: unknown, who = gm, c = campaign) =>
    call('PATCH', `${base(c)}/${id}`, who, body);
  const remove = (id: string, who = gm, c = campaign) => call('DELETE', `${base(c)}/${id}`, who);

  async function sheetOf(id: string): Promise<CharacterSheet> {
    const response = await get(id);
    expect(response.statusCode).toBe(200);
    return response.json<CharacterSheet>();
  }

  async function patched(id: string, body: unknown): Promise<CharacterSheet> {
    const response = await patch(id, body);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    return response.json<CharacterSheet>();
  }

  /** The first validation issue of a 400. */
  async function refused(id: string, body: unknown): Promise<{ path: string; message: string }> {
    const response = await patch(id, body);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(400);
    const { issues } = response.json<{ issues: { path: string; message: string }[] }>();
    return issues[0] ?? { path: '', message: '' };
  }

  async function assign(who: Person, characterId: string | null): Promise<void> {
    const response = await call(
      'PUT',
      `/api/campaigns/${campaign.id}/members/${who.id}/character`,
      gm,
      { characterId },
    );
    expect(response.statusCode).toBe(204);
  }

  describe('a new PC', () => {
    it('starts as a blank sheet with every trait at 0', async () => {
      const pc = await newPc('Blank Slate');
      expect(await sheetOf(pc.id)).toMatchObject({
        id: pc.id,
        name: 'Blank Slate',
        assignedToUserId: null,
        level: 1,
        className: '',
        publicDescription: emptyRichText(),
        gmNotes: emptyRichText(),
        traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
        evasion: 0,
        hpMax: 0,
        hpCurrent: 0,
        hope: 0,
        proficiency: 1,
        experiences: [],
        weapons: { primary: null, secondary: null, inventory: [] },
        armor: null,
        inventory: [],
        gold: { handfuls: 0, bags: 0, chests: 0 },
        classFeature: null,
        combatOptions: [],
      });
    });

    it('reads cleanly when inserted with only a name (a PC from before F1.4)', async () => {
      const [row] = await handle.db
        .insert(characters)
        .values({ campaignId: campaign.id, name: 'Old Timer' })
        .returning({ id: characters.id });
      const sheet = await sheetOf(row?.id ?? '');
      expect(sheet).toMatchObject({ name: 'Old Timer', level: 1, armor: null });
      expect(Object.keys(sheet.traits)).toHaveLength(6);
    });
  });

  describe('updating', () => {
    it('stores every key and returns the whole sheet', async () => {
      const pc = await newPc('Full Sheet');
      const sheet = await patched(pc.id, FULL_SHEET_PATCH);
      expect(sheet).toMatchObject(FULL_SHEET_PATCH);
      expect(await sheetOf(pc.id)).toEqual(sheet);
    });

    it('changes only the keys sent, and replaces lists and sections whole', async () => {
      const pc = await newPc('Partial');
      await patched(pc.id, FULL_SHEET_PATCH);

      const sheet = await patched(pc.id, {
        evasion: 12,
        experiences: [{ name: 'Gambler', bonus: 1 }],
        weapons: { primary: null, secondary: null, inventory: [] },
      });
      expect(sheet.evasion).toBe(12);
      expect(sheet.experiences).toEqual([{ name: 'Gambler', bonus: 1 }]);
      expect(sheet.weapons).toEqual({ primary: null, secondary: null, inventory: [] });
      expect(sheet.hpCurrent).toBe(FULL_SHEET_PATCH.hpCurrent);
      expect(sheet.gmNotes).toEqual(FULL_SHEET_PATCH.gmNotes);
    });

    it('removes armor and the class feature with null', async () => {
      const pc = await newPc('Unarmored');
      await patched(pc.id, FULL_SHEET_PATCH);
      const sheet = await patched(pc.id, { armor: null, classFeature: null });
      expect(sheet).toMatchObject({ armor: null, classFeature: null });
    });

    it.each([
      [
        'a trait out of range',
        { traits: { ...FULL_SHEET_PATCH.traits, agility: 3 } },
        'traits.agility',
      ],
      ['a trait not in the ruleset', { traits: { ...FULL_SHEET_PATCH.traits, luck: 1 } }, 'traits'],
      ['a missing trait', { traits: { agility: 1 } }, 'traits.strength'],
      ['Hope above the ruleset max', { hope: 7 }, 'hope'],
      ['HP above HP max in one patch', { hpMax: 3, hpCurrent: 4 }, 'hpCurrent'],
      [
        'marked slots above the slots',
        { armorSlotsMax: 1, armorSlotsMarked: 2 },
        'armorSlotsMarked',
      ],
      ['a negative number', { evasion: -1 }, 'evasion'],
      ['a fraction', { evasion: 1.5 }, 'evasion'],
      ['level 0', { level: 0 }, 'level'],
      ['null on a number', { hpMax: null }, 'hpMax'],
      ['null on a list', { experiences: null }, 'experiences'],
      [
        'bad damage dice',
        {
          weapons: {
            ...FULL_SHEET_PATCH.weapons,
            inventory: [{ ...FULL_SHEET_PATCH.weapons.inventory[0], damageDice: '1d7' }],
          },
        },
        'weapons.inventory.0.damageDice',
      ],
      [
        'a weapon trait not in the ruleset',
        {
          weapons: {
            ...FULL_SHEET_PATCH.weapons,
            primary: { ...FULL_SHEET_PATCH.weapons.primary, trait: 'luck' },
          },
        },
        'weapons.primary.trait',
      ],
      ['an unknown key', { assignedToUserId: null }, ''],
      ['an empty patch', {}, ''],
    ])('refuses %s with 400', async (_, body, path) => {
      const pc = await newPc('Validated');
      expect((await refused(pc.id, body)).path).toBe(path);
    });

    it('checks current values against the stored maximums', async () => {
      const pc = await newPc('Wounded');
      await patched(pc.id, { hpMax: 6, hpCurrent: 6, stressMax: 4, stressCurrent: 1 });

      expect(await refused(pc.id, { hpCurrent: 7 })).toEqual({
        path: 'hpCurrent',
        message: "Can't be above HP max (6)",
      });
      expect(await refused(pc.id, { hpMax: 5 })).toEqual({
        path: 'hpMax',
        message: "Can't be below current HP (6); lower that first",
      });
      expect(await refused(pc.id, { stressMax: 0 })).toMatchObject({ path: 'stressMax' });

      const lowered = await patched(pc.id, { hpMax: 5, hpCurrent: 5 });
      expect(lowered).toMatchObject({ hpMax: 5, hpCurrent: 5 });
    });

    it('has no ordering rule for damage thresholds', async () => {
      const pc = await newPc('Odd Thresholds');
      const sheet = await patched(pc.id, { minorThreshold: 9, majorThreshold: 2 });
      expect(sheet).toMatchObject({ minorThreshold: 9, majorThreshold: 2 });
    });

    it('refuses every write on an archived campaign but still reads', async () => {
      const shelf = await newCampaign('Archived Sheets');
      const pc = await newPc('Retired', undefined, shelf);
      expect((await call('POST', `/api/campaigns/${shelf.id}/archive`, gm)).statusCode).toBe(200);

      const archived = { statusCode: 409, message: 'Campaign is archived' };
      expect((await patch(pc.id, { level: 2 }, gm, shelf)).json()).toMatchObject(archived);
      expect((await remove(pc.id, gm, shelf)).json()).toMatchObject(archived);
      expect((await get(pc.id, gm, shelf)).statusCode).toBe(200);
    });
  });

  describe("a player's own sheet", () => {
    let mine: Character;
    let theirs: Character;

    beforeAll(async () => {
      mine = await newPc('Mine', player);
      theirs = await newPc('Theirs', otherPlayer);
      await patched(mine.id, { ...FULL_SHEET_PATCH, gmNotes: richText(SENTINEL) });
    });

    it('comes through the allow-list: exactly the public keys, no GM notes', async () => {
      const response = await get(mine.id, player);
      expect(response.statusCode).toBe(200);

      const body = response.json<Record<string, unknown>>();
      expect(Object.keys(body).sort()).toEqual([...PLAYER_CHARACTER_SHEET_KEYS].sort());
      expect(body).not.toHaveProperty('gmNotes');
      expect(body).not.toHaveProperty('assignedToUserId');
      expect(response.body).not.toContain(SENTINEL);
      expect(body).toMatchObject({
        name: 'Vex Tidecaller',
        hope: 4,
        traits: FULL_SHEET_PATCH.traits,
      });
    });

    it("hides every other PC behind 404: another player's, unassigned, another campaign's", async () => {
      const unassigned = await newPc('Spare');
      const foreign = await newPc('Abroad', undefined, other);
      for (const id of [theirs.id, unassigned.id, foreign.id]) {
        const response = await get(id, player);
        expect(response.statusCode, id).toBe(404);
        expect(response.json()).toMatchObject(NOT_FOUND);
      }
    });

    it('loses access to a PC once it moves to someone else', async () => {
      const passed = await newPc('Passed On', player);
      expect((await get(passed.id, player)).statusCode).toBe(200);

      await assign(otherPlayer, passed.id);
      expect((await get(passed.id, player)).statusCode).toBe(404);
      expect((await get(passed.id, otherPlayer)).statusCode).toBe(200);

      // Give the players their original PCs back for the other tests.
      await assign(player, mine.id);
      await assign(otherPlayer, theirs.id);
    });

    it('cannot be edited or deleted by the player', async () => {
      expect((await patch(mine.id, { hope: 6 }, player)).statusCode).toBe(403);
      expect((await remove(mine.id, player)).statusCode).toBe(403);
      expect((await sheetOf(mine.id)).hope).toBe(FULL_SHEET_PATCH.hope);
    });
  });

  describe('deleting', () => {
    it('deletes the PC and leaves its player in the campaign without one', async () => {
      const pc = await newPc('Doomed', otherPlayer);
      const response = await remove(pc.id);
      expect(response.statusCode).toBe(204);
      expect((await get(pc.id)).statusCode).toBe(404);

      const roster = await call('GET', `/api/campaigns/${campaign.id}/members`, gm);
      const member = roster
        .json<MemberListResponse>()
        .members.find((m) => m.userId === otherPlayer.id);
      expect(member).toMatchObject({ role: 'player', character: null });
    });
  });

  describe('isolation of character ids', () => {
    it("can't reach another campaign's PC through its own campaign", async () => {
      const foreign = await newPc('Foreign', undefined, other);
      for (const response of [
        await get(foreign.id),
        await patch(foreign.id, { name: 'Hijacked' }),
        await remove(foreign.id),
      ]) {
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject(NOT_FOUND);
      }
      expect((await get(foreign.id, gm, other)).json()).toMatchObject({ name: 'Foreign' });

      for (const id of ['not-a-uuid', '1', '00000000-0000-4000-8000-000000000009']) {
        expect((await get(id)).statusCode, id).toBe(404);
        expect((await patch(id, { name: 'X' })).statusCode, id).toBe(404);
        expect((await remove(id)).statusCode, id).toBe(404);
      }
    });
  });

  describe('database rules', () => {
    let id: string;

    beforeAll(async () => {
      id = (await newPc('Raw Rules')).id;
    });

    const rawUpdate = (values: Partial<typeof characters.$inferInsert>) =>
      failureOf(handle.db.update(characters).set(values).where(eq(characters.id, id)));

    it.each([
      ['HP above HP max', { hpMax: 2, hpCurrent: 3 }],
      ['Stress above Stress max', { stressMax: 2, stressCurrent: 3 }],
      ['marked slots above the slots', { armorSlotsMax: 1, armorSlotsMarked: 2 }],
      ['a negative number', { evasion: -1 }],
      ['level 0', { level: 0 }],
      ['a long class name', { className: 'x'.repeat(81) }],
    ])('refuses %s (check constraint)', async (_, values) => {
      expect(pgCode(await rawUpdate(values))).toBe('23514');
    });
  });
});
