import { DEPTH_TICKS, STAGE_MAX_OBJECTS } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import { OPENING, WORLD_UNITS_PER_PIXEL } from './dimensions';
import { SAMPLE_CUTOUTS } from './samples';
import { testSceneObjects } from './test-scene';

describe('testSceneObjects', () => {
  it('makes as many objects as asked, up to the budget of 30', () => {
    expect(testSceneObjects(0, SAMPLE_CUTOUTS)).toHaveLength(0);
    expect(testSceneObjects(10, SAMPLE_CUTOUTS)).toHaveLength(10);
    expect(testSceneObjects(30, SAMPLE_CUTOUTS)).toHaveLength(STAGE_MAX_OBJECTS);
    expect(testSceneObjects(500, SAMPLE_CUTOUTS)).toHaveLength(STAGE_MAX_OBJECTS);
    expect(testSceneObjects(-3, SAMPLE_CUTOUTS)).toHaveLength(0);
    expect(testSceneObjects(Number.NaN, SAMPLE_CUTOUTS)).toHaveLength(0);
  });

  it('gives the same scene every time', () => {
    expect(testSceneObjects(30, SAMPLE_CUTOUTS)).toEqual(testSceneObjects(30, SAMPLE_CUTOUTS));
  });

  it('keeps a smaller scene as the start of a bigger one', () => {
    expect(testSceneObjects(30, SAMPLE_CUTOUTS).slice(0, 10)).toEqual(
      testSceneObjects(10, SAMPLE_CUTOUTS),
    );
  });

  it('uses every depth tick and every sample', () => {
    const objects = testSceneObjects(30, SAMPLE_CUTOUTS);
    expect(new Set(objects.map((object) => object.tick)).size).toBe(DEPTH_TICKS);
    expect(new Set(objects.map((object) => object.sampleIndex)).size).toBe(SAMPLE_CUTOUTS.length);
    for (const { tick } of objects) {
      expect(Number.isInteger(tick)).toBe(true);
      expect(tick).toBeGreaterThanOrEqual(0);
      expect(tick).toBeLessThan(DEPTH_TICKS);
    }
  });

  it('keeps every object inside the opening, clear of the open curtain', () => {
    for (const object of testSceneObjects(30, SAMPLE_CUTOUTS)) {
      const sample = SAMPLE_CUTOUTS[object.sampleIndex];
      if (sample === undefined) throw new Error('No sample');
      const top = object.up * OPENING.height + sample.height * WORLD_UNITS_PER_PIXEL * object.scale;
      expect(object.across).toBeGreaterThanOrEqual(0.125);
      expect(object.across).toBeLessThanOrEqual(0.875);
      expect(object.up).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(OPENING.height);
    }
  });

  it('puts puppets on sticks and props on stands', () => {
    for (const object of testSceneObjects(30, SAMPLE_CUTOUTS)) {
      const kind = SAMPLE_CUTOUTS[object.sampleIndex]?.kind;
      expect(object.mount).toBe(kind === 'prop' ? 'stand' : 'stick');
    }
  });

  it('makes nothing when there are no samples', () => {
    expect(testSceneObjects(30, [])).toEqual([]);
  });
});
