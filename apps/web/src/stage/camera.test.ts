import { describe, expect, it } from 'vitest';

import {
  BINDER_FRAMING,
  fitFraming,
  fitStageCamera,
  INSPECT_FRAMING,
  NOTE_FRAMING,
  STAGE_FOV,
  STAGE_FRAMING,
  STAGE_MARGIN,
  viewPose,
} from './camera';

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

/** Where a point lands in the window for a pose: -1 to 1 is inside it. */
function project(
  pose: ReturnType<typeof fitFraming>,
  aspect: number,
  point: readonly [number, number, number],
): { x: number; y: number } {
  const sub = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v - (b[i] ?? 0));
  const dot = (a: readonly number[], b: readonly number[]) =>
    a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
  const norm = (a: readonly number[]) => {
    const length = Math.hypot(...a);
    return a.map((v) => v / length);
  };
  const cross = (a: readonly number[], b: readonly number[]) => [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];
  const forward = norm(sub(pose.target, pose.position));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const offset = sub(point, pose.position);
  const depth = dot(offset, forward);
  const half = Math.tan((pose.fov * Math.PI) / 360);
  return { x: dot(offset, right) / (depth * half * aspect), y: dot(offset, up) / (depth * half) };
}

describe('the table views (F3.5b)', () => {
  const framings = [
    ['inspect', INSPECT_FRAMING],
    ['note', NOTE_FRAMING],
    ['binder', BINDER_FRAMING],
  ] as const;

  it.each(framings)('fits the whole %s framing in every window shape', (view, framing) => {
    for (const [, aspect] of SHAPES) {
      const pose = viewPose(view, aspect);
      expect(pose).toEqual(fitFraming(framing, aspect));
      // The framing's corners, on the plane through its target facing the camera.
      const forward = pose.target.map((v, i) => v - (pose.position[i] ?? 0));
      const length = Math.hypot(...forward);
      const [fx = 0, , fz = 0] = forward.map((v) => v / length);
      const right = [-fz / Math.hypot(fx, fz), 0, fx / Math.hypot(fx, fz)];
      for (const sx of [-1, 1]) {
        const corner = [
          pose.target[0] + (sx * framing.width * (right[0] ?? 0)) / 2,
          pose.target[1],
          pose.target[2] + (sx * framing.width * (right[2] ?? 0)) / 2,
        ] as const;
        const onScreen = project(pose, aspect, corner);
        expect(Math.abs(onScreen.x), `${view} at ${String(aspect)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('looks at the inspect stage from in front, and down at the pads and the binder', () => {
    const inspect = viewPose('inspect', 16 / 9);
    expect(inspect.position[2]).toBeGreaterThan(inspect.target[2]);
    expect(inspect.position[0]).toBeCloseTo(inspect.target[0], 6);
    for (const view of ['note', 'binder'] as const) {
      const pose = viewPose(view, 16 / 9);
      const drop = pose.position[1] - pose.target[1];
      const across = pose.position[2] - pose.target[2];
      expect(drop, view).toBeGreaterThan(across);
    }
  });

  it('refuses a window with no shape', () => {
    expect(() => fitFraming(NOTE_FRAMING, 0)).toThrow(RangeError);
  });
});
