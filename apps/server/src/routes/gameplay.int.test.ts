/**
 * Gameplay records API (F4.3): domains and domain cards, against a real Postgres. Route-level
 * isolation with random ids is in the table in `campaigns.int.test.ts`; this file covers the ten
 * default domains, who may read and write, a used domain, ids from another campaign, copying
 * another campaign's gameplay records at creation (19.14), and migration 0022's seed.
 */
import { readFileSync } from 'node:fs';

import {
  DEFAULT_DOMAINS,
  emptyRichText,
  type Campaign,
  type Domain,
  type DomainCard,
  type DomainCardSummary,
  type DomainSummary,
  type StatBlock,
  type StatBlockSummary,
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

const FEATURE = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mark a Stress to glow.' }] }],
};

describe('Gameplay records API', () => {
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
    gm = await person('18801', 'Gameplay GM');
    player = await person('18802', 'Gameplay Player');
    stranger = await person('18803', 'Gameplay Stranger');
    campaign = await newCampaign('Gameplay Campaign');
    await join(campaign, player);
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

  async function newCampaign(name: string, who = gm, copyGameplayFrom?: string): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', who, {
      name,
      ...(copyGameplayFrom === undefined ? {} : { copyGameplayFrom }),
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<Campaign>();
  }

  async function join(c: Campaign, who: Person) {
    await handle.db
      .insert(campaignMembers)
      .values({ campaignId: c.id, userId: who.id, role: 'player' });
  }

  const domainsUrl = (c: Campaign) => `/api/campaigns/${c.id}/domains`;
  const cardsUrl = (c: Campaign) => `/api/campaigns/${c.id}/domain-cards`;

  async function domainsOf(c: Campaign, who = gm): Promise<DomainSummary[]> {
    const response = await call('GET', domainsUrl(c), who);
    expect(response.statusCode).toBe(200);
    return response.json<{ domains: DomainSummary[] }>().domains;
  }

  async function newDomain(name: string, c = campaign): Promise<Domain> {
    const response = await call('POST', domainsUrl(c), gm, { name, description: 'Tides.' });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<Domain>();
  }

  async function newCard(domainId: string, name: string, extra = {}, c = campaign) {
    const response = await call('POST', cardsUrl(c), gm, { domainId, name, ...extra });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<DomainCard>();
  }

  describe('the default domains', () => {
    it('come with every new campaign, described, by name', async () => {
      const domains = await domainsOf(campaign);
      expect(domains.map((domain) => domain.name)).toEqual(
        DEFAULT_DOMAINS.map((domain) => domain.name).sort((a, b) => a.localeCompare(b)),
      );
      const arcana = domains.find((domain) => domain.name === 'Arcana');
      expect(arcana).toMatchObject({
        description: DEFAULT_DOMAINS[0]?.description,
        cardCount: 0,
      });
    });

    it('are in migration 0022 word for word, for the campaigns that existed then', () => {
      const sql = readFileSync(new URL('../../drizzle/0022_domains.sql', import.meta.url), 'utf8');
      for (const domain of DEFAULT_DOMAINS) {
        expect(sql).toContain(`'${domain.name}', '${domain.description.replaceAll("'", "''")}'`);
      }
    });
  });

  describe('domains', () => {
    it('lets the GM create, rename, describe and delete one', async () => {
      const tide = await newDomain(' Tide ');
      expect(tide).toMatchObject({ name: 'Tide', description: 'Tides.', cardCount: 0, cards: [] });

      const renamed = await call('PATCH', `${domainsUrl(campaign)}/${tide.id}`, gm, {
        name: 'Tidewater',
        description: 'Line one.\nLine two.',
      });
      expect(renamed.json()).toMatchObject({
        name: 'Tidewater',
        description: 'Line one.\nLine two.',
      });

      expect((await call('DELETE', `${domainsUrl(campaign)}/${tide.id}`, gm)).statusCode).toBe(204);
      expect((await call('GET', `${domainsUrl(campaign)}/${tide.id}`, gm)).statusCode).toBe(404);
    });

    it('refuses a name the campaign already has, whatever its case', async () => {
      const response = await call('POST', domainsUrl(campaign), gm, { name: 'arcana' });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ message: 'A domain with that name already exists' });

      const reef = await newDomain('Reef');
      const clash = await call('PATCH', `${domainsUrl(campaign)}/${reef.id}`, gm, {
        name: 'BLADE',
      });
      expect(clash.statusCode).toBe(409);
    });

    it('keeps a domain that cards use, naming them', async () => {
      const storm = await newDomain('Storm');
      for (const name of ['Squall', 'Gale', 'Bolt', 'Hail', 'Mist', 'Thunder', 'Calm']) {
        await newCard(storm.id, name);
      }
      const refused = await call('DELETE', `${domainsUrl(campaign)}/${storm.id}`, gm);
      expect(refused.statusCode).toBe(409);
      expect(refused.json<{ message: string }>().message).toBe(
        'Used by Bolt, Calm, Gale, Hail, Mist and 2 more cards. Move or delete them first.',
      );
      expect((await domainsOf(campaign)).find((d) => d.id === storm.id)?.cardCount).toBe(7);
    });

    it('lets a player read but not write, and keeps strangers out', async () => {
      const [first] = await domainsOf(campaign, player);
      expect(first).toBeDefined();
      expect(
        (await call('GET', `${domainsUrl(campaign)}/${first?.id ?? ''}`, player)).statusCode,
      ).toBe(200);
      expect((await call('POST', domainsUrl(campaign), player, { name: 'Mine' })).statusCode).toBe(
        403,
      );
      expect(
        (await call('PATCH', `${domainsUrl(campaign)}/${first?.id ?? ''}`, player, { name: 'X' }))
          .statusCode,
      ).toBe(403);
      expect((await call('GET', domainsUrl(campaign), stranger)).statusCode).toBe(404);
    });

    it('refuses bad bodies with 400', async () => {
      for (const body of [{}, { name: '' }, { name: 'x'.repeat(61) }, { name: 'X', extra: 1 }]) {
        expect(
          (await call('POST', domainsUrl(campaign), gm, body)).statusCode,
          JSON.stringify(body),
        ).toBe(400);
      }
    });
  });

  describe('domain cards', () => {
    it('lets the GM make a card, fill it in, move it to another domain and delete it', async () => {
      const ember = await newDomain('Ember');
      const ash = await newDomain('Ash');
      const card = await newCard(ember.id, ' Kindle ', { level: 3, recallCost: 1, type: 'spell' });
      expect(card).toMatchObject({
        name: 'Kindle',
        domainId: ember.id,
        domainName: 'Ember',
        level: 3,
        recallCost: 1,
        type: 'spell',
        feature: emptyRichText(),
      });

      const moved = await call('PATCH', `${cardsUrl(campaign)}/${card.id}`, gm, {
        domainId: ash.id,
        level: 10,
        recallCost: 0,
        type: 'grimoire',
        feature: FEATURE,
      });
      expect(moved.statusCode, moved.body).toBe(200);
      expect(moved.json()).toMatchObject({
        domainId: ash.id,
        domainName: 'Ash',
        level: 10,
        recallCost: 0,
        type: 'grimoire',
        feature: FEATURE,
      });

      const ashDomain = (await call('GET', `${domainsUrl(campaign)}/${ash.id}`, gm)).json<Domain>();
      expect(ashDomain.cards.map((entry) => entry.name)).toEqual(['Kindle']);

      expect((await call('DELETE', `${cardsUrl(campaign)}/${card.id}`, gm)).statusCode).toBe(204);
      expect((await call('GET', `${cardsUrl(campaign)}/${card.id}`, gm)).statusCode).toBe(404);
    });

    it('lists cards by domain, then level, then name, and one domain alone', async () => {
      const wave = await newDomain('Wave');
      await newCard(wave.id, 'Crest', { level: 2 });
      await newCard(wave.id, 'Undertow', { level: 1 });
      await newCard(wave.id, 'Breaker', { level: 2 });
      const response = await call('GET', `${cardsUrl(campaign)}?domainId=${wave.id}`, player);
      expect(response.statusCode).toBe(200);
      const cards = response.json<{ cards: DomainCardSummary[] }>().cards;
      expect(cards.map((card) => card.name)).toEqual(['Undertow', 'Breaker', 'Crest']);
      expect(cards[0]).not.toHaveProperty('feature');
      expect((await call('GET', `${cardsUrl(campaign)}?domainId=nope`, gm)).statusCode).toBe(400);
    });

    it("refuses another campaign's domain, and bad numbers", async () => {
      const other = await newCampaign('Card Thief');
      const [theirs] = await domainsOf(other);
      const refused = await call('POST', cardsUrl(campaign), gm, {
        domainId: theirs?.id,
        name: 'Stolen',
      });
      expect(refused.statusCode).toBe(404);
      expect(refused.json()).toMatchObject({ message: 'Domain not found' });

      const [ours] = await domainsOf(campaign);
      for (const extra of [{ level: 0 }, { level: 11 }, { recallCost: -1 }, { type: 'trick' }]) {
        const response = await call('POST', cardsUrl(campaign), gm, {
          domainId: ours?.id,
          name: 'Odd',
          ...extra,
        });
        expect(response.statusCode, JSON.stringify(extra)).toBe(400);
      }
    });

    it('lets a player read cards but not write them', async () => {
      const [domain] = await domainsOf(campaign);
      const card = await newCard(domain?.id ?? '', 'Readable');
      expect((await call('GET', `${cardsUrl(campaign)}/${card.id}`, player)).json()).toMatchObject({
        name: 'Readable',
      });
      expect(
        (await call('POST', cardsUrl(campaign), player, { domainId: domain?.id, name: 'Mine' }))
          .statusCode,
      ).toBe(403);
      expect((await call('DELETE', `${cardsUrl(campaign)}/${card.id}`, player)).statusCode).toBe(
        403,
      );
    });
  });

  it('refuses every write while the campaign is archived', async () => {
    const shelf = await newCampaign('Shelved Gameplay');
    const [domain] = await domainsOf(shelf);
    const card = await newCard(domain?.id ?? '', 'Dusty', {}, shelf);
    expect((await call('POST', `/api/campaigns/${shelf.id}/archive`, gm)).statusCode).toBe(200);
    for (const [method, url, body] of [
      ['POST', domainsUrl(shelf), { name: 'Late' }],
      ['PATCH', `${domainsUrl(shelf)}/${domain?.id ?? ''}`, { name: 'Late' }],
      ['DELETE', `${cardsUrl(shelf)}/${card.id}`, undefined],
    ] as const) {
      expect((await call(method, url, gm, body)).statusCode, `${method} ${url}`).toBe(409);
    }
    expect(await domainsOf(shelf)).toHaveLength(10);
  });

  describe('copying gameplay records at creation (19.14)', () => {
    it("copies domains, cards and stat blocks, then each campaign's change their own", async () => {
      const source = await newCampaign('Copy Source');
      const tide = await newDomain('Tide', source);
      await newCard(tide.id, 'Riptide', { level: 4, recallCost: 2, type: 'spell' }, source);
      const blockResponse = await call('POST', `/api/campaigns/${source.id}/stat-blocks`, gm, {
        name: 'Harbor Golem',
        tier: 2,
        role: 'Bruiser',
      });
      const block = blockResponse.json<StatBlock>();
      await call('PATCH', `/api/campaigns/${source.id}/stat-blocks/${block.id}`, gm, { hpMax: 9 });

      const copy = await newCampaign('Copy Target', gm, source.id);
      const copied = await domainsOf(copy);
      expect(copied.map((domain) => domain.name)).toEqual(
        (await domainsOf(source)).map((domain) => domain.name),
      );
      const copiedTide = copied.find((domain) => domain.name === 'Tide');
      expect(copiedTide?.id).not.toBe(tide.id);
      const tideCards = (
        await call('GET', `${domainsUrl(copy)}/${copiedTide?.id ?? ''}`, gm)
      ).json<Domain>().cards;
      expect(tideCards).toMatchObject([
        { name: 'Riptide', domainId: copiedTide?.id, level: 4, recallCost: 2, type: 'spell' },
      ]);
      const blocks = (await call('GET', `/api/campaigns/${copy.id}/stat-blocks`, gm)).json<{
        statBlocks: StatBlockSummary[];
      }>().statBlocks;
      expect(blocks).toMatchObject([
        { name: 'Harbor Golem', tier: 2, role: 'Bruiser', usedByCount: 0 },
      ]);
      const copiedBlock = (
        await call('GET', `/api/campaigns/${copy.id}/stat-blocks/${blocks[0]?.id ?? ''}`, gm)
      ).json<StatBlock>();
      expect(copiedBlock.hpMax).toBe(9);

      // Apart from now on.
      await call('PATCH', `${domainsUrl(copy)}/${copiedTide?.id ?? ''}`, gm, { name: 'Ebb' });
      const sourceTide = (await call('GET', `${domainsUrl(source)}/${tide.id}`, gm)).json<Domain>();
      expect(sourceTide.name).toBe('Tide');
    });

    it("refuses a campaign the GM only plays in, or isn't in", async () => {
      const theirs = await newCampaign("Someone Else's", stranger);
      const playing = await newCampaign('Played In', stranger);
      await join(playing, gm);
      for (const from of [theirs.id, playing.id]) {
        const response = await call('POST', '/api/campaigns', gm, {
          name: 'Borrowed',
          copyGameplayFrom: from,
        });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ message: 'Campaign not found' });
      }
    });

    it('copies from an archived campaign the user ran', async () => {
      const old = await newCampaign('Old Campaign');
      await newDomain('Relic', old);
      await call('POST', `/api/campaigns/${old.id}/archive`, gm);
      const fresh = await newCampaign('New Campaign', gm, old.id);
      expect((await domainsOf(fresh)).map((domain) => domain.name)).toContain('Relic');
    });
  });
});
