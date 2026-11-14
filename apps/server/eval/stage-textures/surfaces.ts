/**
 * The stage's two tiling surface textures (F3.1), drawn pixel by pixel: wood planks for the
 * table and kraft cardboard for the outside of the theater. Both repeat with no seam, and
 * both are flat and bold rather than photographic, to sit beside the cutout art.
 */
import { fractalNoise, latticeValue, smoothstep } from './noise';

/** Raw RGB pixels, row by row. */
export interface Raster {
  data: Buffer;
  width: number;
  height: number;
}

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function put(data: Buffer, index: number, color: Rgb, gain: number): void {
  color.forEach((value, channel) => {
    data[index * 3 + channel] = Math.min(255, Math.max(0, Math.round(value * gain)));
  });
}

/** Distance between two positions on a line that wraps at `period`. */
function wrappedDistance(a: number, b: number, period: number): number {
  const distance = Math.abs(a - b) % period;
  return Math.min(distance, period - distance);
}

const PLANK_TONES = ['#b9834c', '#ad7641', '#c18c56', '#a56e3b', '#b47d47'].map(rgb);
const PLANKS = 8;

/**
 * Wood planks running left to right: each plank has its own tone, long grain streaks, a dark
 * seam along its edges and one end joint.
 */
export function drawWood(size = 1024): Raster {
  const data = Buffer.alloc(size * size * 3);
  const plankHeight = size / PLANKS;

  for (let y = 0; y < size; y += 1) {
    const plank = Math.floor(y / plankHeight);
    const tone = PLANK_TONES[Math.floor(latticeValue(plank, 11, 5) * PLANK_TONES.length)];
    if (tone === undefined) throw new Error('No plank tone');
    // Each plank is a different board: slide its grain along so neighbours don't line up.
    const slide = Math.floor(latticeValue(plank, 3, 9) * size);
    const joint = latticeValue(plank, 7, 13) * size;
    const edge = Math.min(y % plankHeight, plankHeight - (y % plankHeight));
    const seam = 1 - 0.42 * (1 - smoothstep(1, 3.5, edge));

    for (let x = 0; x < size; x += 1) {
      const grainX = ((x + slide) % size) / size;
      // Stretched 32 to 1 along the plank, so the noise reads as long grain lines.
      const grain = fractalNoise(grainX * 3, (y / size) * 96, 3, 96, 3, 21);
      const ring = (grain * 7) % 1;
      const streak = smoothstep(0, 0.03, ring) * (1 - smoothstep(0.1, 0.15, ring));
      const end = 1 - 0.38 * (1 - smoothstep(1, 3, wrappedDistance(x, joint, size)));
      const gain = (1 - 0.13 * streak + 0.1 * (grain - 0.5)) * seam * end;
      put(data, y * size + x, tone, gain);
    }
  }
  return { data, width: size, height: size };
}

const KRAFT = rgb('#c79a63');
/** Corrugation shows through as faint lines this many pixels apart. */
const FLUTE = 16;

/** Kraft cardboard: paper speckle, soft blotches, short fibers and faint corrugation lines. */
export function drawCardboard(size = 512): Raster {
  const data = Buffer.alloc(size * size * 3);

  for (let y = 0; y < size; y += 1) {
    const flute = 0.03 * Math.sin((2 * Math.PI * y) / FLUTE);
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const blotch = fractalNoise(u * 6, v * 6, 6, 6, 3, 31) - 0.5;
      // Fibers lie along the board: noise stretched 6 to 1.
      const fiber = fractalNoise(u * 16, v * 96, 16, 96, 2, 37) - 0.5;
      const speckle = latticeValue(x, y, 41) - 0.5;
      const fleck = latticeValue(x, y, 43) > 0.996 ? -0.14 : 0;
      const gain = 1 + 0.06 * blotch + 0.1 * fiber + 0.05 * speckle + flute + fleck;
      put(data, y * size + x, KRAFT, gain);
    }
  }
  return { data, width: size, height: size };
}
