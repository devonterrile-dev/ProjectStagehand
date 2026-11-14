import { describe, expect, it } from 'vitest';

import { DEPTH_TICKS, depthTickSchema, STAGE_MAX_OBJECTS } from './stage';

describe('stage constants', () => {
  it('match the governance budget: 10 depth ticks, 30 objects', () => {
    expect(DEPTH_TICKS).toBe(10);
    expect(STAGE_MAX_OBJECTS).toBe(30);
  });
});

describe('depthTickSchema', () => {
  it('accepts every tick from the front (0) to the back (9)', () => {
    for (let tick = 0; tick < DEPTH_TICKS; tick += 1) {
      expect(depthTickSchema.parse(tick)).toBe(tick);
    }
  });

  it('rejects ticks outside the theater and fractions', () => {
    for (const bad of [-1, DEPTH_TICKS, 2.5, '3', null]) {
      expect(depthTickSchema.safeParse(bad).success).toBe(false);
    }
  });
});
