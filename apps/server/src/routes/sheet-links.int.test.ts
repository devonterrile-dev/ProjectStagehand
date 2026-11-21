/**
 * Sheets linked to gameplay records (F4.7), against a real Postgres: linking each part and the
 * refusals, the built values in the GM's and the player's view, domain cards (add, remove, move,
 * Stress, a full loadout), and records a sheet uses refusing to be deleted. Rest and rolls with
 * gear bonuses are in `play/socket.int.test.ts`.
 */
import {
  LOADOUT_FULL,
  noGearBonuses,
  SUGGESTION_NOT_FIT,
  type Campaign,
  type CharacterSheet,
  type PlayerCharacterSheet,
} from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import { NOT_A_PRIMARY, NOT_A_SECONDARY, SUBCLASS_OF_CLASS } from '../campaigns/sheet-links';
import type { DbHandle } from '../db/client';
import { campaignMembers, users } from '../db/schema';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface Person {
  cookie: string;
  id: string;
}

describe('Sheets linked to gameplay records', () => {
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
    gm = await person('19201', 'Link GM');
    player = await person('19202', 'Link Player');
    other = await person('19203', 'Other Player');
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

  /** A campaign with Vex (the player's PC), Ash (the other player's), and records to link. */
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
      hopeFeature: { name: 'Make a Scene', cost: 3, text: 'Distract a target.' },
      classFeatures: [{ name: 'Rally', text: 'Give Rally Dice.' }],
    });
    const troubadour = await made<{ id: string }>('POST', `${base}/subclasses`, {
      classId: bard.id,
      name: 'Troubadour',
    });
    await made('PATCH', `${base}/subclasses/${troubadour.id}`, {
      spellcastTrait: 'presence',
      foundation: [{ name: 'Gifted Performer', text: 'Play songs.' }],
      specialization: [{ name: 'Maestro', text: 'More songs.' }],
    });
    const guardian = await made<{ id: string }>('POST', `${base}/classes`, { name: 'Guardian' });
    const stalwart = await made<{ id: string }>('POST', `${base}/subclasses`, {
      classId: guardian.id,
      name: 'Stalwart',
    });
    const faerie = await made<{ id: string }>('POST', `${base}/species`, { name: 'Faerie' });
    await made('PATCH', `${base}/species/${faerie.id}`, {
      features: [
        { name: 'Luckbender', text: '' },
        { name: 'Wings', text: '' },
      ],
    });
    const orc = await made<{ id: string }>('POST', `${base}/species`, { name: 'Orc' });
    await made('PATCH', `${base}/species/${orc.id}`, {
      features: [
        { name: 'Sturdy', text: '' },
        { name: 'Tusks', text: '' },
      ],
    });
    const rapier = await made<{ id: string }>('POST', `${base}/weapons`, {
      name: 'Rapier',
      trait: 'presence',
      damageDie: 8,
      damageBonus: 1,
      featureName: 'Quick',
      featureText: '+1 to Evasion',
      bonuses: { ...noGearBonuses(), evasion: 1 },
    });
    const greatsword = await made<{ id: string }>('POST', `${base}/weapons`, {
      name: 'Greatsword',
      burden: 'two_handed',
      damageDie: 10,
    });
    const dagger = await made<{ id: string }>('POST', `${base}/weapons`, {
      name: 'Parrying dagger',
      slot: 'secondary',
      tier: 3,
    });
    const leather = await made<{ id: string }>('POST', `${base}/armor`, {
      name: 'Leather',
      baseMajorThreshold: 6,
      baseSevereThreshold: 13,
      baseScore: 3,
    });
    const card = async (name: string, domain: string, level: number, recallCost: number) =>
      (
        await made<{ id: string }>('POST', `${base}/domain-cards`, {
          domainId: domainId(domain),
          name,
          level,
          recallCost,
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
      rapier: rapier.id,
      greatsword: greatsword.id,
      dagger: dagger.id,
      leather: leather.id,
      card,
    };
  }

  it('links each part, builds the sheet from it, and shows the player the same', async () => {
    const w = await world('Linked Vex');
    const url = `${w.base}/characters/${w.vex}`;
    const patched = await call('PATCH', url, gm, {
      level: 2,
      proficiency: 2,
      evasion: 10,
      classId: w.bard,
      subclassId: w.troubadour,
      subclassCards: 2,
      speciesIds: [w.faerie, w.orc],
      primaryWeaponId: w.rapier,
      secondaryWeaponId: w.dagger,
      armorId: w.leather,
      spareWeaponIds: [w.greatsword, w.greatsword],
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const sheet = patched.json<CharacterSheet>();
    expect(sheet.links).toMatchObject({
      classId: w.bard,
      subclassId: w.troubadour,
      speciesIds: [w.faerie, w.orc],
      spareWeaponIds: [w.greatsword, w.greatsword],
    });
    expect(sheet.built).toMatchObject({
      className: 'Bard',
      evasion: 11,
      armorScore: 3,
      armorSlotsMax: 3,
      thresholds: { minor: null, major: 8, severe: 15 },
      armorName: 'Leather',
      linked: { class: true, armor: true, primary: true, secondary: true },
      warnings: ["Parrying dagger is tier 3, above Vex's tier (2)"],
    });
    expect(sheet.built.weapons.primary).toMatchObject({ damage: '2d8+1', trait: 'presence' });
    expect(sheet.built.weapons.spares.map((spare) => spare.name)).toEqual([
      'Greatsword',
      'Greatsword',
    ]);
    expect(sheet.cards.class).toMatchObject({
      name: 'Bard',
      hopeFeature: { name: 'Make a Scene' },
    });
    expect(sheet.cards.subclass).toMatchObject({
      name: 'Troubadour',
      specialization: [{ name: 'Maestro', text: 'More songs.' }],
      mastery: null,
    });
    expect(sheet.cards.species.map((one) => [one.name, one.features.map((f) => f.name)])).toEqual([
      ['Faerie', ['Luckbender']],
      ['Orc', ['Tusks']],
    ]);

    const own = await made<PlayerCharacterSheet>('GET', url, undefined, player);
    expect(own.built).toEqual(sheet.built);
    expect(own.cards).toEqual(sheet.cards);

    // Unlinking brings the typed part back.
    const unlinked = await made<CharacterSheet>('PATCH', url, { armorId: null, classId: null });
    expect(unlinked.built).toMatchObject({
      className: '',
      armorName: null,
      linked: { armor: false },
    });
    expect(unlinked.links.subclassId).toBeNull();
  });

  it('refuses links that do not fit', async () => {
    const w = await world('Bad Links');
    const elsewhere = await world('Other Records');
    const url = `${w.base}/characters/${w.vex}`;
    const refused = async (body: unknown, status: number, message?: string) => {
      const response = await call('PATCH', url, gm, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(status);
      if (message !== undefined) expect(response.json<{ message: string }>().message).toBe(message);
    };
    await refused({ primaryWeaponId: w.dagger }, 400, NOT_A_PRIMARY);
    await refused({ secondaryWeaponId: w.rapier }, 400, NOT_A_SECONDARY);
    await refused(
      { primaryWeaponId: w.greatsword, secondaryWeaponId: w.dagger },
      400,
      SUGGESTION_NOT_FIT.twoHanded,
    );
    await refused({ classId: w.bard, subclassId: w.stalwart }, 400, SUBCLASS_OF_CLASS);
    await refused({ armorId: elsewhere.leather }, 404);
    await refused({ classId: elsewhere.bard }, 404);
    await refused({ spareWeaponIds: [elsewhere.rapier] }, 404);
    await refused({ speciesIds: [w.faerie, w.faerie] }, 400);

    // A new class drops a subclass of the old one.
    await made('PATCH', url, { classId: w.bard, subclassId: w.troubadour });
    const moved = await made<CharacterSheet>('PATCH', url, { classId: w.guardian });
    expect(moved.links).toMatchObject({ classId: w.guardian, subclassId: null });
  });

  it('keeps marked armor slots within the slots linked armor gives', async () => {
    const w = await world('Armor Slots');
    const url = `${w.base}/characters/${w.vex}`;
    await made('PATCH', url, { armorId: w.leather });
    expect((await call('PATCH', url, gm, { armorSlotsMarked: 3 })).statusCode).toBe(200);
    const over = await call('PATCH', url, gm, { armorSlotsMarked: 4 });
    expect(over.statusCode).toBe(400);
  });

  it('adds, moves and removes domain cards, with Stress for a recall and a full loadout', async () => {
    const w = await world('Cards');
    const cardsUrl = `${w.base}/characters/${w.vex}/domain-cards`;
    await made('PATCH', `${w.base}/characters/${w.vex}`, { classId: w.bard, stressMax: 6 });
    const ids = [];
    for (let n = 1; n <= 5; n += 1) ids.push(await w.card(`Grace ${String(n)}`, 'Grace', 1, 0));
    for (const cardId of ids) await made('POST', cardsUrl, { cardId });
    const blade = await w.card('Whirlwind', 'Blade', 4, 2);

    // A sixth card goes to the vault, with warnings: not the class's domain, above the level.
    const sixth = await made<CharacterSheet>('POST', cardsUrl, { cardId: blade });
    expect(sixth.cards.loadout).toHaveLength(5);
    expect(sixth.cards.vault).toMatchObject([
      { name: 'Whirlwind', place: 'vault', warning: "Blade isn't one of Bard's domains" },
    ]);
    expect((await call('POST', cardsUrl, gm, { cardId: blade })).statusCode).toBe(409);
    expect(
      (await call('POST', cardsUrl, gm, { cardId: ids[0], place: 'loadout' })).statusCode,
    ).toBe(409);

    // The player recalls it: the loadout is full, so one goes to the vault; it costs 2 Stress.
    const move = `${cardsUrl}/${blade}/move`;
    const full = await call('POST', move, player, { to: 'loadout' });
    expect(full.statusCode).toBe(409);
    expect(full.json<{ message: string }>().message).toBe(LOADOUT_FULL);
    const swapped = await made<PlayerCharacterSheet>(
      'POST',
      move,
      { to: 'loadout', swapOut: ids[0] },
      player,
    );
    expect(swapped.stressCurrent).toBe(2);
    expect(swapped.cards.vault.map((held) => held.name)).toEqual(['Grace 1']);
    expect(swapped).not.toHaveProperty('gmNotes');

    // Too little Stress left: refused (19.24). Into the vault is always free.
    await made('PATCH', `${w.base}/characters/${w.vex}`, { stressCurrent: 5 });
    expect((await call('POST', move, player, { to: 'vault' })).statusCode).toBe(200);
    const broke = await call('POST', move, player, { to: 'loadout' });
    expect(broke.statusCode).toBe(409);
    expect(broke.json<{ message: string }>().message).toBe(
      'Bringing it back marks 2 Stress; only 1 left',
    );

    // The GM moves for free; another player can't touch Vex's cards.
    const byGm = await made<CharacterSheet>('POST', move, { to: 'loadout' });
    expect(byGm.stressCurrent).toBe(5);
    expect(
      (await call('POST', `${cardsUrl}/${ids[1] ?? ''}/move`, other, { to: 'vault' })).statusCode,
    ).toBe(404);
    expect((await call('POST', cardsUrl, player, { cardId: ids[0] })).statusCode).toBe(403);

    const removed = await made<CharacterSheet>('DELETE', `${cardsUrl}/${blade}`);
    expect(
      [...removed.cards.loadout, ...removed.cards.vault].map((held) => held.name),
    ).not.toContain('Whirlwind');
    expect((await call('DELETE', `${cardsUrl}/${blade}`, gm)).statusCode).toBe(404);
  });

  it('keeps records a sheet uses from being deleted', async () => {
    const w = await world('In Use');
    const ward = await w.card('Ward', 'Grace', 1, 1);
    await made('PATCH', `${w.base}/characters/${w.vex}`, {
      classId: w.bard,
      subclassId: w.troubadour,
      speciesIds: [w.faerie, null],
      primaryWeaponId: w.rapier,
      armorId: w.leather,
    });
    await made('PATCH', `${w.base}/characters/${w.ash}`, {
      primaryWeaponId: w.rapier,
      spareWeaponIds: [w.greatsword],
      speciesIds: [w.faerie, null],
    });
    await made('POST', `${w.base}/characters/${w.vex}/domain-cards`, { cardId: ward });

    const refused = async (url: string, message: string) => {
      const response = await call('DELETE', `${w.base}/${url}`, gm);
      expect(response.statusCode, url).toBe(409);
      expect(response.json<{ message: string }>().message).toBe(message);
    };
    await refused(`classes/${w.bard}`, "Used by Vex's sheet. Unlink it there first.");
    await refused(`subclasses/${w.troubadour}`, "Used by Vex's sheet. Unlink it there first.");
    await refused(
      `species/${w.faerie}`,
      'Used by the sheets of Ash and Vex. Unlink it there first.',
    );
    await refused(
      `weapons/${w.rapier}`,
      'Used by the sheets of Ash and Vex. Unlink it there first.',
    );
    await refused(`weapons/${w.greatsword}`, "Used by Ash's sheet. Unlink it there first.");
    await refused(`armor/${w.leather}`, "Used by Vex's sheet. Unlink it there first.");
    await refused(`domain-cards/${ward}`, "Used by Vex's sheet. Unlink it there first.");

    // The Guardian has no user and goes; deleting the PC frees the rest.
    expect((await call('DELETE', `${w.base}/classes/${w.guardian}`, gm)).statusCode).toBe(204);
    expect((await call('DELETE', `${w.base}/characters/${w.vex}`, gm)).statusCode).toBe(204);
    expect((await call('DELETE', `${w.base}/armor/${w.leather}`, gm)).statusCode).toBe(204);
    expect((await call('DELETE', `${w.base}/domain-cards/${ward}`, gm)).statusCode).toBe(204);
  });
});
