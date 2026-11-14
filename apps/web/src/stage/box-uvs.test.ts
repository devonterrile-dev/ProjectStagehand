import { describe, expect, it } from 'vitest';

import { boxFaceUvScales } from './box-uvs';

describe('boxFaceUvScales', () => {
  it('gives each face its world size in tiles', () => {
    // A box 4 wide, 2 high and 6 deep, with a texture that covers 2 units.
    expect(boxFaceUvScales(4, 2, 6, 2)).toEqual([
      [3, 1],
      [3, 1],
      [2, 3],
      [2, 3],
      [2, 1],
      [2, 1],
    ]);
  });

  it('keeps the grain the same size on a thin post and a wide beam', () => {
    const tile = 1;
    const [, , , , postFront] = boxFaceUvScales(0.22, 2.55, 0.1, tile);
    const [, , , , beamFront] = boxFaceUvScales(3.2, 0.3, 0.1, tile);
    // World units per tile, across and up, are the same for both.
    expect(0.22 / (postFront?.[0] ?? 0)).toBeCloseTo(3.2 / (beamFront?.[0] ?? 0), 10);
    expect(2.55 / (postFront?.[1] ?? 0)).toBeCloseTo(0.3 / (beamFront?.[1] ?? 0), 10);
  });

  it('refuses a tile with no size', () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(() => boxFaceUvScales(1, 1, 1, bad)).toThrow(RangeError);
    }
  });
});
