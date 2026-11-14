import { describe, expect, it } from 'vitest';

import { fitStageCamera, STAGE_FOV, STAGE_FRAMING, STAGE_MARGIN, viewPose } from './camera';

/** Where a point on the theater's front plane lands in the window: -1 to 1 is inside it. */
function onScreen(aspect: number, x: number, y: number): { x: number; y: number } {
  const pose = fitStageCamera(aspect);
  const [, cameraY, distance] = pose.position;
  const halfHeight = distance * Math.tan((pose.fov * Math.PI) / 360);
  return { x: x / (halfHeight * aspect), y: (y - cameraY) / halfHeight };
}

const SHAPES = [
  ['16:9', 16 / 9],
  ['4:3', 4 / 3],
  ['21:9', 21 / 9],
  ['square', 1],
  ['a tall phone', 9 / 19.5],
] as const;

describe('fitStageCamera', () => {
  it.each(SHAPES)('shows the whole theater front in a %s window', (_name, aspect) => {
    for (const x of [STAGE_FRAMING.left, STAGE_FRAMING.right]) {
      for (const y of [STAGE_FRAMING.bottom, STAGE_FRAMING.top]) {
        const point = onScreen(aspect, x, y);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each(SHAPES)('fills a %s window as far as the margin allows', (_name, aspect) => {
    const corner = onScreen(aspect, STAGE_FRAMING.right, STAGE_FRAMING.top);
    const tightest = Math.max(Math.abs(corner.x), Math.abs(corner.y));
    expect(tightest).toBeCloseTo(1 / (1 + STAGE_MARGIN), 6);
  });

  it('looks at the theater front on, never from the side or above', () => {
    for (const [, aspect] of SHAPES) {
      const { position, target, fov } = fitStageCamera(aspect);
      expect(position[0]).toBe(0);
      expect(target[0]).toBe(0);
      expect(position[1]).toBe(target[1]);
      expect(position[2]).toBeGreaterThan(0);
      expect(target[2]).toBe(0);
      expect(fov).toBe(STAGE_FOV);
    }
  });

  it('backs away as the window gets narrower', () => {
    const wide = fitStageCamera(16 / 9).position[2];
    const narrow = fitStageCamera(9 / 16).position[2];
    expect(narrow).toBeGreaterThan(wide);
  });

  it('refuses a window with no shape', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => fitStageCamera(bad)).toThrow(RangeError);
    }
  });
});

describe('viewPose', () => {
  it('rests the Stage view on the fitted camera', () => {
    expect(viewPose('stage', 16 / 9)).toEqual(fitStageCamera(16 / 9));
  });
});
