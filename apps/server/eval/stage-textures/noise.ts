/**
 * Noise that repeats exactly, for textures that must tile with no visible seam (F3.1). Pure:
 * the same inputs always give the same value.
 */

/** A repeatable pseudo-random number in [0, 1) for a whole-number point. */
export function latticeValue(x: number, y: number, seed = 0): number {
  let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

const wrap = (value: number, period: number): number => ((value % period) + period) % period;
const fade = (t: number): number => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 0 below `edge0`, 1 above `edge1`, and a smooth ramp between. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return fade(t);
}

/**
 * Smooth noise in [0, 1) that repeats every `periodX` across and `periodY` down (whole
 * numbers of noise cells).
 */
export function tileNoise(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  seed = 0,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const left = wrap(x0, periodX);
  const right = wrap(x0 + 1, periodX);
  const top = wrap(y0, periodY);
  const bottom = wrap(y0 + 1, periodY);
  return mix(
    mix(latticeValue(left, top, seed), latticeValue(right, top, seed), tx),
    mix(latticeValue(left, bottom, seed), latticeValue(right, bottom, seed), tx),
    ty,
  );
}

/** Several layers of `tileNoise`, each twice as fine and half as strong. Still tiles. */
export function fractalNoise(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  octaves: number,
  seed = 0,
): number {
  let total = 0;
  let weight = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    total +=
      amplitude *
      tileNoise(
        x * frequency,
        y * frequency,
        periodX * frequency,
        periodY * frequency,
        seed + octave,
      );
    weight += amplitude;
    amplitude /= 2;
    frequency *= 2;
  }
  return total / weight;
}
