import { describe, expect, it } from 'vitest';

import {
  actionResultSchema,
  addObjectRequestSchema,
  gmStageSchema,
  joinRequestSchema,
  joinResultSchema,
  liveStageSchema,
  loadSceneRequestSchema,
  moveObjectRequestSchema,
  objectRequestSchema,
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
  it('keeps an image, a place and the record to inspect for each object, and drops the rest', () => {
    const parsed = playerStageSchema.parse({
      role: 'player',
      ...stage,
      // What a careless server might send along: none of it may reach a player.
      scene: { id: id(9), name: 'The ambush' },
      objects: [
        {
          ...placed,
          image,
          recordId: id(4),
          shown: true,
          record: { id: id(4), type: 'prop', name: 'The cursed well' },
          hiddenDetails: 'A key at the bottom',
        },
      ],
    });

    expect(parsed).toEqual({
      role: 'player',
      ...stage,
      objects: [{ ...placed, image, recordId: id(4) }],
    });
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
    subject: { kind: 'record', id: id(4), type: 'prop', name: 'The cursed well', revealed: false },
    image: null,
    shown: false,
  };

  it('holds a PC as a puppet, by name', () => {
    const pc = {
      ...placed,
      kind: 'puppet',
      mount: null,
      subject: { kind: 'pc', id: id(6), name: 'Vex Tidecaller' },
      image,
      shown: true,
    };
    const parsed = gmStageSchema.parse({ role: 'gm', ...stage, scene: null, objects: [pc] });

    expect(parsed.objects).toEqual([pc]);
  });

  it('holds every object, in sight or not, with what it shows', () => {
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
    expect(PLAY_SOCKET.addObject).toBe('scene:object.add');
    expect(PLAY_SOCKET.moveObject).toBe('scene:object.move');
    expect(PLAY_SOCKET.removeObject).toBe('scene:object.remove');
    expect(PLAY_SOCKET.showProp).toBe('scene:object.show');
    expect(PLAY_SOCKET.hideProp).toBe('scene:object.hide');
    expect(PLAY_SOCKET.raisePuppet).toBe('puppet:raise');
    expect(PLAY_SOCKET.lowerPuppet).toBe('puppet:lower');
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

  it('adds a record or a PC, never both or neither, and only inside the opening', () => {
    const ok = (request: unknown) => addObjectRequestSchema.safeParse(request).success;

    expect(ok({ id: id(1), recordId: id(2) })).toBe(true);
    expect(ok({ id: id(1), characterId: id(2), across: 0.2, depthTick: 0 })).toBe(true);
    expect(ok({ id: id(1), recordId: id(2), shown: true, mount: 'hang' })).toBe(true);
    expect(ok({ id: id(1) })).toBe(false);
    expect(ok({ id: id(1), recordId: id(2), characterId: id(3) })).toBe(false);
    expect(ok({ id: id(1), recordId: id(2), across: 1.5 })).toBe(false);
    expect(ok({ id: id(1), recordId: id(2), depthTick: 10 })).toBe(false);
    expect(ok({ id: id(1), recordId: id(2), name: 'Sneaky' })).toBe(false);
  });

  it('moves an object by any of its placement, and needs something to change', () => {
    const ok = (request: unknown) => moveObjectRequestSchema.safeParse(request).success;

    expect(ok({ id: id(1), across: 0, up: 1, scale: 2.5, flipped: true })).toBe(true);
    expect(ok({ id: id(1), mount: 'stand' })).toBe(true);
    expect(ok({ id: id(1) })).toBe(false);
    expect(ok({ id: id(1), scale: 3 })).toBe(false);
    expect(ok({ id: id(1), up: -0.1 })).toBe(false);
    expect(ok({ id: id(1), shown: true })).toBe(false);
    expect(objectRequestSchema.safeParse({ id: id(1) }).success).toBe(true);
    expect(objectRequestSchema.safeParse({ id: 'well' }).success).toBe(false);
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
