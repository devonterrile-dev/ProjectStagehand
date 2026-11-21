/**
 * Species API (F4.6), against a real Postgres. Route-level isolation with random ids is in the
 * table in `campaigns.int.test.ts`; this file covers who may read and write, the defaults, the
 * order of features, names, ids from another campaign, archived campaigns, and copying species
 * at creation (19.14).
 */
import type { Campaign, SpeciesRecord, SpeciesSummary } from '@stagehand/shared';
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

describe('Species API', () => {
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
    gm = await person('19101', 'Species GM');
    player = await person('19102', 'Species Player');
    campaign = await newCampaign('Species Campaign');
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

  const speciesUrl = (c: Campaign) => `/api/campaigns/${c.id}/species`;

  async function newSpecies(name: string, c = campaign): Promise<SpeciesRecord> {
    const response = await call('POST', speciesUrl(c), gm, { name });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<SpeciesRecord>();
  }

  async function speciesOf(c: Campaign, who = gm): Promise<SpeciesSummary[]> {
    const response = await call('GET', speciesUrl(c), who);
    expect(response.statusCode).toBe(200);
    return response.json<{ species: SpeciesSummary[] }>().species;
  }

  const features = [
    { name: 'Luckbender', text: 'Spend 3 Hope to reroll a Duality Die.' },
    { name: 'Wings', text: 'You can fly.' },
    { name: 'Alert', text: '' },
  ];

  it('a fresh campaign has no species', async () => {
    expect(await speciesOf(await newCampaign('No Species Yet'))).toEqual([]);
  });

  it('start with only a name, and the GM fills them in for every member to read', async () => {
    const made = await newSpecies(' Faerie ');
    expect(made).toMatchObject({ name: 'Faerie', description: '', features: [], featureCount: 0 });
    const patched = await call('PATCH', `${speciesUrl(campaign)}/${made.id}`, gm, {
      description: 'Winged folk.',
      features,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const read = await call('GET', `${speciesUrl(campaign)}/${made.id}`, player);
    expect(read.json<SpeciesRecord>()).toMatchObject({
      description: 'Winged folk.',
      features,
      featureCount: 3,
    });
    const listed = (await speciesOf(campaign, player)).find((row) => row.id === made.id);
    expect(listed?.featureCount).toBe(3);
  });

  it('lists by name, case aside, and refuses a name twice', async () => {
    const place = await newCampaign('Species Order');
    await newSpecies('orc', place);
    await newSpecies('Elf', place);
    expect((await speciesOf(place)).map((row) => row.name)).toEqual(['Elf', 'orc']);
    const again = await call('POST', speciesUrl(place), gm, { name: 'ELF' });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ message: string }>().message).toBe(
      'A species with that name already exists',
    );
  });

  it('deletes, and answers 404 for an id of another campaign', async () => {
    const elsewhere = await newCampaign('Other Species');
    const foreign = await newSpecies('Giant', elsewhere);
    const url = `${speciesUrl(campaign)}/${foreign.id}`;
    expect((await call('GET', url, gm)).statusCode).toBe(404);
    expect((await call('PATCH', url, gm, { name: 'Taken' })).statusCode).toBe(404);
    expect((await call('DELETE', url, gm)).statusCode).toBe(404);

    const made = await newSpecies('Drakona');
    const own = `${speciesUrl(campaign)}/${made.id}`;
    expect((await call('DELETE', own, gm)).statusCode).toBe(204);
    expect((await call('GET', own, gm)).statusCode).toBe(404);
  });

  it('lets players read but not write', async () => {
    const made = await newSpecies('Ribbet');
    const url = `${speciesUrl(campaign)}/${made.id}`;
    expect((await call('GET', url, player)).statusCode).toBe(200);
    for (const [method, target, body] of [
      ['POST', speciesUrl(campaign), { name: 'Mine' }],
      ['PATCH', url, { name: 'Mine' }],
      ['DELETE', url, undefined],
    ] as const) {
      expect((await call(method, target, player, body)).statusCode, method).toBe(403);
    }
  });

  it('refuses every write while the campaign is archived', async () => {
    const shelf = await newCampaign('Shelved Species');
    const made = await newSpecies('Dusty', shelf);
    expect((await call('POST', `/api/campaigns/${shelf.id}/archive`, gm)).statusCode).toBe(200);
    for (const [method, url, body] of [
      ['POST', speciesUrl(shelf), { name: 'Late' }],
      ['PATCH', `${speciesUrl(shelf)}/${made.id}`, { name: 'Late' }],
      ['DELETE', `${speciesUrl(shelf)}/${made.id}`, undefined],
    ] as const) {
      expect((await call(method, url, gm, body)).statusCode, `${method} ${url}`).toBe(409);
    }
    expect(await speciesOf(shelf)).toHaveLength(1);
  });

  it('copies species with the gameplay records, then each campaign changes its own (19.14)', async () => {
    const source = await newCampaign('Species Source');
    const made = await newSpecies('Katari', source);
    await call('PATCH', `${speciesUrl(source)}/${made.id}`, gm, {
      description: 'Feline folk.',
      features,
    });
    const copy = await newCampaign('Species Copy', source.id);
    const [copied] = await speciesOf(copy);
    expect(copied?.id).not.toBe(made.id);
    const full = (
      await call('GET', `${speciesUrl(copy)}/${copied?.id ?? ''}`, gm)
    ).json<SpeciesRecord>();
    expect(full).toMatchObject({ name: 'Katari', description: 'Feline folk.', features });

    await call('PATCH', `${speciesUrl(copy)}/${full.id}`, gm, { name: 'Changed' });
    expect((await speciesOf(source)).map((row) => row.name)).toEqual(['Katari']);
  });
});
