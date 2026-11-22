/**
 * Tracks a player marks on their own sheet (D-67), against a real Postgres: Hope, HP, Stress and
 * armor slots, who may set them, their limits, and the GM's session log while a session runs.
 */
import {
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

describe('Tracks a player marks', () => {
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
    gm = await person('19401', 'Tracks GM');
    player = await person('19402', 'Tracks Player');
    other = await person('19403', 'Tracks Other');
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

  /** Vex, the player's PC, with 6 HP, 6 Stress slots and 3 armor slots. */
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
    const url = `${base}/characters/${vex.id}`;
    await made('PATCH', url, { hpMax: 6, hpCurrent: 6, armorSlotsMax: 3 });
    return { base, url };
  }

  it("lets the PC's player mark each track, and the GM too", async () => {
    const { url } = await world('Tracks set');
    const sheet = await made<PlayerCharacterSheet>(
      'POST',
      `${url}/tracks`,
      { hope: 3, hpCurrent: 4, stressCurrent: 2, armorSlotsMarked: 1 },
      player,
    );
    expect(sheet).toMatchObject({ hope: 3, hpCurrent: 4, stressCurrent: 2, armorSlotsMarked: 1 });
    expect('gmNotes' in sheet).toBe(false);

    const byGm = await made<CharacterSheet>('POST', `${url}/tracks`, { hpCurrent: 6 });
    expect(byGm.hpCurrent).toBe(6);
    expect((await call('POST', `${url}/tracks`, other, { hope: 1 })).statusCode).toBe(404);
  });

  it('refuses a track above its maximum, or nothing at all', async () => {
    const { url } = await world('Tracks limits');
    const cases: [Record<string, number>, string][] = [
      [{ hope: 7 }, "Hope can't be above 6"],
      [{ hpCurrent: 7 }, "HP can't be above 6"],
      [{ stressCurrent: 7 }, "Stress can't be above 6"],
      [{ armorSlotsMarked: 4 }, "Marked armor slots can't be above 3"],
    ];
    for (const [body, message] of cases) {
      const response = await call('POST', `${url}/tracks`, player, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json<{ message: string }>().message).toBe(message);
    }
    expect((await call('POST', `${url}/tracks`, player, {})).statusCode).toBe(400);
    expect((await call('POST', `${url}/tracks`, player, { hope: -1 })).statusCode).toBe(400);
  });

  it("writes the GM's log only while a session runs", async () => {
    const { base, url } = await world('Tracks log');
    await made('POST', `${url}/tracks`, { stressCurrent: 1 }, player);
    await made('POST', `${base}/play-session`);
    await made('POST', `${url}/tracks`, { stressCurrent: 3, hpCurrent: 4, hope: 2 }, player);
    await made('POST', `${url}/tracks`, { armorSlotsMarked: 1 }, player);
    const log = await made<SessionLogResponse>('GET', `${base}/play-session/log`);
    expect(log.entries.map((entry) => entry.text)).toEqual(
      expect.arrayContaining([
        'Vex marked 2 Stress (3 of 6)',
        'Vex lost 2 HP (4 of 6)',
        'Vex gained 2 Hope (2 of 6)',
        'Vex marked 1 armor slot (1 of 3)',
      ]),
    );
    expect(log.entries.filter((entry) => entry.kind === 'track_adjust')).toHaveLength(4);
    expect(log.entries.find((entry) => entry.kind === 'track_adjust')?.actorName).toBe(
      'Tracks Player',
    );
  });

  it('is refused while the campaign is archived', async () => {
    const { base, url } = await world('Tracks archived');
    await made('POST', `${base}/archive`);
    expect((await call('POST', `${url}/tracks`, player, { hope: 1 })).statusCode).toBe(409);
  });
});
