/**
 * Post-processing (F2.4, governance §11 step 4, D-43): turns the image the model sent into
 * the one the stage uses. The original is never changed; this makes a second file.
 *
 * Cutouts (character, monster, prop):
 * 1. Every pixel close to the key color becomes transparent: the background from the edges
 *    and any patch of it seen through a gap (between a well's posts, inside a handle). The
 *    palette and the prompt keep the key color out of subjects (D-38), so all of it goes.
 * 2. Outline pixels still tinted by the key color where they touch the cleared area go too.
 * 3. Specks too small to be part of the subject are dropped; the rest is trimmed and resized
 *    so the finished cutout, border included, is `CUTOUT_MAX_SIDE` on its longest side.
 * 4. Transparency is all or nothing, so the stage can sort overlapping cutouts cleanly; the
 *    stage draws shadows, none are baked in.
 * 5. A uniform cardboard border goes around the outside, with a darker cut edge.
 *
 * Backdrops are cropped to 16:9 if needed and sized to `BACKDROP_SIZE`. Colors are left as the
 * model drew them: mapping to the palette discolored too many images (the GM's call, D-43).
 * Everything is saved as WebP at quality 90, with the transparency stored exactly.
 *
 * The bottom center of a cutout is where the stage fixes its stick or stand.
 */
import { isCutoutKind, type AssetKind } from '@stagehand/shared';
import sharp from 'sharp';

/** Bumped whenever the output would change; older processed images are made again. */
export const PROCESSING_VERSION = 1;

/** A cutout's longest side, border included. */
export const CUTOUT_MAX_SIDE = 1024;

/** Every backdrop's size: what gpt-image-2 sends for 16:9 (D-43). */
export const BACKDROP_SIZE = { width: 1536, height: 864 } as const;

export const PROCESSED_MEDIA_TYPE = 'image/webp';

export interface ProcessingSettings {
  /** The style bible's key color, `#RRGGBB`. */
  keyColor: string;
  /** How far (RGB distance) a pixel may be from the image's own key color and still be cleared. */
  keyTolerance: number;
  /**
   * How strongly an outline pixel next to the cleared area must lean toward magenta
   * (`min(r, b) - g`) to be cleared as fringe.
   */
  fringeTint: number;
  /** Rings of fringe pixels checked inward from the cleared area. */
  fringeRings: number;
  /** Separate specks smaller than this (pixels, at the image's own size) are dropped. */
  speckMaxPixels: number;
  border: {
    /** Width in pixels at the finished size. */
    width: number;
    color: string;
    /** The outermost pixels of the border: the cut edge of the card. */
    edgeWidth: number;
    edgeColor: string;
  };
  /** WebP quality for the colors; transparency is always stored exactly. */
  webpQuality: number;
}

export const DEFAULT_PROCESSING: ProcessingSettings = {
  keyColor: '#FF00FF',
  keyTolerance: 90,
  fringeTint: 70,
  fringeRings: 2,
  speckMaxPixels: 48,
  border: { width: 12, color: '#F4E8CE', edgeWidth: 3, edgeColor: '#75461B' },
  webpQuality: 90,
};

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
  mediaType: typeof PROCESSED_MEDIA_TYPE;
}

/** The image can't be made into a cutout: nothing was left once the key color was cleared. */
export class ProcessingError extends Error {
  override name = 'ProcessingError';
}

type Rgb = readonly [number, number, number];

function rgbOf(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

// --- Masks ----------------------------------------------------------------------------------

/**
 * The image's own key color: the per-channel median of the edge pixels that are close to the
 * style bible's key color (the model's magenta drifts, e.g. 236,3,233). Falls back to the
 * key color itself when the edges hold too little of it.
 */
function sampleKey(rgb: Buffer, width: number, height: number, key: Rgb): Rgb {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  let total = 0;
  const visit = (x: number, y: number) => {
    total += 1;
    const i = (y * width + x) * 3;
    const r = rgb[i] ?? 0;
    const g = rgb[i + 1] ?? 0;
    const b = rgb[i + 2] ?? 0;
    if (Math.hypot(r - key[0], g - key[1], b - key[2]) > 120) return;
    reds.push(r);
    greens.push(g);
    blues.push(b);
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    visit(0, y);
    visit(width - 1, y);
  }
  if (reds.length < total / 4) return key;
  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1] ?? 0;
  return [median(reds), median(greens), median(blues)];
}

