/**
 * Weapons and armor API (F4.4), against a real Postgres. Route-level isolation with random ids
 * is in the table in `campaigns.int.test.ts`; this file covers who may read and write, the
 * defaults, the trait and secondary-weapon checks, ids from another campaign, archived
 * campaigns, and copying gear at creation (19.14).
 */
import {
  noGearBonuses,
  SECONDARY_ONE_HANDED,
  type ArmorRecord,
  type Campaign,
  type WeaponRecord,
} from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import type { DbHandle } from '../db/client';
import { campaignMembers, users } from '../db/schema';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface Person {
  cookie: string;
  id: string;
}

describe('Weapons and armor API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let player: Person;
  let stranger: Person;
  let campaign: Campaign;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('18901', 'Gear GM');
    player = await person('18902', 'Gear Player');
    stranger = await person('18903', 'Gear Stranger');
    campaign = await newCampaign('Gear Campaign');
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

  async function newCampaign(name: string, copyGameplayFrom?: string): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', gm, {
      name,
      ...(copyGameplayFrom === undefined ? {} : { copyGameplayFrom }),
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<Campaign>();
  }

  const weaponsUrl = (c: Campaign) => `/api/campaigns/${c.id}/weapons`;
  const armorUrl = (c: Campaign) => `/api/campaigns/${c.id}/armor`;

  async function newWeapon(body: Record<string, unknown>, c = campaign): Promise<WeaponRecord> {
    const response = await call('POST', weaponsUrl(c), gm, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<WeaponRecord>();
  }

  async function newArmor(body: Record<string, unknown>, c = campaign): Promise<ArmorRecord> {
    const response = await call('POST', armorUrl(c), gm, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<ArmorRecord>();
  }

  async function weaponsOf(c: Campaign, who = gm): Promise<WeaponRecord[]> {
    const response = await call('GET', weaponsUrl(c), who);
    expect(response.statusCode).toBe(200);
    return response.json<{ weapons: WeaponRecord[] }>().weapons;
  }

  async function armorOf(c: Campaign, who = gm): Promise<ArmorRecord[]> {
    const response = await call('GET', armorUrl(c), who);
    expect(response.statusCode).toBe(200);
    return response.json<{ armor: ArmorRecord[] }>().armor;
  }

  it('a fresh campaign has no gear', async () => {
    const fresh = await newCampaign('No Gear Yet');
    expect(await weaponsOf(fresh)).toEqual([]);
    expect(await armorOf(fresh)).toEqual([]);
  });

  describe('weapons', () => {
    it('start as a tier 1 one-handed physical melee primary with a d6 and the first trait', async () => {
      const weapon = await newWeapon({ name: ' Dagger ' });
      expect(weapon).toMatchObject({
        name: 'Dagger',
        tier: 1,
        slot: 'primary',
        kind: 'physical',
        trait: 'agility',
        range: 'melee',
        damageDie: 6,
        damageBonus: 0,
        burden: 'one_handed',
        featureName: '',
        featureText: '',
        bonuses: noGearBonuses(),
      });
    });

    it('lets the GM fill one in, read it back and delete it', async () => {
      const weapon = await newWeapon({ name: 'Greatsword' });
      const patch = {
        tier: 2,
        trait: 'strength',
        range: 'very_close',
        damageDie: 10,
        damageBonus: 3,
        burden: 'two_handed',
        featureName: 'Massive',
        featureText: '−1 to Evasion; on a hit, roll an extra damage die.',
        bonuses: { ...noGearBonuses(), evasion: -1, traits: { agility: 0, finesse: -1 } },
      };
      const patched = await call('PATCH', `${weaponsUrl(campaign)}/${weapon.id}`, gm, patch);
      expect(patched.statusCode, patched.body).toBe(200);
      const expected = {
        ...patch,
        bonuses: { ...noGearBonuses(), evasion: -1, traits: { finesse: -1 } },
      };
      expect(patched.json()).toMatchObject(expected);
      const read = await call('GET', `${weaponsUrl(campaign)}/${weapon.id}`, player);
      expect(read.json()).toMatchObject(expected);

      expect((await call('DELETE', `${weaponsUrl(campaign)}/${weapon.id}`, gm)).statusCode).toBe(
        204,
      );
      expect((await call('GET', `${weaponsUrl(campaign)}/${weapon.id}`, gm)).statusCode).toBe(404);
    });

    it('lists by tier, primary before secondary, then name', async () => {
      const list = await newCampaign('Weapon Order');
      await newWeapon({ name: 'b shield', slot: 'secondary' }, list);
      await newWeapon({ name: 'Zweihander', tier: 2 }, list);
      await newWeapon({ name: 'axe' }, list);
      await newWeapon({ name: 'Club' }, list);
      expect((await weaponsOf(list)).map((weapon) => weapon.name)).toEqual([
        'axe',
        'Club',
        'b shield',
        'Zweihander',
      ]);
    });

    it('keeps a secondary weapon one-handed', async () => {
      const weapon = await newWeapon({ name: 'Warhammer', burden: 'two_handed' });
      const moved = await call('PATCH', `${weaponsUrl(campaign)}/${weapon.id}`, gm, {
        slot: 'secondary',
      });
      expect(moved.json()).toMatchObject({ slot: 'secondary', burden: 'one_handed' });
      const refused = await call('PATCH', `${weaponsUrl(campaign)}/${weapon.id}`, gm, {
        burden: 'two_handed',
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ message: SECONDARY_ONE_HANDED });
      const created = await call('POST', weaponsUrl(campaign), gm, {
        name: 'Big shield',
        slot: 'secondary',
        burden: 'two_handed',
      });
      expect(created.statusCode).toBe(400);
    });

    it("refuses a trait the campaign's ruleset doesn't have, and bad numbers", async () => {
      const weapon = await newWeapon({ name: 'Wand', kind: 'magic' });
      for (const body of [
        { trait: 'luck' },
        { bonuses: { ...noGearBonuses(), traits: { luck: 1 } } },
        { damageDie: 7 },
        { tier: 5 },
        { range: 'very_melee' },
      ]) {
        const response = await call('PATCH', `${weaponsUrl(campaign)}/${weapon.id}`, gm, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      const created = await call('POST', weaponsUrl(campaign), gm, { name: 'X', trait: 'luck' });
      expect(created.statusCode).toBe(400);
      expect(created.json()).toMatchObject({ message: 'Unknown trait: luck' });
    });
  });

  describe('armor', () => {
    it('lets the GM make, fill in and delete a piece; the severe threshold may sit below major for now', async () => {
      const piece = await newArmor({ name: 'Chainmail' });
      expect(piece).toMatchObject({
        tier: 1,
        baseMajorThreshold: 0,
        baseSevereThreshold: 0,
        baseScore: 0,
        bonuses: noGearBonuses(),
      });
      const url = `${armorUrl(campaign)}/${piece.id}`;
      // The GM's form saves one field at a time.
      expect((await call('PATCH', url, gm, { baseMajorThreshold: 7 })).statusCode).toBe(200);
      const patched = await call('PATCH', url, gm, {
        baseSevereThreshold: 15,
        baseScore: 4,
        featureName: 'Heavy',
        featureText: '−1 to Evasion',
        bonuses: { ...noGearBonuses(), evasion: -1 },
      });
      expect(patched.statusCode, patched.body).toBe(200);
      expect(patched.json()).toMatchObject({
        baseMajorThreshold: 7,
        baseSevereThreshold: 15,
        baseScore: 4,
        bonuses: { evasion: -1 },
      });
      expect((await call('DELETE', url, gm)).statusCode).toBe(204);
      expect((await call('DELETE', url, gm)).statusCode).toBe(404);
    });

    it('lists by tier, then name, and refuses unknown traits and bad numbers', async () => {
      const list = await newCampaign('Armor Order');
      await newArmor({ name: 'Plate', tier: 3 }, list);
      await newArmor({ name: 'leather' }, list);
      await newArmor({ name: 'Gambeson' }, list);
      expect((await armorOf(list)).map((piece) => piece.name)).toEqual([
        'Gambeson',
        'leather',
        'Plate',
      ]);
      const piece = (await armorOf(list))[0];
      for (const body of [
        { bonuses: { ...noGearBonuses(), traits: { luck: -1 } } },
        { baseScore: 1000 },
        { tier: 0 },
        {},
      ]) {
        const response = await call('PATCH', `${armorUrl(list)}/${piece?.id ?? ''}`, gm, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
    });
  });

  it('lets a player read gear but not write it, and keeps strangers out', async () => {
    const weapon = await newWeapon({ name: 'Spear' });
    const piece = await newArmor({ name: 'Padded' });
    expect((await weaponsOf(campaign, player)).map((w) => w.id)).toContain(weapon.id);
    expect((await armorOf(campaign, player)).map((a) => a.id)).toContain(piece.id);
    for (const [method, url, body] of [
      ['POST', weaponsUrl(campaign), { name: 'Mine' }],
      ['PATCH', `${weaponsUrl(campaign)}/${weapon.id}`, { name: 'Mine' }],
      ['DELETE', `${weaponsUrl(campaign)}/${weapon.id}`, undefined],
      ['POST', armorUrl(campaign), { name: 'Mine' }],
      ['PATCH', `${armorUrl(campaign)}/${piece.id}`, { name: 'Mine' }],
      ['DELETE', `${armorUrl(campaign)}/${piece.id}`, undefined],
    ] as const) {
      expect((await call(method, url, player, body)).statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await call('GET', weaponsUrl(campaign), stranger)).statusCode).toBe(404);
  });

  it("hides another campaign's gear behind 404", async () => {
    const other = await newCampaign('Other Gear');
    const weapon = await newWeapon({ name: 'Elsewhere' }, other);
    const piece = await newArmor({ name: 'Elsewhere' }, other);
    expect((await call('GET', `${weaponsUrl(campaign)}/${weapon.id}`, gm)).statusCode).toBe(404);
    expect(
      (await call('PATCH', `${armorUrl(campaign)}/${piece.id}`, gm, { name: 'Taken' })).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `${weaponsUrl(campaign)}/${weapon.id}`, gm)).statusCode).toBe(404);
  });

  it('refuses every write while the campaign is archived', async () => {
    const shelf = await newCampaign('Shelved Gear');
    const weapon = await newWeapon({ name: 'Dusty' }, shelf);
    const piece = await newArmor({ name: 'Dusty' }, shelf);
    expect((await call('POST', `/api/campaigns/${shelf.id}/archive`, gm)).statusCode).toBe(200);
    for (const [method, url, body] of [
      ['POST', weaponsUrl(shelf), { name: 'Late' }],
      ['PATCH', `${weaponsUrl(shelf)}/${weapon.id}`, { name: 'Late' }],
      ['DELETE', `${armorUrl(shelf)}/${piece.id}`, undefined],
    ] as const) {
      expect((await call(method, url, gm, body)).statusCode, `${method} ${url}`).toBe(409);
    }
    expect(await weaponsOf(shelf)).toHaveLength(1);
  });

  it('copies weapons and armor with the gameplay records, then each campaign changes its own (19.14)', async () => {
    const source = await newCampaign('Gear Source');
    const weapon = await newWeapon(
      {
        name: 'Longbow',
        tier: 2,
        trait: 'agility',
        range: 'far',
        damageDie: 8,
        damageBonus: 3,
        burden: 'two_handed',
        featureName: 'Cumbersome',
        featureText: '−1 to Finesse',
        bonuses: { ...noGearBonuses(), traits: { finesse: -1 } },
      },
      source,
    );
    await newArmor(
      { name: 'Scale', tier: 2, baseMajorThreshold: 8, baseSevereThreshold: 18, baseScore: 4 },
      source,
    );

    const copy = await newCampaign('Gear Copy', source.id);
    const [copiedWeapon] = await weaponsOf(copy);
    expect(copiedWeapon?.id).not.toBe(weapon.id);
    expect(copiedWeapon).toMatchObject({
      name: 'Longbow',
      tier: 2,
      range: 'far',
      damageDie: 8,
      damageBonus: 3,
      burden: 'two_handed',
      featureName: 'Cumbersome',
      bonuses: { traits: { finesse: -1 } },
    });
    expect(await armorOf(copy)).toMatchObject([
      { name: 'Scale', tier: 2, baseMajorThreshold: 8, baseSevereThreshold: 18, baseScore: 4 },
    ]);

    await call('PATCH', `${weaponsUrl(copy)}/${copiedWeapon?.id ?? ''}`, gm, { name: 'Bent bow' });
    expect((await weaponsOf(source))[0]?.name).toBe('Longbow');
  });
});
