import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  BACKDROP_SIZE,
  CUTOUT_MAX_SIDE,
  DEFAULT_PROCESSING,
  processImage,
  ProcessingError,
} from './process';

type Rgb = [number, number, number];

/** The model's magenta drifts off pure #FF00FF. */
const KEY: Rgb = [242, 3, 236];
const INK: Rgb = [10, 6, 4];
const ORANGE: Rgb = [235, 120, 20];
/** An outline pixel half-blended into the magenta, as anti-aliasing leaves it. */
const FRINGE: Rgb = [126, 4, 120];

/**
 * A 400×600 test cutout on the key color: an orange box with a 6 px ink outline at
 * x 100–299, y 100–499; a 120×120 window of key color inside it (like the gap between a
 * well's posts); a ring of fringe around the outside; and a 3×3 speck far from the box.
 */
function cutoutSource(): { data: Buffer; width: number; height: number } {
  const width = 400;
  const height = 600;
  const data = Buffer.alloc(width * height * 3);
  const set = (x: number, y: number, [r, g, b]: Rgb) => {
    const i = (y * width + x) * 3;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inBox = x >= 100 && x < 300 && y >= 100 && y < 500;
      const inFringe = x >= 99 && x < 301 && y >= 99 && y < 501;
      const inOutline = inBox && (x < 106 || x >= 294 || y < 106 || y >= 494);
      const inWindow = x >= 140 && x < 260 && y >= 200 && y < 320;
      const inWindowOutline = x >= 134 && x < 266 && y >= 194 && y < 326 && !inWindow;
      let color = KEY;
      if (inFringe && !inBox) color = FRINGE;
      if (inBox) color = inOutline || inWindowOutline ? INK : inWindow ? KEY : ORANGE;
      set(x, y, color);
    }
  }
  for (let y = 20; y < 23; y += 1) for (let x = 20; x < 23; x += 1) set(x, y, ORANGE);
  return { data, width, height };
}

async function png(source: { data: Buffer; width: number; height: number }, channels: 3 | 4 = 3) {
  return sharp(source.data, {
    raw: { width: source.width, height: source.height, channels },
  })
    .png()
    .toBuffer();
}

async function pixelsOf(image: Buffer) {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return {
      rgb: [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0] as Rgb,
      alpha: data[i + 3] ?? 0,
    };
  };
  return { data, info, at };
}

function near(actual: Rgb, hex: string, tolerance = 16): boolean {
  const value = Number.parseInt(hex.slice(1), 16);
  const expected = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  return actual.every((channel, i) => Math.abs(channel - (expected[i] ?? 0)) <= tolerance);
}

describe('processImage, cutouts', () => {
  it('cuts the subject out, trims it, borders it and sizes it to the stage', async () => {
    const out = await processImage(await png(cutoutSource()), 'prop');
    const { data, info, at } = await pixelsOf(out.data);
    const border = DEFAULT_PROCESSING.border.width;

    expect(out.mediaType).toBe('image/webp');
    expect([out.width, out.height]).toEqual([info.width, info.height]);
    // The 200×400 box (the speck was dropped, or the cutout would be taller and wider), scaled
    // so box + border on both sides is 1024 tall.
    expect(out.height).toBe(CUTOUT_MAX_SIDE);
    expect(out.width).toBe(Math.round(200 * ((CUTOUT_MAX_SIDE - 2 * border) / 400)) + 2 * border);

    // All or nothing: the stage sorts cutouts by depth without blending.
    let partial = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0 && data[i] !== 255) partial += 1;
    expect(partial).toBe(0);

    // The corners are cleared, and so is the window of key color inside the box.
    expect(at(0, 0).alpha).toBe(0);
    expect(at(out.width - 1, out.height - 1).alpha).toBe(0);
    const scale = (CUTOUT_MAX_SIDE - 2 * border) / 400;
    const windowCenter = { x: border + 100 * scale, y: border + 160 * scale };
    expect(at(Math.round(windowCenter.x), Math.round(windowCenter.y)).alpha).toBe(0);

    // No pixel left leaning toward magenta: the fringe went with the background.
    let tinted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (Math.min(r, b) - g >= DEFAULT_PROCESSING.fringeTint) tinted += 1;
    }
    expect(tinted).toBe(0);

    // The border at the bottom center (where the stage fixes the stand): the cut edge on the
    // outside, then card, then the subject's own outline.
    const middle = Math.round(out.width / 2);
    const bottom = out.height - 1;
    expect(near(at(middle, bottom).rgb, DEFAULT_PROCESSING.border.edgeColor)).toBe(true);
    expect(near(at(middle, bottom - border + 3).rgb, DEFAULT_PROCESSING.border.color)).toBe(true);
    expect(near(at(middle, bottom - border - 2).rgb, '#0A0604', 40)).toBe(true);
    expect(at(middle, bottom).alpha).toBe(255);
  });

  it('respects the transparency an upload already has', async () => {
    const width = 64;
    const height = 64;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const inside = x >= 16 && x < 48 && y >= 8 && y < 56;
        data[i] = ORANGE[0];
        data[i + 1] = ORANGE[1];
        data[i + 2] = ORANGE[2];
        data[i + 3] = inside ? 255 : 0;
      }
    }
    const out = await processImage(await png({ data, width, height }, 4), 'character');
    const { at } = await pixelsOf(out.data);

    // A 32×48 subject, scaled up to fill the stage size.
    expect(out.height).toBe(CUTOUT_MAX_SIDE);
    expect(at(0, 0).alpha).toBe(0);
    expect(near(at(Math.round(out.width / 2), Math.round(out.height / 2)).rgb, '#EB7814')).toBe(
      true,
    );
  });

  it('refuses an image that is nothing but the key color', async () => {
    const data = Buffer.alloc(32 * 32 * 3);
    for (let i = 0; i < data.length; i += 3) {
      data[i] = KEY[0];
      data[i + 1] = KEY[1];
      data[i + 2] = KEY[2];
    }
    await expect(
      processImage(await png({ data, width: 32, height: 32 }), 'monster'),
    ).rejects.toBeInstanceOf(ProcessingError);
  });
});

describe('processImage, backdrops', () => {
  async function solid(width: number, height: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: '#21B0E8' } })
      .png()
      .toBuffer();
  }

  it('keeps the model’s 16:9 backdrops at their size, colors untouched', async () => {
    const out = await processImage(await solid(1536, 864), 'backdrop');
    const { at } = await pixelsOf(out.data);
    expect([out.width, out.height]).toEqual([BACKDROP_SIZE.width, BACKDROP_SIZE.height]);
    expect(near(at(700, 400).rgb, '#21B0E8', 6)).toBe(true);
    expect(at(0, 0).alpha).toBe(255);
  });

  it('crops and sizes any other shape to the same 16:9 size', async () => {
    const out = await processImage(await solid(800, 600), 'backdrop');
    expect([out.width, out.height]).toEqual([BACKDROP_SIZE.width, BACKDROP_SIZE.height]);
  });
});
