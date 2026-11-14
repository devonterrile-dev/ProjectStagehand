import { DEPTH_TICKS } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import {
  CURTAIN_Z,
  depthTickZ,
  OPENING,
  openingToWorld,
  THEATER_DEPTH,
  TICK_STEP,
  WORLD_UNITS_PER_PIXEL,
} from './dimensions';

describe('the theater opening', () => {
  it('is 16:9, like a backdrop', () => {
    expect(OPENING.width / OPENING.height).toBeCloseTo(16 / 9, 6);
  });

  it('sizes the tallest cutout to half the opening', () => {
    expect(1024 * WORLD_UNITS_PER_PIXEL).toBeCloseTo(OPENING.height / 2, 6);
  });
});

describe('depthTickZ', () => {
  const ticks = Array.from({ length: DEPTH_TICKS }, (_, tick) => depthTickZ(tick));

  it('runs from the front to the back in even steps', () => {
    for (let tick = 1; tick < DEPTH_TICKS; tick += 1) {
      const previous = ticks[tick - 1] ?? Number.NaN;
      const current = ticks[tick] ?? Number.NaN;
      expect(previous - current).toBeCloseTo(TICK_STEP, 6);
    }
  });

  it('keeps every tick behind the curtain and in front of the back wall', () => {
    for (const z of ticks) {
      expect(z).toBeLessThan(CURTAIN_Z);
      expect(z).toBeGreaterThan(-THEATER_DEPTH);
    }
  });

  it('refuses anything that is not a tick', () => {
    for (const bad of [-1, DEPTH_TICKS, 1.5, Number.NaN]) {
      expect(() => depthTickZ(bad)).toThrow(RangeError);
    }
  });
});

describe('openingToWorld', () => {
  it('maps the corners of the opening', () => {
    expect(openingToWorld(0, 0, 0)).toEqual([-OPENING.width / 2, 0, depthTickZ(0)]);
    expect(openingToWorld(1, 1, 9)).toEqual([OPENING.width / 2, OPENING.height, depthTickZ(9)]);
  });

  it('puts the middle on the center line', () => {
    const [x, y] = openingToWorld(0.5, 0.5, 4);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(OPENING.height / 2, 6);
  });

  it('lets a lowered puppet sit below the opening, in the void', () => {
    const [, y] = openingToWorld(0.5, -0.5, 4);
    expect(y).toBeLessThan(0);
  });
});
