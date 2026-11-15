import { describe, expect, it } from 'vitest';

import {
  actionResultSchema,
  gmStageSchema,
  joinRequestSchema,
  joinResultSchema,
  liveStageSchema,
  loadSceneRequestSchema,
  PLAY_SOCKET,
  playerStageSchema,
  presenceSchema,
} from './play-sessions';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const session = { id: id(1), number: 3, startedAt: '2026-11-15T19:00:00.000Z' };
const image = { assetId: id(2), width: 640, height: 1024, version: 3 };
const placed = {
  id: id(3),
  kind: 'prop',
  across: 0.5,
  up: 0,
  depthTick: 5,
  scale: 1,
  flipped: false,
  mount: 'stand',
};
const stage = { session, sceneLoad: 1, curtainOpen: true, backdrop: image };

describe('the players’ stage', () => {
  it('keeps an image and a place for each object, and drops everything else', () => {
    const parsed = playerStageSchema.parse({
      role: 'player',
      ...stage,
      // What a careless server might send along: none of it may reach a player.
      scene: { id: id(9), name: 'The ambush' },
      objects: [
        {
          ...placed,
          image,
          shown: true,
          record: { id: id(4), type: 'prop', name: 'The cursed well' },
          hiddenDetails: 'A key at the bottom',
        },
      ],
    });

    expect(parsed).toEqual({ role: 'player', ...stage, objects: [{ ...placed, image }] });
    expect(JSON.stringify(parsed)).not.toContain('cursed');
    expect(JSON.stringify(parsed)).not.toContain('ambush');
  });

  it('refuses an object with no image: a player is only sent what can be drawn', () => {
    const result = playerStageSchema.safeParse({
      role: 'player',
      ...stage,
      objects: [{ ...placed, image: null }],
    });

    expect(result.success).toBe(false);
  });
});

describe('the GM’s stage', () => {
  const object = {
    ...placed,
    record: { id: id(4), type: 'prop', name: 'The cursed well' },
    image: null,
    shown: false,
  };

  it('holds every object, in sight or not, with its record', () => {
    const parsed = gmStageSchema.parse({
      role: 'gm',
      ...stage,
      scene: { id: id(9), name: 'The ambush' },
      objects: [object],
    });

    expect(parsed.objects).toEqual([object]);
    expect(parsed.scene?.name).toBe('The ambush');
  });

  it('is told apart from a player’s by its role', () => {
    const gm = liveStageSchema.parse({ role: 'gm', ...stage, scene: null, objects: [object] });
    const player = liveStageSchema.parse({ role: 'player', ...stage, objects: [] });

    expect(gm.role).toBe('gm');
    expect(player.role).toBe('player');
    expect('scene' in player).toBe(false);
  });
});

describe('the live room’s messages', () => {
  it('uses the event names of governance §13', () => {
    expect(PLAY_SOCKET.loadScene).toBe('scene:load');
    expect(PLAY_SOCKET.openCurtain).toBe('scene:curtain.open');
    expect(PLAY_SOCKET.closeCurtain).toBe('scene:curtain.close');
    expect(PLAY_SOCKET.path).toBe('/socket.io');
  });

  it('takes a campaign id to join, and nothing else', () => {
    expect(joinRequestSchema.safeParse({ campaignId: id(1) }).success).toBe(true);
    expect(joinRequestSchema.safeParse({ campaignId: 'nope' }).success).toBe(false);
    expect(joinRequestSchema.safeParse({ campaignId: id(1), role: 'gm' }).success).toBe(false);
  });

  it('answers a join with the stage, or with why not', () => {
    const joined = joinResultSchema.parse({
      status: 'joined',
      stage: { role: 'player', ...stage, objects: [] },
      presence: [
        { userId: id(5), displayName: 'Mara', avatarUrl: null, role: 'gm', characterName: null },
      ],
    });

    expect(joined.status).toBe('joined');
    for (const status of ['no-session', 'full', 'not-found']) {
      expect(joinResultSchema.parse({ status })).toEqual({ status });
    }
    expect(joinResultSchema.safeParse({ status: 'kicked' }).success).toBe(false);
  });

  it('takes a scene id to load', () => {
    expect(loadSceneRequestSchema.safeParse({ sceneId: id(1) }).success).toBe(true);
    expect(loadSceneRequestSchema.safeParse({}).success).toBe(false);
  });

  it('answers an action with ok, or with a reason', () => {
    expect(actionResultSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(actionResultSchema.parse({ ok: false, message: 'Only the GM can do that' })).toEqual({
      ok: false,
      message: 'Only the GM can do that',
    });
    expect(actionResultSchema.safeParse({ ok: false }).success).toBe(false);
  });

  it('lists who is here with a name, a picture, a role and a PC', () => {
    const presence = presenceSchema.parse([
      {
        userId: id(5),
        displayName: 'Sam',
        avatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
        role: 'player',
        characterName: 'Vex Tidecaller',
        email: 'sam@example.com',
      },
    ]);

    expect(presence[0]).not.toHaveProperty('email');
    expect(presence[0]?.characterName).toBe('Vex Tidecaller');
  });
});
