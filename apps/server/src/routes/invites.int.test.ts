/**
 * Invites, joining, members and PCs (F1.2), against a real Postgres. Route-level isolation
 * (outsiders get 404, players get 403) is in the table in `campaigns.int.test.ts`; this file
 * covers behaviour, and inner ids (an invite, member or PC) from another campaign.
 */
import type { Campaign, Character, Invite, InvitePreview, Member } from '@stagehand/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, discordUser, SAME_ORIGIN, signIn } from '../../test/auth-helpers';
import type { DbHandle } from '../db/client';
import { campaignMembers, characters, invites, users } from '../db/schema';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

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

describe('Invites, members and PCs', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let alice: Person;
  let bob: Person;
  let outsider: Person;

  beforeAll(async () => {
    ({ app, handle } = await buildTestApp());
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('3001', 'Game Master');
    alice = await person('3002', 'Alice');
    bob = await person('3003', 'Bob');
    outsider = await person('3004', 'Outsider');
  });

  afterAll(async () => {
    await app.close();
  });

  function call(
    method: Method,
    url: string,
    who: Person | null,
    payload?: Record<string, unknown>,
    headers: Record<string, string> = SAME_ORIGIN,
  ) {
    return app.inject({
      method,
      url,
      headers: { ...headers, cookie: who?.cookie ?? '' },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function newCampaign(name: string): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', gm, { name });
    expect(response.statusCode).toBe(201);
    return response.json<Campaign>();
  }

  async function newInvite(campaignId: string, expiresIn = 'never'): Promise<Invite> {
    const response = await call('POST', `/api/campaigns/${campaignId}/invites`, gm, { expiresIn });
    expect(response.statusCode).toBe(201);
    return response.json<Invite>();
  }

  async function join(campaignId: string, who: Person): Promise<void> {
    const { code } = await newInvite(campaignId);
    expect((await call('POST', `/api/invites/${code}/accept`, who)).statusCode).toBe(200);
  }

  async function members(campaignId: string, who: Person = gm): Promise<Member[]> {
    const response = await call('GET', `/api/campaigns/${campaignId}/members`, who);
    expect(response.statusCode).toBe(200);
    return response.json<{ members: Member[] }>().members;
  }

  async function pcs(campaignId: string): Promise<Character[]> {
    const response = await call('GET', `/api/campaigns/${campaignId}/characters`, gm);
    expect(response.statusCode).toBe(200);
    return response.json<{ characters: Character[] }>().characters;
  }

  async function createPc(campaignId: string, name: string, assignTo?: Person) {
    return call('POST', `/api/campaigns/${campaignId}/characters`, gm, {
      name,
      ...(assignTo === undefined ? {} : { assignToUserId: assignTo.id }),
    });
  }

  function assign(campaignId: string, who: Person, characterId: string | null) {
    return call('PUT', `/api/campaigns/${campaignId}/members/${who.id}/character`, gm, {
      characterId,
    });
  }

  const pcOf = async (campaignId: string, who: Person) =>
    (await members(campaignId)).find((m) => m.userId === who.id)?.character ?? null;

  describe('invite links', () => {
    it('are created, listed newest first, and revoked', async () => {
      const campaign = await newCampaign('Link Campaign');
      const forever = await newInvite(campaign.id, 'never');
      const week = await newInvite(campaign.id, '7d');

      expect(forever.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(forever.expiresAt).toBeNull();
      const weekMs = Date.parse(week.expiresAt ?? '') - Date.now();
      expect(weekMs).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
      expect(weekMs).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);

      const listUrl = `/api/campaigns/${campaign.id}/invites`;
      expect((await call('GET', listUrl, gm)).json()).toEqual({ invites: [week, forever] });

      const revokeUrl = `${listUrl}/${forever.id}/revoke`;
      expect((await call('POST', revokeUrl, gm)).statusCode).toBe(204);
      expect((await call('POST', revokeUrl, gm)).statusCode).toBe(204); // idempotent
      expect((await call('GET', listUrl, gm)).json()).toEqual({ invites: [week] });

      const preview = await call('GET', `/api/invites/${forever.code}`, alice);
      expect(preview.statusCode).toBe(404);
      expect(preview.json()).toMatchObject({
        message: 'This invite link has expired or been revoked',
      });
    });

    it('stop working once expired', async () => {
      const campaign = await newCampaign('Expiring Campaign');
      const invite = await newInvite(campaign.id, '1d');
      await handle.db
        .update(invites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(invites.id, invite.id));

      expect((await call('GET', `/api/invites/${invite.code}`, alice)).statusCode).toBe(404);
      expect((await call('POST', `/api/invites/${invite.code}/accept`, alice)).statusCode).toBe(
        404,
      );
      expect((await call('GET', `/api/campaigns/${campaign.id}/invites`, gm)).json()).toEqual({
        invites: [],
      });
    });

    it('reject unknown expiry choices', async () => {
      const campaign = await newCampaign('Validation Campaign');
      const response = await call('POST', `/api/campaigns/${campaign.id}/invites`, gm, {
        expiresIn: '30d',
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('joining', () => {
    it('previews, then joins as a player', async () => {
      const campaign = await newCampaign('Join Campaign');
      const { code } = await newInvite(campaign.id);

      const preview = await call('GET', `/api/invites/${code}`, alice);
      expect(preview.statusCode).toBe(200);
      expect(preview.json<InvitePreview>()).toEqual({
        campaignId: campaign.id,
        campaignName: 'Join Campaign',
        gmDisplayName: 'Game Master',
        alreadyMember: false,
      });

      const accepted = await call('POST', `/api/invites/${code}/accept`, alice);
      expect(accepted.json()).toEqual({ campaignId: campaign.id });

      const list = await call('GET', '/api/campaigns', alice);
      expect(list.json<{ campaigns: Campaign[] }>().campaigns).toContainEqual(
        expect.objectContaining({ id: campaign.id, role: 'player' }),
      );
      expect((await call('GET', `/api/invites/${code}`, alice)).json()).toMatchObject({
        alreadyMember: true,
      });
    });

    it('is a no-op for existing members, including the GM', async () => {
      const campaign = await newCampaign('Repeat Campaign');
      const { code } = await newInvite(campaign.id);

      for (const who of [alice, alice, gm]) {
        const response = await call('POST', `/api/invites/${code}/accept`, who);
        expect(response.json()).toEqual({ campaignId: campaign.id });
      }
      expect((await members(campaign.id)).map((m) => [m.displayName, m.role])).toEqual([
        ['Game Master', 'gm'],
        ['Alice', 'player'],
      ]);
    });

    it("doesn't work for archived campaigns", async () => {
      const campaign = await newCampaign('Archived Join Campaign');
      const { code } = await newInvite(campaign.id);
      await call('POST', `/api/campaigns/${campaign.id}/archive`, gm);

      expect((await call('GET', `/api/invites/${code}`, alice)).statusCode).toBe(404);
      expect((await call('POST', `/api/invites/${code}/accept`, alice)).statusCode).toBe(404);

      await call('POST', `/api/campaigns/${campaign.id}/unarchive`, gm);
      expect((await call('GET', `/api/invites/${code}`, alice)).statusCode).toBe(200);
    });

    it('answers malformed and unknown codes with the same 404', async () => {
      for (const code of ['short', 'AAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAA..']) {
        const preview = await call('GET', `/api/invites/${code}`, alice);
        expect(preview.statusCode, code).toBe(404);
        expect(preview.json()).toMatchObject({
          message: 'This invite link has expired or been revoked',
        });
        expect((await call('POST', `/api/invites/${code}/accept`, alice)).statusCode, code).toBe(
          404,
        );
      }
    });

    it('requires a session, and a same-origin accept', async () => {
      const campaign = await newCampaign('Session Campaign');
      const { code } = await newInvite(campaign.id);

      expect((await call('GET', `/api/invites/${code}`, null)).statusCode).toBe(401);
      expect((await call('POST', `/api/invites/${code}/accept`, null)).statusCode).toBe(401);
      const crossOrigin = await call('POST', `/api/invites/${code}/accept`, alice, undefined, {
        origin: 'https://evil.example',
      });
      expect(crossOrigin.statusCode).toBe(403);
      expect(await members(campaign.id)).toHaveLength(1);
    });
  });

  describe('members and PCs', () => {
    let campaign: Campaign;

    beforeAll(async () => {
      campaign = await newCampaign('Party Campaign');
      await join(campaign.id, alice);
      await join(campaign.id, bob);
    });

    it('shows players the roster: the GM first, then players by name', async () => {
      const roster = await members(campaign.id, bob);
      expect(roster.map((m) => [m.displayName, m.role, m.character])).toEqual([
        ['Game Master', 'gm', null],
        ['Alice', 'player', null],
        ['Bob', 'player', null],
      ]);
    });

    it('creates and assigns PCs, and moves a PC between players', async () => {
      const created = await createPc(campaign.id, '  Vex  ', alice);
      expect(created.statusCode).toBe(201);
      const vex = created.json<Character>();
      expect(vex).toMatchObject({ name: 'Vex', assignedToUserId: alice.id });

      const spare = (await createPc(campaign.id, 'Spare')).json<Character>();
      expect(spare.assignedToUserId).toBeNull();
      expect((await assign(campaign.id, bob, spare.id)).statusCode).toBe(204);
      expect(await pcOf(campaign.id, bob)).toEqual({ id: spare.id, name: 'Spare' });

      // Vex moves from Alice to Bob; Bob's old PC is left unassigned.
      expect((await assign(campaign.id, bob, vex.id)).statusCode).toBe(204);
      expect(await pcOf(campaign.id, alice)).toBeNull();
      expect(await pcOf(campaign.id, bob)).toEqual({ id: vex.id, name: 'Vex' });
      expect(await pcs(campaign.id)).toEqual([
        { id: spare.id, name: 'Spare', assignedToUserId: null },
        { id: vex.id, name: 'Vex', assignedToUserId: bob.id },
      ]);

      expect((await assign(campaign.id, bob, null)).statusCode).toBe(204);
      expect(await pcOf(campaign.id, bob)).toBeNull();
    });

    it('refuses PCs for the GM, non-members and other campaigns', async () => {
      const pc = (await createPc(campaign.id, 'Nobody')).json<Character>();

      const toGm = await assign(campaign.id, gm, pc.id);
      expect(toGm.statusCode).toBe(409);
      expect(toGm.json()).toMatchObject({ message: 'Only players can have a PC' });
      expect((await createPc(campaign.id, 'GM PC', gm)).statusCode).toBe(409);

      expect((await assign(campaign.id, outsider, pc.id)).statusCode).toBe(404);

      const other = await newCampaign('Other Campaign');
      const foreign = (await createPc(other.id, 'Foreign')).json<Character>();
      const response = await assign(campaign.id, alice, foreign.id);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ message: 'Character not found' });

      // A failed create-and-assign creates nothing.
      const before = (await pcs(campaign.id)).length;
      expect((await createPc(campaign.id, 'Orphan', outsider)).statusCode).toBe(404);
      expect(await pcs(campaign.id)).toHaveLength(before);
    });

    it('lets a player leave, keeping their PC unassigned', async () => {
      const room = await newCampaign('Leave Campaign');
      await join(room.id, alice);
      const pc = (await createPc(room.id, 'Leaver', alice)).json<Character>();

      // A player can't remove someone else.
      expect(
        (await call('DELETE', `/api/campaigns/${room.id}/members/${gm.id}`, alice)).statusCode,
      ).toBe(403);

      const left = await call('DELETE', `/api/campaigns/${room.id}/members/${alice.id}`, alice);
      expect(left.statusCode).toBe(204);
      expect((await call('GET', `/api/campaigns/${room.id}`, alice)).statusCode).toBe(404);
      expect(await pcs(room.id)).toEqual([{ id: pc.id, name: 'Leaver', assignedToUserId: null }]);
    });

    it('lets the GM remove a player, but never the GM', async () => {
      const room = await newCampaign('Remove Campaign');
      await join(room.id, bob);
      await createPc(room.id, 'Removed', bob);

      const removed = await call('DELETE', `/api/campaigns/${room.id}/members/${bob.id}`, gm);
      expect(removed.statusCode).toBe(204);
      expect((await call('GET', `/api/campaigns/${room.id}`, bob)).statusCode).toBe(404);
      expect((await pcs(room.id))[0]?.assignedToUserId).toBeNull();

      const gmLeaves = await call('DELETE', `/api/campaigns/${room.id}/members/${gm.id}`, gm);
      expect(gmLeaves.statusCode).toBe(409);
      expect(
        (await call('DELETE', `/api/campaigns/${room.id}/members/${outsider.id}`, gm)).statusCode,
      ).toBe(404);
    });

    it('while archived, refuses new links and PCs but still lets access be removed', async () => {
      const room = await newCampaign('Archived Party');
      const invite = await newInvite(room.id);
      await join(room.id, alice);
      await join(room.id, bob);
      const pc = (await createPc(room.id, 'Frozen')).json<Character>();
      await call('POST', `/api/campaigns/${room.id}/archive`, gm);

      expect((await createPc(room.id, 'Late')).statusCode).toBe(409);
      expect((await assign(room.id, alice, pc.id)).statusCode).toBe(409);
      expect(
        (await call('POST', `/api/campaigns/${room.id}/invites`, gm, { expiresIn: 'never' }))
          .statusCode,
      ).toBe(409);

      expect(
        (await call('POST', `/api/campaigns/${room.id}/invites/${invite.id}/revoke`, gm))
          .statusCode,
      ).toBe(204);
      expect(
        (await call('DELETE', `/api/campaigns/${room.id}/members/${alice.id}`, gm)).statusCode,
      ).toBe(204);
      expect(
        (await call('DELETE', `/api/campaigns/${room.id}/members/${bob.id}`, bob)).statusCode,
      ).toBe(204);
    });

    it("can't reach another campaign's invites or members through its own campaign", async () => {
      const mine = await newCampaign('Mine');
      const theirs = await newCampaign('Theirs');
      const theirInvite = await newInvite(theirs.id);
      await join(theirs.id, bob);

      const revoke = await call(
        'POST',
        `/api/campaigns/${mine.id}/invites/${theirInvite.id}/revoke`,
        gm,
      );
      expect(revoke.statusCode).toBe(404);
      expect((await call('GET', `/api/invites/${theirInvite.code}`, alice)).statusCode).toBe(200);

      const remove = await call('DELETE', `/api/campaigns/${mine.id}/members/${bob.id}`, gm);
      expect(remove.statusCode).toBe(404);
      expect(await members(theirs.id)).toHaveLength(2);

      for (const id of ['not-a-uuid', '1']) {
        expect(
          (await call('POST', `/api/campaigns/${mine.id}/invites/${id}/revoke`, gm)).statusCode,
        ).toBe(404);
        expect(
          (await call('DELETE', `/api/campaigns/${mine.id}/members/${id}`, gm)).statusCode,
        ).toBe(404);
      }
    });

    describe('database rules', () => {
      it('only lets a PC be held within its own campaign (composite FK)', async () => {
        const other = await newCampaign('FK Campaign');
        const foreign = (await createPc(other.id, 'Foreign Two')).json<Character>();

        const error = await failureOf(
          handle.db
            .update(campaignMembers)
            .set({ characterId: foreign.id })
            .where(
              and(
                eq(campaignMembers.campaignId, campaign.id),
                eq(campaignMembers.userId, alice.id),
              ),
            ),
        );
        expect(pgCode(error)).toBe('23503'); // foreign_key_violation
      });

      it('never lets the GM hold a PC (check constraint)', async () => {
        const [pc] = await handle.db
          .insert(characters)
          .values({ campaignId: campaign.id, name: 'GM Only' })
          .returning();

        const error = await failureOf(
          handle.db
            .update(campaignMembers)
            .set({ characterId: pc?.id ?? null })
            .where(
              and(eq(campaignMembers.campaignId, campaign.id), eq(campaignMembers.userId, gm.id)),
            ),
        );
        expect(pgCode(error)).toBe('23514'); // check_violation
      });
    });
  });
});
