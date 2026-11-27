import { describe, expect, it } from 'vitest';

import {
  DEPTH_TICKS,
  depthTickSchema,
  PASS_SPAN,
  passEndsAt,
  passOver,
  STAGE_MAX_OBJECTS,
  TRAVEL_SPEED,
  travelDistance,
} from './stage';

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

describe('the travel clock (F5.4)', () => {
  it('goes one backdrop width every 12 seconds while playing, and holds while paused', () => {
    expect(TRAVEL_SPEED).toBeCloseTo(1 / 12);
    expect(travelDistance({ distance: 0.5, since: null }, 99_000)).toBe(0.5);
    expect(travelDistance({ distance: 0.5, since: 10_000 }, 22_000)).toBeCloseTo(1.5);
    // A clock read just before it started (another process's time) never goes back.
    expect(travelDistance({ distance: 0.5, since: 10_000 }, 9_000)).toBe(0.5);
  });

  it('ends a pass once it has gone one opening width', () => {
    expect(PASS_SPAN).toBe(1);
    expect(passOver(2, 2.99)).toBe(false);
    expect(passOver(2, 3)).toBe(true);
  });

  it('says when a pass ends while playing, at once when it is over, and never while paused', () => {
    const playing = { distance: 1, since: 0 };
    expect(passEndsAt(1, playing, 0)).toBeCloseTo(12_000);
    expect(passEndsAt(1, playing, 6_000)).toBeCloseTo(12_000);
    expect(passEndsAt(0, playing, 6_000)).toBe(6_000);
    expect(passEndsAt(1, { distance: 1, since: null }, 0)).toBeNull();
  });
});
