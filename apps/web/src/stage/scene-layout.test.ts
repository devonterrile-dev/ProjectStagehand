import { STAGE_MAX_OBJECTS } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import { depthTickZ, OPENING, TICK_STEP } from './dimensions';
import { cutoutHeight, cutoutPosition, LIST_NUDGE, LOWERED_GAP } from './scene-layout';

const cutout = (overrides: Partial<Parameters<typeof cutoutPosition>[0]> = {}) => ({
  across: 0.5,
  up: 0,
  depthTick: 5,
  height: 1024,
  scale: 1,
  lowered: false,
  ...overrides,
});

describe('cutoutHeight', () => {
  it('stands a full-height image half as high as the opening, times its scale', () => {
    expect(cutoutHeight({ height: 1024, scale: 1 })).toBeCloseTo(OPENING.height / 2);
    expect(cutoutHeight({ height: 512, scale: 2 })).toBeCloseTo(OPENING.height / 2);
  });
});

describe('cutoutPosition', () => {
  it('puts the bottom center where the scene says, on its depth tick', () => {
    expect(cutoutPosition(cutout(), 0)).toEqual([0, 0, depthTickZ(5)]);
    const [x, y, z] = cutoutPosition(cutout({ across: 1, up: 0.5, depthTick: 0 }), 0);
    expect(x).toBeCloseTo(OPENING.width / 2);
    expect(y).toBeCloseTo(OPENING.height / 2);
    expect(z).toBe(depthTickZ(0));
  });

  it('brings later objects a little forward, without ever reaching the next tick', () => {
    const first = cutoutPosition(cutout(), 0)[2];
    const second = cutoutPosition(cutout(), 1)[2];
    expect(second).toBeGreaterThan(first);
    expect(second - first).toBeCloseTo(LIST_NUDGE);
    expect(STAGE_MAX_OBJECTS * LIST_NUDGE).toBeLessThan(TICK_STEP);
  });

  it('lowers a puppet until its top is well below the opening', () => {
    const lowered = cutout({ up: 0.4, lowered: true, scale: 1.5 });
    const [, y] = cutoutPosition(lowered, 0);
    expect(y + cutoutHeight(lowered)).toBeCloseTo(-LOWERED_GAP);
  });
});
