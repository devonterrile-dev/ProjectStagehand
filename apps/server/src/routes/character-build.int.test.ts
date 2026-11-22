/**
 * The character creation guide (F4.8), against a real Postgres: a new PC waits for it; its player
 * (or the GM) builds it, with every value set as §9 says; the refusals; the starting gear modes;
 * the GM sending a PC through it again; and the starting gear setting itself.
 */
import {
  BUILD_MESSAGES,
  traitSpreadMessage,
  rulesetFor,
  type Campaign,
  type CharacterSheet,
  type PlayerCharacterSheet,
  type StartingGear,
} from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import { KIT_NOT_FIT } from '../campaigns/starting-gear';
import type { DbHandle } from '../db/client';
import { campaignMembers, users } from '../db/schema';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Person {
  cookie: string;
  id: string;
}

const SPREAD = { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 };
const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
const KIT = {
  primaryWeaponId: null,
  secondaryWeaponId: null,
  armorId: null,
  items: [],
  gold: { handfuls: 0, bags: 0, chests: 0 },
};

describe('The character creation guide', () => {
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
    gm = await person('19301', 'Guide GM');
    player = await person('19302', 'Guide Player');
    other = await person('19303', 'Guide Other');
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

  /** A campaign with Vex (the player's new PC), Ash (the other's) and records to build from. */
  async function world(name: string) {
    const campaign = await made<Campaign>('POST', '/api/campaigns', { name });
    const base = `/api/campaigns/${campaign.id}`;
    for (const who of [player, other]) {
      await handle.db
        .insert(campaignMembers)
        .values({ campaignId: campaign.id, userId: who.id, role: 'player' });
    }
    const vex = await made<{ id: string }>('POST', `${base}/characters`, {
      name: 'Vex',
      assignToUserId: player.id,
    });
    const ash = await made<{ id: string }>('POST', `${base}/characters`, {
      name: 'Ash',
      assignToUserId: other.id,
    });
    const domains = (
      await made<{ domains: { id: string; name: string }[] }>('GET', `${base}/domains`)
    ).domains;
    const domainId = (domainName: string) => domains.find((d) => d.name === domainName)?.id ?? '';

    const bard = await made<{ id: string }>('POST', `${base}/classes`, { name: 'Bard' });
    await made('PATCH', `${base}/classes/${bard.id}`, {
      domainIds: [domainId('Grace'), domainId('Codex')],
      startingEvasion: 9,
      startingHp: 5,
    });
    const troubadour = await made<{ id: string }>('POST', `${base}/subclasses`, {
      classId: bard.id,
      name: 'Troubadour',
    });
    const guardian = await made<{ id: string }>('POST', `${base}/classes`, { name: 'Guardian' });
    const stalwart = await made<{ id: string }>('POST', `${base}/subclasses`, {
      classId: guardian.id,
      name: 'Stalwart',
    });
    const faerie = await made<{ id: string }>('POST', `${base}/species`, { name: 'Faerie' });
    const orc = await made<{ id: string }>('POST', `${base}/species`, { name: 'Orc' });
    const weapon = async (body: Record<string, unknown>) =>
      (await made<{ id: string }>('POST', `${base}/weapons`, body)).id;
    const armor = async (body: Record<string, unknown>) =>
      (await made<{ id: string }>('POST', `${base}/armor`, body)).id;
    const card = async (cardName: string, domain: string, level: number) =>
      (
        await made<{ id: string }>('POST', `${base}/domain-cards`, {
          domainId: domainId(domain),
          name: cardName,
          level,
        })
      ).id;
    return {
      campaign,
      base,
      vex: vex.id,
      ash: ash.id,
      bard: bard.id,
      troubadour: troubadour.id,
      guardian: guardian.id,
      stalwart: stalwart.id,
      faerie: faerie.id,
      orc: orc.id,
      rapier: await weapon({ name: 'Rapier', trait: 'presence', damageDie: 8 }),
      greatsword: await weapon({ name: 'Greatsword', burden: 'two_handed', damageDie: 10 }),
      dagger: await weapon({ name: 'Parrying dagger', slot: 'secondary' }),
      halberd: await weapon({ name: 'Halberd', tier: 2 }),
      leather: await armor({
        name: 'Leather',
        baseMajorThreshold: 6,
        baseSevereThreshold: 13,
        baseScore: 3,
      }),
      plate: await armor({ name: 'Plate', tier: 2 }),
      inspire: await card('Inspire', 'Grace', 1),
      tome: await card('Tome', 'Codex', 1),
      mesmerize: await card('Mesmerize', 'Grace', 2),
      whirl: await card('Whirlwind', 'Blade', 1),
    };
  }
  type World = Awaited<ReturnType<typeof world>>;

  /** A complete Default-mode build for Vex, with `over` changed. */
  const picks = (w: World, over: Record<string, unknown> = {}) => ({
    name: 'Vex the Bold',
    publicDescription: EMPTY_DOC,
    classId: w.bard,
    subclassId: w.troubadour,
    speciesIds: [w.faerie, w.orc],
    traits: SPREAD,
    gear: {
      primaryWeaponId: w.rapier,
      secondaryWeaponId: w.dagger,
      armorId: w.leather,
      potion: 'stamina',
    },
    cardIds: [w.inspire, w.tome],
    ...over,
  });

  it('builds a new PC from the guide, setting every value and keeping what the GM wrote', async () => {
    const w = await world('Guide build');
    const url = `${w.base}/characters/${w.vex}`;
    const before = await made<PlayerCharacterSheet>('GET', url, undefined, player);
    expect(before.needsGuide).toBe(true);
    expect(before.builtAt).toBeNull();

    await made('PATCH', url, {
      inventory: [{ name: 'Old coin', detail: '' }],
      gold: { handfuls: 2, bags: 0, chests: 0 },
      experiences: [{ name: 'Sailor', bonus: 2 }],
      className: 'Typed',
    });
    await made('POST', `${url}/domain-cards`, { cardId: w.whirl });

    const built = await call('POST', `${url}/build`, player, picks(w));
    expect(built.statusCode, built.body).toBe(200);
    const sheet = built.json<PlayerCharacterSheet>();
    expect(sheet).toMatchObject({
      name: 'Vex the Bold',
      needsGuide: false,
      level: 1,
      proficiency: 1,
      evasion: 9,
      hpMax: 5,
      hpCurrent: 5,
      stressMax: 6,
      stressCurrent: 0,
      hope: rulesetFor(2).start?.hope,
      traits: SPREAD,
      className: '',
      experiences: [{ name: 'Sailor', bonus: 2 }],
      links: {
        classId: w.bard,
        subclassId: w.troubadour,
        subclassCards: 1,
        speciesIds: [w.faerie, w.orc],
        primaryWeaponId: w.rapier,
        secondaryWeaponId: w.dagger,
        armorId: w.leather,
      },
    });
    expect(sheet.builtAt).not.toBeNull();
    expect(sheet.built.className).toBe('Bard');
    expect(sheet.built.thresholds).toEqual({ minor: null, major: 7, severe: 14 });
    expect(sheet.inventory.map((item) => item.name)).toEqual([
      'Old coin',
      'Torch',
      '50 feet of rope',
      'Basic supplies',
      'Minor Stamina Potion',
    ]);
    expect(sheet.gold).toEqual({ handfuls: 3, bags: 0, chests: 0 });
    expect(sheet.cards.loadout.map((card) => card.name)).toEqual(['Inspire', 'Tome']);
    expect(sheet.cards.vault).toEqual([]);

    const again = await call('POST', `${url}/build`, player, picks(w));
    expect(again.statusCode).toBe(409);
    expect(again.json<{ message: string }>().message).toBe(BUILD_MESSAGES.alreadyBuilt);
  });

  it('lets the GM build for a player, not another player, and not while archived', async () => {
    const w = await world('Guide who');
    const vexUrl = `${w.base}/characters/${w.vex}`;
    expect((await call('POST', `${vexUrl}/build`, other, picks(w))).statusCode).toBe(404);
    const byGm = await call('POST', `${vexUrl}/build`, gm, picks(w));
    expect(byGm.statusCode, byGm.body).toBe(200);
    expect(byGm.json<CharacterSheet>().needsGuide).toBe(false);

    await made('POST', `${w.base}/archive`);
    const archived = await call('POST', `${w.base}/characters/${w.ash}/build`, other, picks(w));
    expect(archived.statusCode).toBe(409);
  });

  it('refuses picks the rules do not allow, and leaves the PC waiting', async () => {
    const w = await world('Guide refusals');
    const url = `${w.base}/characters/${w.vex}/build`;
    const gear = picks(w).gear;
    const cases: [Record<string, unknown>, number, string][] = [
      [{ subclassId: w.stalwart }, 400, BUILD_MESSAGES.subclassOfClass],
      [{ traits: { ...SPREAD, knowledge: 0 } }, 400, traitSpreadMessage(rulesetFor(2))],
      [{ gear: { ...gear, primaryWeaponId: w.halberd } }, 400, BUILD_MESSAGES.primary],
      [{ gear: { ...gear, primaryWeaponId: w.greatsword } }, 400, BUILD_MESSAGES.twoHanded],
      [{ gear: { ...gear, armorId: w.plate } }, 400, BUILD_MESSAGES.armor],
      [{ gear: null }, 400, BUILD_MESSAGES.gearNeeded],
      [{ cardIds: [w.inspire] }, 400, 'Pick 2 different domain cards'],
      [{ cardIds: [w.inspire, w.mesmerize] }, 400, 'Mesmerize is level 2: pick level 1 cards'],
      [{ cardIds: [w.inspire, w.whirl] }, 400, "Whirlwind isn't from your class's domains"],
      [{ classId: w.campaign.id }, 404, 'Class not found'],
    ];
    for (const [over, status, message] of cases) {
      const response = await call('POST', url, player, picks(w, over));
      expect(response.statusCode, JSON.stringify(over)).toBe(status);
      expect(response.json<{ message: string }>().message).toBe(message);
    }
    const sheet = await made<PlayerCharacterSheet>(
      'GET',
      `${w.base}/characters/${w.vex}`,
      undefined,
      player,
    );
    expect(sheet.needsGuide).toBe(true);
  });

  it("gives the GM's kit in the Set mode and nothing in None, unarmored without armor", async () => {
    const w = await world('Guide modes');
    await made('PUT', `${w.base}/starting-gear`, {
      mode: 'set',
      kit: {
        ...KIT,
        primaryWeaponId: w.greatsword,
        items: [{ name: 'Lute', detail: 'Worn' }],
        gold: { handfuls: 0, bags: 1, chests: 0 },
      },
    });
    const vexUrl = `${w.base}/characters/${w.vex}/build`;
    const picked = await call('POST', vexUrl, player, picks(w));
    expect(picked.statusCode).toBe(400);
    expect(picked.json<{ message: string }>().message).toBe(BUILD_MESSAGES.noGearToPick);

    const vex = await made<PlayerCharacterSheet>('POST', vexUrl, picks(w, { gear: null }), player);
    expect(vex.links).toMatchObject({
      primaryWeaponId: w.greatsword,
      secondaryWeaponId: null,
      armorId: null,
    });
    expect(vex.built.thresholds).toEqual({ minor: null, major: 1, severe: 2 });
    expect(vex.built.armorScore).toBe(0);
    expect(vex.inventory).toEqual([{ name: 'Lute', detail: 'Worn' }]);
    expect(vex.gold).toEqual({ handfuls: 0, bags: 1, chests: 0 });

    await made('PUT', `${w.base}/starting-gear`, { mode: 'none', kit: KIT });
    const ash = await made<PlayerCharacterSheet>(
      'POST',
      `${w.base}/characters/${w.ash}/build`,
      picks(w, { gear: null, speciesIds: [w.orc, null] }),
      other,
    );
    expect(ash.links).toMatchObject({
      primaryWeaponId: null,
      secondaryWeaponId: null,
      armorId: null,
      speciesIds: [w.orc, null],
    });
    expect(ash.inventory).toEqual([]);
  });

  it('lets the GM send a PC through the guide again, and take it back', async () => {
    const w = await world('Guide reset');
    const url = `${w.base}/characters/${w.vex}`;
    await made('POST', `${url}/build`, picks(w), player);
    expect((await call('POST', `${url}/guide`, player, { needsGuide: true })).statusCode).toBe(403);

    const reset = await made<CharacterSheet>('POST', `${url}/guide`, { needsGuide: true });
    expect(reset.needsGuide).toBe(true);
    // Nothing else changes until the guide finishes again.
    expect(reset.links.classId).toBe(w.bard);
    const back = await made<CharacterSheet>('POST', `${url}/guide`, { needsGuide: false });
    expect(back.needsGuide).toBe(false);

    await made('POST', `${url}/guide`, { needsGuide: true });
    const rebuilt = await made<PlayerCharacterSheet>(
      'POST',
      `${url}/build`,
      picks(w, { gear: { ...picks(w).gear, potion: 'health' } }),
      player,
    );
    // Starting items are added again, on top of the first build's.
    expect(rebuilt.inventory.filter((item) => item.name === 'Torch')).toHaveLength(2);
    expect(rebuilt.inventory.at(-1)?.name).toBe('Minor Health Potion');
    expect(rebuilt.gold.handfuls).toBe(2);
  });

  it('reads and sets the starting gear, checks the kit, and copies it with the records', async () => {
    const w = await world('Guide gear');
    const url = `${w.base}/starting-gear`;
    expect(await made<StartingGear>('GET', url, undefined, player)).toEqual({
      mode: 'default',
      kit: KIT,
    });
    expect((await call('PUT', url, player, { mode: 'none', kit: KIT })).statusCode).toBe(403);

    const wrongSlot = await call('PUT', url, gm, {
      mode: 'set',
      kit: { ...KIT, primaryWeaponId: w.dagger },
    });
    expect(wrongSlot.json<{ message: string }>().message).toBe(KIT_NOT_FIT.primary);
    const twoHands = await call('PUT', url, gm, {
      mode: 'set',
      kit: { ...KIT, primaryWeaponId: w.greatsword, secondaryWeaponId: w.dagger },
    });
    expect(twoHands.json<{ message: string }>().message).toBe(KIT_NOT_FIT.twoHanded);

    const kit = {
      ...KIT,
      primaryWeaponId: w.rapier,
      secondaryWeaponId: w.dagger,
      armorId: w.leather,
    };
    expect(await made<StartingGear>('PUT', url, { mode: 'set', kit })).toEqual({
      mode: 'set',
      kit,
    });

    const copy = await made<Campaign>('POST', '/api/campaigns', {
      name: 'Guide gear copy',
      copyGameplayFrom: w.campaign.id,
    });
    const copied = await made<StartingGear>('GET', `/api/campaigns/${copy.id}/starting-gear`);
    expect(copied.mode).toBe('set');
    expect(copied.kit.primaryWeaponId).not.toBeNull();
    expect(copied.kit.primaryWeaponId).not.toBe(w.rapier);

    expect((await call('DELETE', `${w.base}/weapons/${w.dagger}`, gm)).statusCode).toBe(204);
    expect((await made<StartingGear>('GET', url)).kit.secondaryWeaponId).toBeNull();
  });
});
