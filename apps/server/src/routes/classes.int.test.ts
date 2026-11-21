/**
 * Classes and subclasses API (F4.5), against a real Postgres. Route-level isolation with random
 * ids is in the table in `campaigns.int.test.ts`; this file covers who may read and write, the
 * defaults, domains and suggested gear (ids from another campaign, fit, clearing on delete), a
 * domain a class uses, deleting a class with its subclasses, traits, archived campaigns, and
 * copying classes at creation (19.14).
 */
import {
  SAME_DOMAIN_TWICE,
  SUGGESTION_NOT_FIT,
  type Campaign,
  type ClassRecord,
  type ClassSummary,
  type DomainSummary,
  type SubclassRecord,
  type SubclassSummary,
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

describe('Classes and subclasses API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let player: Person;
  let campaign: Campaign;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('19001', 'Class GM');
    player = await person('19002', 'Class Player');
    campaign = await newCampaign('Class Campaign');
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

  const classesUrl = (c: Campaign) => `/api/campaigns/${c.id}/classes`;
  const subclassesUrl = (c: Campaign) => `/api/campaigns/${c.id}/subclasses`;

  async function newClass(name: string, c = campaign): Promise<ClassRecord> {
    const response = await call('POST', classesUrl(c), gm, { name });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<ClassRecord>();
  }

  async function patchClass(cls: ClassRecord, body: unknown, c = campaign) {
    return call('PATCH', `${classesUrl(c)}/${cls.id}`, gm, body);
  }

  async function newSubclass(classId: string, name: string, c = campaign): Promise<SubclassRecord> {
    const response = await call('POST', subclassesUrl(c), gm, { classId, name });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<SubclassRecord>();
  }

  async function domainsOf(c: Campaign): Promise<DomainSummary[]> {
    const response = await call('GET', `/api/campaigns/${c.id}/domains`, gm);
    return response.json<{ domains: DomainSummary[] }>().domains;
  }

  async function domainId(name: string, c = campaign): Promise<string> {
    const found = (await domainsOf(c)).find((domain) => domain.name === name);
    if (found === undefined) throw new Error(`no domain ${name}`);
    return found.id;
  }

  async function newWeapon(body: Record<string, unknown>, c = campaign): Promise<WeaponRecord> {
    const response = await call('POST', `/api/campaigns/${c.id}/weapons`, gm, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<WeaponRecord>();
  }

  async function newArmor(body: Record<string, unknown>, c = campaign): Promise<{ id: string }> {
    const response = await call('POST', `/api/campaigns/${c.id}/armor`, gm, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ id: string }>();
  }

  async function classesOf(c: Campaign, who = gm): Promise<ClassSummary[]> {
    const response = await call('GET', classesUrl(c), who);
    expect(response.statusCode).toBe(200);
    return response.json<{ classes: ClassSummary[] }>().classes;
  }

  async function readClass(id: string, c = campaign, who = gm): Promise<ClassRecord> {
    const response = await call('GET', `${classesUrl(c)}/${id}`, who);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<ClassRecord>();
  }

  it('a fresh campaign has no classes', async () => {
    const fresh = await newCampaign('No Classes Yet');
    expect(await classesOf(fresh)).toEqual([]);
  });

  describe('classes', () => {
    it('start with no domains, 10 evasion, 6 HP and a 3-Hope feature', async () => {
      const cls = await newClass(' Bard ');
      expect(cls).toMatchObject({
        name: 'Bard',
        description: '',
        domains: [null, null],
        startingEvasion: 10,
        startingHp: 6,
        hopeFeature: { name: '', cost: 3, text: '' },
        classFeatures: [],
        suggestedTraits: {},
        suggestedPrimaryWeapon: null,
        suggestedSecondaryWeapon: null,
        suggestedArmor: null,
        suggestionWarnings: [],
        subclasses: [],
        subclassCount: 0,
      });
    });

    it('lets the GM fill one in and every member read it', async () => {
      const cls = await newClass('Warrior');
      const blade = await domainId('Blade');
      const bone = await domainId('Bone');
      const fields = {
        description: 'Fighters of the front line.',
        startingEvasion: 11,
        startingHp: 6,
        hopeFeature: {
          name: 'No Mercy',
          cost: 3,
          text: '+1 to attack rolls until your next rest.',
        },
        classFeatures: [{ name: 'Combat Training', text: 'Ignore burden.' }],
        suggestedTraits: {
          agility: 2,
          strength: 1,
          finesse: 0,
          instinct: 1,
          presence: -1,
          knowledge: 0,
        },
      };
      const patched = await patchClass(cls, { ...fields, domainIds: [blade, bone] });
      expect(patched.statusCode, patched.body).toBe(200);
      const read = await readClass(cls.id, campaign, player);
      expect(read).toMatchObject({
        ...fields,
        domains: [
          { id: blade, name: 'Blade' },
          { id: bone, name: 'Bone' },
        ],
      });
      const listed = (await classesOf(campaign, player)).find((row) => row.id === cls.id);
      expect(listed?.domains.map((domain) => domain?.name)).toEqual(['Blade', 'Bone']);
    });

    it('lists by name, case aside, and refuses a name twice', async () => {
      const place = await newCampaign('Class Order');
      await newClass('wizard', place);
      await newClass('Druid', place);
      expect((await classesOf(place)).map((row) => row.name)).toEqual(['Druid', 'wizard']);
      const again = await call('POST', classesUrl(place), gm, { name: 'WIZARD' });
      expect(again.statusCode).toBe(409);
      expect(again.json<{ message: string }>().message).toBe(
        'A class with that name already exists',
      );
    });

    it('refuses the same domain twice and a domain of another campaign', async () => {
      const cls = await newClass('Seraph');
      const valor = await domainId('Valor');
      const twice = await patchClass(cls, { domainIds: [valor, valor] });
      expect(twice.statusCode).toBe(400);
      expect(twice.body).toContain(SAME_DOMAIN_TWICE);

      const elsewhere = await newCampaign('Other Domains');
      const foreign = await domainId('Valor', elsewhere);
      const response = await patchClass(cls, { domainIds: [foreign, null] });
      expect(response.statusCode).toBe(404);
      expect((await readClass(cls.id)).domains).toEqual([null, null]);
    });

    it('refuses an unknown trait in the suggested traits', async () => {
      const cls = await newClass('Ranger');
      const response = await patchClass(cls, { suggestedTraits: { luck: 2 } });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ message: string }>().message).toBe('Unknown trait: luck');
    });

    it('takes tier 1 gear of the right slot as suggestions, and refuses the rest', async () => {
      const cls = await newClass('Guardian');
      const axe = await newWeapon({ name: 'Battleaxe', burden: 'two_handed' });
      const sword = await newWeapon({ name: 'Broadsword' });
      const shield = await newWeapon({ name: 'Round Shield', slot: 'secondary' });
      const heavy = await newWeapon({ name: 'Tier 2 Sword', tier: 2 });
      const mail = await newArmor({ name: 'Chainmail' });
      const plate = await newArmor({ name: 'Plate', tier: 3 });

      const notFit = async (body: unknown, message: string) => {
        const response = await patchClass(cls, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
        expect(response.json<{ message: string }>().message).toBe(message);
      };
      await notFit({ suggestedPrimaryWeaponId: heavy.id }, SUGGESTION_NOT_FIT.primary);
      await notFit({ suggestedPrimaryWeaponId: shield.id }, SUGGESTION_NOT_FIT.primary);
      await notFit({ suggestedSecondaryWeaponId: sword.id }, SUGGESTION_NOT_FIT.secondary);
      await notFit({ suggestedArmorId: plate.id }, SUGGESTION_NOT_FIT.armor);

      const ok = await patchClass(cls, {
        suggestedPrimaryWeaponId: sword.id,
        suggestedSecondaryWeaponId: shield.id,
        suggestedArmorId: mail.id,
      });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json<ClassRecord>()).toMatchObject({
        suggestedPrimaryWeapon: { id: sword.id, name: 'Broadsword' },
        suggestedSecondaryWeapon: { id: shield.id, name: 'Round Shield' },
        suggestedArmor: { id: mail.id, name: 'Chainmail' },
      });

      // A two-handed primary leaves no hand for the secondary already suggested.
      await notFit({ suggestedPrimaryWeaponId: axe.id }, SUGGESTION_NOT_FIT.twoHanded);
      const swap = await patchClass(cls, {
        suggestedPrimaryWeaponId: axe.id,
        suggestedSecondaryWeaponId: null,
      });
      expect(swap.statusCode, swap.body).toBe(200);
      await notFit({ suggestedSecondaryWeaponId: shield.id }, SUGGESTION_NOT_FIT.twoHanded);

      const missing = await patchClass(cls, {
        suggestedArmorId: '00000000-0000-4000-8000-000000000000',
      });
      expect(missing.statusCode).toBe(404);
    });

    it('warns about suggested gear edited since, and clears a suggestion when its gear is deleted', async () => {
      const cls = await newClass('Rogue');
      const dagger = await newWeapon({ name: 'Dagger' });
      const knife = await newWeapon({ name: 'Small Dagger', slot: 'secondary' });
      const leather = await newArmor({ name: 'Leather' });
      expect(
        (
          await patchClass(cls, {
            suggestedPrimaryWeaponId: dagger.id,
            suggestedSecondaryWeaponId: knife.id,
            suggestedArmorId: leather.id,
          })
        ).statusCode,
      ).toBe(200);

      await call('PATCH', `/api/campaigns/${campaign.id}/weapons/${dagger.id}`, gm, {
        tier: 2,
        burden: 'two_handed',
      });
      expect((await readClass(cls.id)).suggestionWarnings).toEqual([
        'Dagger is no longer a tier 1 primary weapon',
        'Dagger is two-handed, which leaves no hand for Small Dagger',
      ]);

      const gone = await call('DELETE', `/api/campaigns/${campaign.id}/weapons/${dagger.id}`, gm);
      expect(gone.statusCode).toBe(204);
      const gone2 = await call('DELETE', `/api/campaigns/${campaign.id}/armor/${leather.id}`, gm);
      expect(gone2.statusCode).toBe(204);
      expect(await readClass(cls.id)).toMatchObject({
        suggestedPrimaryWeapon: null,
        suggestedSecondaryWeapon: { id: knife.id },
        suggestedArmor: null,
        suggestionWarnings: [],
      });
    });

    it('keeps a domain a class uses from being deleted', async () => {
      const place = await newCampaign('Domain In Use');
      const cls = await newClass('Witch', place);
      const dread = await domainId('Dread', place);
      expect((await patchClass(cls, { domainIds: [null, dread] }, place)).statusCode).toBe(200);
      const refused = await call('DELETE', `/api/campaigns/${place.id}/domains/${dread}`, gm);
      expect(refused.statusCode).toBe(409);
      expect(refused.json<{ message: string }>().message).toBe(
        'Used by Witch. Change or delete them first.',
      );
      expect((await patchClass(cls, { domainIds: [null, null] }, place)).statusCode).toBe(200);
      expect(
        (await call('DELETE', `/api/campaigns/${place.id}/domains/${dread}`, gm)).statusCode,
      ).toBe(204);
    });

    it('deletes a class with its subclasses', async () => {
      const cls = await newClass('Sorcerer');
      const sub = await newSubclass(cls.id, 'Elemental Origin');
      expect((await call('DELETE', `${classesUrl(campaign)}/${cls.id}`, gm)).statusCode).toBe(204);
      expect((await call('GET', `${subclassesUrl(campaign)}/${sub.id}`, gm)).statusCode).toBe(404);
      expect((await call('GET', `${classesUrl(campaign)}/${cls.id}`, gm)).statusCode).toBe(404);
    });
  });

  describe('subclasses', () => {
    it('start empty in their class, and the GM fills them in', async () => {
      const cls = await newClass('Wizard');
      const sub = await newSubclass(cls.id, 'School of War');
      expect(sub).toMatchObject({
        classId: cls.id,
        className: 'Wizard',
        name: 'School of War',
        description: '',
        spellcastTrait: null,
        foundation: [],
        specialization: [],
        mastery: [],
      });
      const patch = {
        spellcastTrait: 'knowledge',
        foundation: [{ name: 'Battlemage', text: 'Gain an extra Hit Point slot.' }],
        mastery: [{ name: 'Thrive in Chaos', text: 'Mark a Stress to deal extra damage.' }],
      };
      const patched = await call('PATCH', `${subclassesUrl(campaign)}/${sub.id}`, gm, patch);
      expect(patched.statusCode, patched.body).toBe(200);
      const read = await call('GET', `${subclassesUrl(campaign)}/${sub.id}`, player);
      expect(read.json<SubclassRecord>()).toMatchObject(patch);

      const owner = await readClass(cls.id, campaign, player);
      expect(owner.subclassCount).toBe(1);
      expect(owner.subclasses.map((row) => row.name)).toEqual(['School of War']);
    });

    it('lists by class, then name', async () => {
      const place = await newCampaign('Subclass Order');
      const b = await newClass('Bard', place);
      const a = await newClass('Assassin', place);
      await newSubclass(b.id, 'Wordsmith', place);
      await newSubclass(b.id, 'troubadour', place);
      await newSubclass(a.id, 'Shadow', place);
      const listed = (await call('GET', subclassesUrl(place), gm)).json<{
        subclasses: SubclassSummary[];
      }>().subclasses;
      expect(listed.map((row) => row.name)).toEqual(['Shadow', 'troubadour', 'Wordsmith']);
    });

    it('refuses an unknown spellcast trait, a class of another campaign and a move', async () => {
      const cls = await newClass('Druid');
      const sub = await newSubclass(cls.id, 'Warden of the Elements');
      const url = `${subclassesUrl(campaign)}/${sub.id}`;
      expect((await call('PATCH', url, gm, { spellcastTrait: 'luck' })).statusCode).toBe(400);
      expect((await call('PATCH', url, gm, { classId: cls.id })).statusCode).toBe(400);

      const elsewhere = await newCampaign('Other Classes');
      const foreign = await newClass('Druid', elsewhere);
      const response = await call('POST', subclassesUrl(campaign), gm, {
        classId: foreign.id,
        name: 'Stolen',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  it('lets players read but not write', async () => {
    const cls = await newClass('Watcher');
    const sub = await newSubclass(cls.id, 'Lookout');
    expect((await call('GET', classesUrl(campaign), player)).statusCode).toBe(200);
    for (const [method, url, body] of [
      ['POST', classesUrl(campaign), { name: 'Mine' }],
      ['PATCH', `${classesUrl(campaign)}/${cls.id}`, { name: 'Mine' }],
      ['DELETE', `${classesUrl(campaign)}/${cls.id}`, undefined],
      ['POST', subclassesUrl(campaign), { classId: cls.id, name: 'Mine' }],
      ['PATCH', `${subclassesUrl(campaign)}/${sub.id}`, { name: 'Mine' }],
      ['DELETE', `${subclassesUrl(campaign)}/${sub.id}`, undefined],
    ] as const) {
      expect((await call(method, url, player, body)).statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('refuses every write while the campaign is archived', async () => {
    const shelf = await newCampaign('Shelved Classes');
    const cls = await newClass('Dusty', shelf);
    expect((await call('POST', `/api/campaigns/${shelf.id}/archive`, gm)).statusCode).toBe(200);
    for (const [method, url, body] of [
      ['POST', classesUrl(shelf), { name: 'Late' }],
      ['PATCH', `${classesUrl(shelf)}/${cls.id}`, { name: 'Late' }],
      ['POST', subclassesUrl(shelf), { classId: cls.id, name: 'Late' }],
      ['DELETE', `${classesUrl(shelf)}/${cls.id}`, undefined],
    ] as const) {
      expect((await call(method, url, gm, body)).statusCode, `${method} ${url}`).toBe(409);
    }
    expect(await classesOf(shelf)).toHaveLength(1);
  });

  it('copies classes and subclasses with their links, then each campaign changes its own (19.14)', async () => {
    const source = await newCampaign('Class Source');
    const cls = await newClass('Guardian', source);
    const valor = await domainId('Valor', source);
    const blade = await domainId('Blade', source);
    const sword = await newWeapon({ name: 'Broadsword' }, source);
    const twin = await newWeapon({ name: 'Broadsword', featureText: 'The twin' }, source);
    const mail = await newArmor({ name: 'Chainmail' }, source);
    expect(
      (
        await patchClass(
          cls,
          {
            domainIds: [valor, blade],
            suggestedPrimaryWeaponId: twin.id,
            suggestedArmorId: mail.id,
            classFeatures: [{ name: 'Unstoppable', text: 'Become unstoppable.' }],
          },
          source,
        )
      ).statusCode,
    ).toBe(200);
    await newSubclass(cls.id, 'Stalwart', source);

    const copy = await newCampaign('Class Copy', source.id);
    const [copied] = await classesOf(copy);
    expect(copied?.id).not.toBe(cls.id);
    const full = await readClass(copied?.id ?? '', copy);
    expect(full.domains).toEqual([
      { id: await domainId('Valor', copy), name: 'Valor' },
      { id: await domainId('Blade', copy), name: 'Blade' },
    ]);
    // The copy points at the copy of the same one of two same-named swords.
    expect(full.suggestedPrimaryWeapon?.name).toBe('Broadsword');
    expect([sword.id, twin.id]).not.toContain(full.suggestedPrimaryWeapon?.id);
    const copiedWeapons = (await call('GET', `/api/campaigns/${copy.id}/weapons`, gm)).json<{
      weapons: WeaponRecord[];
    }>().weapons;
    const suggested = copiedWeapons.find((weapon) => weapon.id === full.suggestedPrimaryWeapon?.id);
    expect(suggested?.featureText).toBe('The twin');
    expect(full.suggestedArmor?.name).toBe('Chainmail');
    expect(full.classFeatures).toEqual([{ name: 'Unstoppable', text: 'Become unstoppable.' }]);
    expect(full.subclasses.map((row) => row.name)).toEqual(['Stalwart']);

    expect((await patchClass(full, { name: 'Changed' }, copy)).statusCode).toBe(200);
    expect((await readClass(cls.id, source)).name).toBe('Guardian');
  });
});
