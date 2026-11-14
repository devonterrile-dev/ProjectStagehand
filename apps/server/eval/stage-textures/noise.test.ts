import { describe, expect, it } from 'vitest';

import { fractalNoise, latticeValue, smoothstep, tileNoise } from './noise';

describe('latticeValue', () => {
  it('is repeatable and stays in [0, 1)', () => {
    for (let x = -5; x < 5; x += 1) {
      for (let y = -5; y < 5; y += 1) {
        const value = latticeValue(x, y, 3);
        expect(value).toBe(latticeValue(x, y, 3));
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it('changes with the seed', () => {
    expect(latticeValue(4, 7, 1)).not.toBe(latticeValue(4, 7, 2));
  });
});

describe('tileNoise and fractalNoise', () => {
  const points = [
    [0.3, 0.7],
    [2.25, 5.5],
    [6.9, 1.1],
  ] as const;

  it('repeat exactly at their period, so a texture tiles with no seam', () => {
    for (const [x, y] of points) {
      expect(tileNoise(x + 8, y, 8, 6, 1)).toBeCloseTo(tileNoise(x, y, 8, 6, 1), 10);
      expect(tileNoise(x, y + 6, 8, 6, 1)).toBeCloseTo(tileNoise(x, y, 8, 6, 1), 10);
      expect(fractalNoise(x + 8, y + 6, 8, 6, 4, 2)).toBeCloseTo(
        fractalNoise(x, y, 8, 6, 4, 2),
        10,
      );
    }
  });

  it('stay in [0, 1)', () => {
    for (let step = 0; step < 200; step += 1) {
      const value = fractalNoise(step * 0.37, step * 0.11, 8, 6, 4);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('smoothstep', () => {
  it('ramps from 0 to 1 between its edges', () => {
    expect(smoothstep(2, 4, 1)).toBe(0);
    expect(smoothstep(2, 4, 3)).toBeCloseTo(0.5, 10);
    expect(smoothstep(2, 4, 5)).toBe(1);
  });
});
