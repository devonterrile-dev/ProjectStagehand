import { describe, expect, it } from 'vitest';

import {
  createSceneRequestSchema,
  LIKELY_NEXT_MAX,
  SCENE_MAX_OBJECTS,
  SCENE_SCALE,
  sceneObjectInputSchema,
  sceneObjectKindFor,
  setSceneObjectsRequestSchema,
  updateSceneRequestSchema,
} from './scenes';
import { SESSION_MAX_PLAYERS, STAGE_MAX_OBJECTS } from './stage';

const SPOT = '00000000-0000-4000-8000-0000000000aa';
const RECORD = '00000000-0000-4000-8000-0000000000bb';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const object = (overrides: Record<string, unknown> = {}) => ({
  id: id(1),
  recordId: RECORD,
  across: 0.5,
  up: 0,
  depthTick: 5,
  scale: 1,
  flipped: false,
  ...overrides,
});

describe('scene limits', () => {
  it('leaves a seat in the 30-object budget for each of the 6 PCs', () => {
    expect(SESSION_MAX_PLAYERS).toBe(6);
    expect(SCENE_MAX_OBJECTS).toBe(STAGE_MAX_OBJECTS - 6);
    expect(SCENE_MAX_OBJECTS).toBe(24);
  });
});

describe('sceneObjectKindFor', () => {
  it('makes Props and Items props, NPCs puppets, and nothing else placeable', () => {
    expect(sceneObjectKindFor('prop')).toBe('prop');
    expect(sceneObjectKindFor('item')).toBe('prop');
    expect(sceneObjectKindFor('npc')).toBe('puppet');
    for (const type of [
      'area',
      'spot',
      'faction',
      'lore',
      'story_beat',
      'session_notes',
    ] as const) {
      expect(sceneObjectKindFor(type)).toBeNull();
    }
  });
});

describe('createSceneRequestSchema', () => {
  it('needs a name, with an optional Spot', () => {
    expect(createSceneRequestSchema.parse({ name: ' The Market ' })).toEqual({
      name: 'The Market',
    });
    expect(createSceneRequestSchema.parse({ name: 'M', spotId: SPOT })).toEqual({
      name: 'M',
      spotId: SPOT,
    });
    expect(createSceneRequestSchema.safeParse({ name: 'M', spotId: null }).success).toBe(true);
    expect(createSceneRequestSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(createSceneRequestSchema.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
    expect(createSceneRequestSchema.safeParse({ name: 'M', spotId: 'nope' }).success).toBe(false);
    // The type is always static for now.
    expect(createSceneRequestSchema.safeParse({ name: 'M', type: 'battle' }).success).toBe(false);
  });
});

describe('updateSceneRequestSchema', () => {
  it('accepts a name, a Spot or no Spot, but not nothing', () => {
    expect(updateSceneRequestSchema.safeParse({ name: 'Dusk' }).success).toBe(true);
    expect(updateSceneRequestSchema.safeParse({ spotId: SPOT }).success).toBe(true);
    expect(updateSceneRequestSchema.safeParse({ spotId: null }).success).toBe(true);
    expect(updateSceneRequestSchema.safeParse({}).success).toBe(false);
    expect(updateSceneRequestSchema.safeParse({ name: null }).success).toBe(false);
    expect(updateSceneRequestSchema.safeParse({ objects: [] }).success).toBe(false);
  });

  it('takes up to 6 likely next scenes, each once, and an empty list (F5.2)', () => {
    const six = [1, 2, 3, 4, 5, 6].map(id);
    expect(LIKELY_NEXT_MAX).toBe(6);
    expect(updateSceneRequestSchema.safeParse({ nextSceneIds: six }).success).toBe(true);
    expect(updateSceneRequestSchema.safeParse({ nextSceneIds: [] }).success).toBe(true);
    expect(updateSceneRequestSchema.safeParse({ nextSceneIds: [...six, id(7)] }).success).toBe(
      false,
    );
    expect(updateSceneRequestSchema.safeParse({ nextSceneIds: [id(1), id(1)] }).success).toBe(
      false,
    );
    expect(updateSceneRequestSchema.safeParse({ nextSceneIds: ['nope'] }).success).toBe(false);
  });
});

describe('sceneObjectInputSchema', () => {
  it('accepts an object anywhere inside the opening, on any tick', () => {
    expect(sceneObjectInputSchema.safeParse(object()).success).toBe(true);
    expect(
      sceneObjectInputSchema.safeParse(object({ across: 0, up: 1, depthTick: 0 })).success,
    ).toBe(true);
    expect(
      sceneObjectInputSchema.safeParse(
        object({ across: 1, up: 0, depthTick: 9, shown: false, mount: 'hang', flipped: true }),
      ).success,
    ).toBe(true);
  });

  it('rejects places outside the opening, bad ticks and bad sizes', () => {
    for (const bad of [
      { across: -0.01 },
      { across: 1.01 },
      { up: -0.2 },
      { up: 1.5 },
      { depthTick: 10 },
      { depthTick: 2.5 },
      { scale: SCENE_SCALE.min - 0.01 },
      { scale: SCENE_SCALE.max + 0.01 },
      { mount: 'stick' },
      { flipped: 'yes' },
      { id: 'one' },
      { kind: 'puppet' },
    ]) {
      expect(sceneObjectInputSchema.safeParse(object(bad)).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
    expect(sceneObjectInputSchema.safeParse(object({ recordId: undefined })).success).toBe(false);
  });
});

describe('setSceneObjectsRequestSchema', () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_unused, index) => object({ id: id(index + 1) }));

  it('takes an empty list and a full one, but no more', () => {
    expect(setSceneObjectsRequestSchema.safeParse({ objects: [] }).success).toBe(true);
    expect(
      setSceneObjectsRequestSchema.safeParse({ objects: many(SCENE_MAX_OBJECTS) }).success,
    ).toBe(true);
    expect(
      setSceneObjectsRequestSchema.safeParse({ objects: many(SCENE_MAX_OBJECTS + 1) }).success,
    ).toBe(false);
    expect(setSceneObjectsRequestSchema.safeParse({}).success).toBe(false);
  });

  it('wants a different id for each object', () => {
    expect(
      setSceneObjectsRequestSchema.safeParse({ objects: [object(), object({ across: 0.2 })] })
        .success,
    ).toBe(false);
  });
});
