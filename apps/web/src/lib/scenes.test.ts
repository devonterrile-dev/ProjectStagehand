import {
  SCENE_MAX_OBJECTS,
  SCENE_SCALE,
  setSceneObjectsRequestSchema,
  type SceneObject,
  type StageRecord,
} from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import {
  addRefusal,
  changeObject,
  NEW_DEPTH_TICK,
  placeRecord,
  stageCutouts,
  toObjectInput,
} from './scenes';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAMPAIGN = id(900);
const IMAGE = { assetId: id(500), width: 640, height: 1024, version: 3 };

const WELL: StageRecord = {
  record: { id: id(1), type: 'prop', name: 'Stone Well' },
  kind: 'prop',
  image: IMAGE,
};
const SMITH: StageRecord = {
  record: { id: id(2), type: 'npc', name: 'Smith Orla' },
  kind: 'puppet',
  image: { ...IMAGE, assetId: id(501) },
};

/** `count` copies of the well, placed one after another. */
function wells(count: number): SceneObject[] {
  const objects: SceneObject[] = [];
  for (let n = 0; n < count; n += 1) objects.push(placeRecord(objects, WELL, id(100 + n)));
  return objects;
}

describe('placeRecord', () => {
  it('stands a prop on the bottom edge, shown, in the middle of the depth', () => {
    expect(placeRecord([], WELL, id(10))).toEqual({
      id: id(10),
      kind: 'prop',
      record: WELL.record,
      image: IMAGE,
      across: 0.5,
      up: 0,
      depthTick: NEW_DEPTH_TICK,
      scale: 1,
      flipped: false,
      shown: true,
      mount: 'stand',
    });
  });

  it('puts a puppet on a stick, lowered, a little above the bottom edge', () => {
    expect(placeRecord([], SMITH, id(11))).toMatchObject({
      kind: 'puppet',
      up: 0.1,
      shown: false,
      mount: null,
    });
  });

  it('spreads new objects across the opening instead of piling them up', () => {
    const placed = wells(6).map((object) => object.across);
    expect(new Set(placed.slice(0, 5)).size).toBe(5);
    expect(placed[5]).toBe(placed[0]);
    expect(placed.every((across) => across >= 0 && across <= 1)).toBe(true);
  });
});

describe('addRefusal', () => {
  it('lets a prop repeat but a puppet only once', () => {
    const scene = [placeRecord([], WELL, id(10)), placeRecord([], SMITH, id(11))];
    expect(addRefusal(scene, WELL)).toBeNull();
    expect(addRefusal(scene, SMITH)).toBe('already-placed');
    expect(addRefusal([], SMITH)).toBeNull();
  });

  it('refuses a record with no image, and anything once the scene is full', () => {
    expect(addRefusal([], { ...WELL, image: null })).toBe('no-image');
    expect(addRefusal(wells(SCENE_MAX_OBJECTS - 1), WELL)).toBeNull();
    expect(addRefusal(wells(SCENE_MAX_OBJECTS), WELL)).toBe('full');
  });
});

describe('changeObject', () => {
  const well = placeRecord([], WELL, id(10));
  const smith = placeRecord([], SMITH, id(11));

  it('keeps an object inside the opening, on a tick, at an allowed size', () => {
    expect(changeObject(well, { across: 1.4, up: -0.2 })).toMatchObject({ across: 1, up: 0 });
    expect(changeObject(well, { depthTick: 12 }).depthTick).toBe(9);
    expect(changeObject(well, { depthTick: -1 }).depthTick).toBe(0);
    expect(changeObject(well, { scale: 9 }).scale).toBe(SCENE_SCALE.max);
    expect(changeObject(well, { scale: 0 }).scale).toBe(SCENE_SCALE.min);
  });

  it('hides and hangs a prop, but never shows or mounts a puppet', () => {
    expect(changeObject(well, { shown: false, mount: 'hang', flipped: true })).toMatchObject({
      shown: false,
      mount: 'hang',
      flipped: true,
    });
    expect(changeObject(smith, { shown: true, mount: 'hang' })).toMatchObject({
      shown: false,
      mount: null,
    });
  });

  it('never changes which record an object is', () => {
    const changed = changeObject(well, { id: id(99), kind: 'puppet', record: SMITH.record });
    expect(changed).toMatchObject({ id: well.id, kind: 'prop', record: WELL.record });
  });
});

describe('toObjectInput', () => {
  it('sends what the server accepts: shown and mount for props only', () => {
    const well = changeObject(placeRecord([], WELL, id(10)), { shown: false, mount: 'hang' });
    const smith = placeRecord([], SMITH, id(11));

    expect(toObjectInput(well)).toEqual({
      id: id(10),
      recordId: WELL.record.id,
      across: 0.5,
      up: 0,
      depthTick: NEW_DEPTH_TICK,
      scale: 1,
      flipped: false,
      shown: false,
      mount: 'hang',
    });
    expect(toObjectInput(smith)).not.toHaveProperty('shown');
    expect(toObjectInput(smith)).not.toHaveProperty('mount');
    expect(
      setSceneObjectsRequestSchema.safeParse({ objects: [well, smith].map(toObjectInput) }).success,
    ).toBe(true);
  });
});

describe('stageCutouts', () => {
  const shown = placeRecord([], WELL, id(10));
  const hidden = changeObject(placeRecord([], WELL, id(11)), { shown: false, mount: 'hang' });
  const puppet = placeRecord([], SMITH, id(12));
  const noImage = { ...placeRecord([], WELL, id(13)), image: null };
  const scene = [shown, hidden, puppet, noImage];

  it('while building, fades hidden props and stands puppets where they will rise to', () => {
    const cutouts = stageCutouts(CAMPAIGN, scene, { preview: false });

    expect(
      cutouts.map((cutout) => [cutout.id, cutout.mount, cutout.faded, cutout.lowered]),
    ).toEqual([
      [id(10), 'stand', false, false],
      [id(11), 'hang', true, false],
      [id(12), 'stick', false, false],
    ]);
    expect(cutouts[0]).toMatchObject({
      url: `/api/campaigns/${CAMPAIGN}/assets/${IMAGE.assetId}/image?p=3`,
      width: 640,
      height: 1024,
    });
  });

  it('in preview, drops hidden props and lowers puppets, as players first see it', () => {
    const cutouts = stageCutouts(CAMPAIGN, scene, { preview: true });

    expect(cutouts.map((cutout) => [cutout.id, cutout.faded, cutout.lowered])).toEqual([
      [id(10), false, false],
      [id(12), false, true],
    ]);
  });
});