const NEIGHBOURS_8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/** 1 where the pixel stays (the subject), 0 where it is cleared. */
function cutoutMask(
  rgb: Buffer,
  alpha: Buffer | null,
  width: number,
  height: number,
  settings: ProcessingSettings,
): Uint8Array {
  const n = width * height;
  const keep = new Uint8Array(n);
  const key = sampleKey(rgb, width, height, rgbOf(settings.keyColor));
  const tolerance = settings.keyTolerance ** 2;
  for (let p = 0; p < n; p += 1) {
    if (alpha !== null && (alpha[p] ?? 0) < 128) continue;
    const i = p * 3;
    const dr = (rgb[i] ?? 0) - key[0];
    const dg = (rgb[i + 1] ?? 0) - key[1];
    const db = (rgb[i + 2] ?? 0) - key[2];
    if (dr * dr + dg * dg + db * db > tolerance) keep[p] = 1;
  }

  // Fringe: kept pixels touching a cleared one that still lean toward magenta.
  for (let ring = 0; ring < settings.fringeRings; ring += 1) {
    const clear: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        if (keep[p] !== 1) continue;
        const i = p * 3;
        const r = rgb[i] ?? 0;
        const g = rgb[i + 1] ?? 0;
        const b = rgb[i + 2] ?? 0;
        if (Math.min(r, b) - g < settings.fringeTint) continue;
        const touches = NEIGHBOURS_8.some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx < 0 || ny < 0 || nx >= width || ny >= height || keep[ny * width + nx] === 0;
        });
        if (touches) clear.push(p);
      }
    }
    if (clear.length === 0) break;
    for (const p of clear) keep[p] = 0;
  }

  dropSpecks(keep, width, height, settings.speckMaxPixels);
  return keep;
}

/** Clears 8-connected groups of kept pixels smaller than `maxPixels`. */
function dropSpecks(keep: Uint8Array, width: number, height: number, maxPixels: number): void {
  const seen = new Uint8Array(keep.length);
  const stack: number[] = [];
  const group: number[] = [];
  for (let start = 0; start < keep.length; start += 1) {
    if (keep[start] !== 1 || seen[start] === 1) continue;
    group.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop() ?? 0;
      group.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (const [dx, dy] of NEIGHBOURS_8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (keep[q] === 1 && seen[q] === 0) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (group.length < maxPixels) for (const p of group) keep[p] = 0;
  }
}

/** Squared distance from every pixel to the nearest kept one (Felzenszwalb & Huttenlocher). */
function squaredDistanceToKept(keep: Uint8Array, width: number, height: number): Float64Array {
  const INF = 1e20;
  const grid = new Float64Array(width * height);
  for (let p = 0; p < grid.length; p += 1) grid[p] = keep[p] === 1 ? 0 : INF;

  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  // The lower envelope of parabolas rooted at each sample (z[0] = -INF ends the inner loop).
  const intersect = (q: number, k: number) => {
    const vk = v[k] ?? 0;
    return ((f[q] ?? 0) + q * q - ((f[vk] ?? 0) + vk * vk)) / (2 * q - 2 * vk);
  };
  const pass = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q += 1) {
      let s = intersect(q, k);
      while (s <= (z[k] ?? -INF)) {
        k -= 1;
        s = intersect(q, k);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q += 1) {
      while ((z[k + 1] ?? INF) < q) k += 1;
      const vk = v[k] ?? 0;
      d[q] = (q - vk) * (q - vk) + (f[vk] ?? 0);
    }
  };

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) f[y] = grid[y * width + x] ?? INF;
    pass(height);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = d[y] ?? INF;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) f[x] = grid[y * width + x] ?? INF;
    pass(width);
    for (let x = 0; x < width; x += 1) grid[y * width + x] = d[x] ?? INF;
  }
  return grid;
}

// --- Pipelines ------------------------------------------------------------------------------

async function encode(
  data: Buffer,
  width: number,
  height: number,
  channels: 3 | 4,
  quality: number,
): Promise<ProcessedImage> {
  const out = await sharp(data, { raw: { width, height, channels } })
    // alphaQuality 100 stores the alpha losslessly, so it stays all or nothing.
    .webp({ quality, alphaQuality: 100, effort: 4 })
    .toBuffer();
  return { data: out, width, height, mediaType: PROCESSED_MEDIA_TYPE };
}

