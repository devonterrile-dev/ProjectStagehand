import { describe, expect, it } from 'vitest';

import { depthTickZ, OPENING } from './dimensions';
import {
  DRAG_START_PIXELS,
  dragPlace,
  isDrag,
  placeAt,
  pointerNdc,
  rayAtDepth,
  type PointerRay,
} from './placement';

/** A ray from a camera in front of the theater through a point on a depth plane. */
function rayThrough(
  x: number,
  y: number,
  z: number,
  camera: readonly [number, number, number] = [0, 0.8, 7],
): PointerRay {
  const [cx, cy, cz] = camera;
  const length = Math.hypot(x - cx, y - cy, z - cz);
  return {
    origin: [cx, cy, cz],
    direction: [(x - cx) / length, (y - cy) / length, (z - cz) / length],
  };
}

describe('pointerNdc', () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };

  it('runs -1 to 1 across and up, with up positive', () => {
    expect(pointerNdc(500, 250, rect)).toEqual({ x: 0, y: 0 });
    expect(pointerNdc(100, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(pointerNdc(900, 450, rect)).toEqual({ x: 1, y: -1 });
  });
});

describe('rayAtDepth', () => {
  it('finds where the pointer is on a depth plane', () => {
    const z = depthTickZ(5);
    const point = rayAtDepth(rayThrough(0.4, 1.1, z), z);
    expect(point?.x).toBeCloseTo(0.4);
    expect(point?.y).toBeCloseTo(1.1);
  });

  it('works from a camera off to one side, as the editing camera is', () => {
    const z = depthTickZ(2);
    const point = rayAtDepth(rayThrough(-1, 0.3, z, [4, 3, 5]), z);
    expect(point?.x).toBeCloseTo(-1);
    expect(point?.y).toBeCloseTo(0.3);
  });

  it('gives nothing for a ray along the plane, or a plane behind the camera', () => {
    expect(rayAtDepth({ origin: [0, 1, 5], direction: [1, 0, 0] }, -1)).toBeNull();
    expect(rayAtDepth({ origin: [0, 1, 5], direction: [0, 0, 1] }, -1)).toBeNull();
  });
});

describe('placeAt', () => {
  it('puts the middle of the bottom edge at across 0.5, up 0', () => {
    expect(placeAt(0, 0)).toEqual({ across: 0.5, up: 0 });
    expect(placeAt(OPENING.width / 2, OPENING.height)).toEqual({ across: 1, up: 1 });
    expect(placeAt(-OPENING.width / 4, OPENING.height / 2)).toEqual({ across: 0.25, up: 0.5 });
  });

  it('keeps a place inside the opening', () => {
    expect(placeAt(-10, -10)).toEqual({ across: 0, up: 0 });
    expect(placeAt(10, 10)).toEqual({ across: 1, up: 1 });
  });
});

describe('dragPlace', () => {
  const z = depthTickZ(4);

  it('moves the cutout with the pointer, keeping hold of where it was grabbed', () => {
    // Grabbed 0.2 right of and 0.5 above its bottom center.
    const grab = { dx: 0.2, dy: 0.5 };
    const place = dragPlace(rayThrough(0.2, 0.5, z), grab, z);
    expect(place?.across).toBeCloseTo(0.5);
    expect(place?.up).toBeCloseTo(0);

    const moved = dragPlace(rayThrough(1, 1.4, z), grab, z);
    expect(moved?.across).toBeCloseTo(0.5 + 0.8 / OPENING.width);
    expect(moved?.up).toBeCloseTo(0.9 / OPENING.height);
  });

  it('stops at the edges of the opening', () => {
    expect(dragPlace(rayThrough(9, 9, z), { dx: 0, dy: 0 }, z)).toEqual({ across: 1, up: 1 });
  });

  it('gives nothing when the pointer misses the plane', () => {
    expect(dragPlace({ origin: [0, 1, 5], direction: [0, 1, 0] }, { dx: 0, dy: 0 }, z)).toBeNull();
  });
});

describe('isDrag', () => {
  it('ignores the small slips of a click', () => {
    const from = { clientX: 100, clientY: 100 };
    expect(isDrag(from, { clientX: 102, clientY: 101 })).toBe(false);
    expect(isDrag(from, { clientX: 100 + DRAG_START_PIXELS + 1, clientY: 100 })).toBe(true);
  });
});
