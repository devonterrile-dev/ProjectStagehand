/**
 * Leveling up (F4.9), against a real Postgres: the GM grants a level, the player (or the GM)
 * levels up with the shared rules, the refusals, the cards, the session log, and the GM undoing
 * the latest level-up exactly.
 */
import {
  LEVEL_UP_MESSAGES,
  type Campaign,
  type CharacterSheet,
  type PlayerCharacterSheet,
  type SessionLogResponse,
} from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import type { DbHandle } from '../db/client';
import { campaignMembers, users } from '../db/schema';

type Method = 'GET' | 'POST' | 'PATCH';

interface Person {
  cookie: string;
  id: string;
}

const TRAITS = { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 };

describe('Leveling up', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let player: Person;
  let other: Person;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('19501', 'Level GM');
    player = await person('19502', 'Level Player');
    other = await person('19503', 'Level Other');
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

  async function made<T>(method: Method, url: string, payload?: unknown, who = gm): Promise<T> {
    const response = await call(method, url, who, payload);
    expect(response.statusCode, `${method} ${url}: ${response.body}`).toBeLessThan(300);
    return response.json<T>();
  }

  const message = (response: { body: string }) =>
    (JSON.parse(response.body) as { message: string }).message;

  /** Vex: a level 1 Bard (Grace and Codex) holding Hold, with typed thresholds; Ash: no class. */
  async function world(name: string) {
    const campaign = await made<Campaign>('POST', '/api/campaigns', { name });
    const base = `/api/campaigns/${campaign.id}`;
    for (const who of [player, other]) {
      await handle.db
        .insert(campaignMembers)
        .values({ campaignId: campaign.id, userId: who.id, role: 'player' });
    }
    const domains = (
      await made<{ domains: { id: string; name: string }[] }>('GET', `${base}/domains`)
    ).domains;
    const domainId = (domainName: string) => domains.find((d) => d.name === domainName)?.id ?? '';
    const bard = await made<{ id: string }>('POST', `${base}/classes`, { name: 'Bard' });
    await made('PATCH', `${base}/classes/${bard.id}`, {
      domainIds: [domainId('Grace'), domainId('Codex')],
    });
    const troubadour = await made<{ id: string }>('POST', `${base}/subclasses`, {
      classId: bard.id,
      name: 'Troubadour',
    });
    const card = async (cardName: string, domain: string, level: number) =>
      (
        await made<{ id: string }>('POST', `${base}/domain-cards`, {
          domainId: domainId(domain),
          name: cardName,
          level,
        })
      ).id;
    const cards = {
      hold: await card('Hold', 'Grace', 1),
      inspire: await card('Inspire', 'Grace', 1),
      tome: await card('Tome', 'Codex', 2),
      anthem: await card('Anthem', 'Grace', 3),
      whirl: await card('Whirlwind', 'Blade', 1),
    };
    const vex = await made<{ id: string }>('POST', `${base}/characters`, {
      name: 'Vex',
      assignToUserId: player.id,
    });
    const ash = await made<{ id: string }>('POST', `${base}/characters`, {
      name: 'Ash',
      assignToUserId: other.id,
    });
    const url = `${base}/characters/${vex.id}`;
    await made('PATCH', url, {
      classId: bard.id,
      subclassId: troubadour.id,
      traits: TRAITS,
      hpMax: 6,
      hpCurrent: 6,
      evasion: 10,
      minorThreshold: 3,
      majorThreshold: 7,
      severeThreshold: 14,
    });
    await made('POST', `${url}/domain-cards`, { cardId: cards.hold });
    return { base, url, ashUrl: `${base}/characters/${ash.id}`, cards, grace: domainId('Grace') };
  }

  it('lets the GM grant one level at a time, to a PC with a class, below the last level', async () => {
    const { url, ashUrl } = await world('Level grant');
    expect((await call('POST', `${url}/grant-level`, player, { granted: true })).statusCode).toBe(
      403,
    );
    const granted = await made<CharacterSheet>('POST', `${url}/grant-level`, { granted: true });
    expect(granted.levelUp).toEqual({ granted: true, history: [] });
    const twice = await call('POST', `${url}/grant-level`, gm, { granted: true });
    expect(twice.statusCode).toBe(409);
    expect(message(twice)).toBe(LEVEL_UP_MESSAGES.alreadyGranted);
    expect(
      (await made<CharacterSheet>('POST', `${url}/grant-level`, { granted: false })).levelUp
        .granted,
    ).toBe(false);

    const noClass = await call('POST', `${ashUrl}/grant-level`, gm, { granted: true });
    expect(noClass.statusCode).toBe(400);
    expect(message(noClass)).toBe(LEVEL_UP_MESSAGES.needsClass);
    await made('PATCH', url, { level: 10 });
    const top = await call('POST', `${url}/grant-level`, gm, { granted: true });
    expect(message(top)).toBe(LEVEL_UP_MESSAGES.maxLevel);
  });

  it('levels up with the picks, cards and tier change, and the GM undoes it exactly', async () => {
    const { base, url, cards, grace } = await world('Level up');
    const first = {
      picks: [
        { tier: 2, option: 'traits', traits: ['agility', 'strength'] },
        { tier: 2, option: 'hp' },
      ],
      cardId: cards.tome,
      extraCardId: null,
      swap: null,
    };
    const ungranted = await call('POST', `${url}/level-up`, player, first);
    expect(message(ungranted)).toBe(LEVEL_UP_MESSAGES.noGrant);

    await made('POST', `${url}/grant-level`, { granted: true });
    expect((await call('POST', `${url}/level-up`, other, first)).statusCode).toBe(404);
    const two = await made<PlayerCharacterSheet>('POST', `${url}/level-up`, first, player);
    expect(two).toMatchObject({
      level: 2,
      hpMax: 7,
      hpCurrent: 7,
      proficiency: 2,
      minorThreshold: 4,
      majorThreshold: 8,
      severeThreshold: 15,
      traits: { ...TRAITS, agility: 3, strength: 2 },
    });
    expect(two.levelUp).toEqual({
      granted: false,
      history: [{ level: 2, picks: first.picks }],
    });
    expect(two.cards.loadout.map((card) => card.name)).toEqual(['Hold', 'Tome']);
    expect(two.cards.loadout.find((card) => card.name === 'Tome')?.takenAtLevel).toBe(2);

    // At level 3 the traits marked in tier 2 can't be raised again, and cards stay in bounds.
    await made('POST', `${url}/grant-level`, { granted: true });
    const third = {
      picks: [
        { tier: 2, option: 'domainCard' },
        { tier: 2, option: 'evasion' },
      ],
      cardId: cards.inspire,
      extraCardId: cards.anthem,
      swap: { outId: cards.hold, inId: cards.whirl },
    };
    const refusals: [Record<string, unknown>, string][] = [
      [
        {
          picks: [
            { tier: 2, option: 'traits', traits: ['agility', 'finesse'] },
            { tier: 2, option: 'hp' },
          ],
          extraCardId: null,
        },
        'That trait is already marked this tier',
      ],
      [{}, "Whirlwind isn't from your class's domains"],
    ];
    for (const [over, text] of refusals) {
      const response = await call('POST', `${url}/level-up`, player, { ...third, ...over });
      expect(response.statusCode, text).toBe(400);
      expect(message(response)).toBe(text);
    }
    const blocked = await call('POST', `${url}/level-up`, player, {
      ...third,
      swap: { outId: cards.hold, inId: cards.tome },
    });
    expect(message(blocked)).toBe('Tome is already on your sheet');

    // The GM swaps Hold for a fresh card and takes Anthem as the extra one.
    const fresh = await made<{ id: string }>('POST', `${base}/domain-cards`, {
      domainId: grace,
      name: 'Fresh',
      level: 1,
    });
    const three = await made<CharacterSheet>('POST', `${url}/level-up`, {
      ...third,
      swap: { outId: cards.hold, inId: fresh.id },
    });
    expect(three).toMatchObject({ level: 3, evasion: 11, proficiency: 2 });
    const held = [...three.cards.loadout, ...three.cards.vault].map((card) => card.name).sort();
    expect(held).toEqual(['Anthem', 'Fresh', 'Inspire', 'Tome']);
    expect(three.cards.loadout.find((card) => card.name === 'Fresh')?.takenAtLevel).toBe(3);

    expect((await call('POST', `${url}/level-ups/undo`, player)).statusCode).toBe(403);
    const undone = await made<CharacterSheet>('POST', `${url}/level-ups/undo`);
    expect(undone).toMatchObject({ level: 2, evasion: 10, proficiency: 2, hpMax: 7 });
    expect(undone.levelUp.granted).toBe(true);
    expect(
      [...undone.cards.loadout, ...undone.cards.vault].map((card) => card.name).sort(),
    ).toEqual(['Hold', 'Tome']);
    const back = await made<CharacterSheet>('POST', `${url}/level-ups/undo`);
    expect(back).toMatchObject({
      level: 1,
      hpMax: 6,
      proficiency: 1,
      majorThreshold: 7,
      traits: TRAITS,
    });
    expect(back.levelUp).toEqual({ granted: true, history: [] });
    const none = await call('POST', `${url}/level-ups/undo`, gm);
    expect(message(none)).toBe(LEVEL_UP_MESSAGES.noLevelUp);
  });

  it('completes a two-mark option taken twice at one level-up', async () => {
    const { url, cards } = await world('Level two marks');
    await made('PATCH', url, { level: 4 });
    await made('POST', `${url}/grant-level`, { granted: true });
    const five = await made<CharacterSheet>('POST', `${url}/level-up`, {
      picks: [
        { tier: 3, option: 'proficiency' },
        { tier: 3, option: 'proficiency' },
      ],
      cardId: cards.tome,
      extraCardId: null,
      swap: null,
    });
    // Entering tier 3 adds one; the completed option adds another.
    expect(five).toMatchObject({ level: 5, proficiency: 3 });
  });

  it('logs a level-up while a session runs', async () => {
    const { base, url, cards } = await world('Level log');
    await made('POST', `${base}/play-session`);
    await made('POST', `${url}/grant-level`, { granted: true });
    await made(
      'POST',
      `${url}/level-up`,
      {
        picks: [
          { tier: 2, option: 'stress' },
          { tier: 2, option: 'hopeBonus' },
        ],
        cardId: cards.inspire,
        extraCardId: null,
        swap: null,
      },
      player,
    );
    const log = await made<SessionLogResponse>('GET', `${base}/play-session/log`);
    expect(log.entries.map((entry) => entry.text)).toContain('Vex reached level 2');
  });
});