async function processCutout(input: Buffer, settings: ProcessingSettings): Promise<ProcessedImage> {
  const decoded = sharp(input).rotate();
  const { hasAlpha } = await decoded.metadata();
  const { data: rgba, info } = await decoded
    .clone()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const n = width * height;
  const rgb = Buffer.alloc(n * 3);
  const alpha = hasAlpha ? Buffer.alloc(n) : null;
  for (let p = 0; p < n; p += 1) {
    rgb[p * 3] = rgba[p * 4] ?? 0;
    rgb[p * 3 + 1] = rgba[p * 4 + 1] ?? 0;
    rgb[p * 3 + 2] = rgba[p * 4 + 2] ?? 0;
    if (alpha !== null) alpha[p] = rgba[p * 4 + 3] ?? 0;
  }

  const keep = cutoutMask(rgb, alpha, width, height, settings);

  // Trim to what is kept.
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (keep[y * width + x] !== 1) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) throw new ProcessingError('Nothing was left after removing the background');
  const trimmedWidth = right - left + 1;
  const trimmedHeight = bottom - top + 1;
  const trimmed = Buffer.alloc(trimmedWidth * trimmedHeight * 4);
  for (let y = 0; y < trimmedHeight; y += 1) {
    for (let x = 0; x < trimmedWidth; x += 1) {
      const p = (y + top) * width + (x + left);
      const o = (y * trimmedWidth + x) * 4;
      const i = p * 3;
      trimmed[o] = rgb[i] ?? 0;
      trimmed[o + 1] = rgb[i + 1] ?? 0;
      trimmed[o + 2] = rgb[i + 2] ?? 0;
      trimmed[o + 3] = keep[p] === 1 ? 255 : 0;
    }
  }

  // Resize so subject + border on both sides fills the longest side.
  const border = settings.border.width;
  const inner = CUTOUT_MAX_SIDE - 2 * border;
  const scale = inner / Math.max(trimmedWidth, trimmedHeight);
  const subjectWidth = Math.max(1, Math.round(trimmedWidth * scale));
  const subjectHeight = Math.max(1, Math.round(trimmedHeight * scale));
  const resized = await sharp(trimmed, {
    raw: { width: trimmedWidth, height: trimmedHeight, channels: 4 },
  })
    .resize(subjectWidth, subjectHeight, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  // Lay the subject on a canvas with room for the border, alpha all or nothing.
  const outWidth = subjectWidth + 2 * border;
  const outHeight = subjectHeight + 2 * border;
  const out = Buffer.alloc(outWidth * outHeight * 4);
  const subject = new Uint8Array(outWidth * outHeight);
  for (let y = 0; y < subjectHeight; y += 1) {
    for (let x = 0; x < subjectWidth; x += 1) {
      const s = (y * subjectWidth + x) * 4;
      if ((resized[s + 3] ?? 0) < 128) continue;
      const p = (y + border) * outWidth + (x + border);
      subject[p] = 1;
      out[p * 4] = resized[s] ?? 0;
      out[p * 4 + 1] = resized[s + 1] ?? 0;
      out[p * 4 + 2] = resized[s + 2] ?? 0;
      out[p * 4 + 3] = 255;
    }
  }

  // The border: every pixel within `border` of the subject, its outermost pixels the cut edge.
  const distances = squaredDistanceToKept(subject, outWidth, outHeight);
  const cardColor = rgbOf(settings.border.color);
  const edgeColor = rgbOf(settings.border.edgeColor);
  const edgeFrom = (border - settings.border.edgeWidth) ** 2;
  const reach = border * border;
  for (let p = 0; p < subject.length; p += 1) {
    if (subject[p] === 1) continue;
    const distance = distances[p] ?? Infinity;
    if (distance > reach) continue;
    const color = distance > edgeFrom ? edgeColor : cardColor;
    out[p * 4] = color[0];
    out[p * 4 + 1] = color[1];
    out[p * 4 + 2] = color[2];
    out[p * 4 + 3] = 255;
  }

  return encode(out, outWidth, outHeight, 4, settings.webpQuality);
}

async function processBackdrop(
  input: Buffer,
  settings: ProcessingSettings,
): Promise<ProcessedImage> {
  const { width, height } = BACKDROP_SIZE;
  const data = await sharp(input)
    .rotate()
    .removeAlpha()
    .resize(width, height, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  return encode(data, width, height, 3, settings.webpQuality);
}

/** Makes the stage's version of an image (§11 step 4). Throws `ProcessingError` when it can't. */
export async function processImage(
  input: Buffer,
  kind: AssetKind,
  settings: ProcessingSettings = DEFAULT_PROCESSING,
): Promise<ProcessedImage> {
  return isCutoutKind(kind) ? processCutout(input, settings) : processBackdrop(input, settings);
}
