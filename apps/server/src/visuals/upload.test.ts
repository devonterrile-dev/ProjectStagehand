import { VISUAL_UPLOAD_MESSAGES } from '@stagehand/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { readUpload, UPLOAD_MAX_SIDE, UploadError } from './upload';

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } });
}

describe('readUpload (F2.6)', () => {
  it('re-encodes PNG, JPEG and WebP as PNG', async () => {
    for (const image of [
      await solid(30, 20).png().toBuffer(),
      await solid(30, 20).jpeg().toBuffer(),
      await solid(30, 20).webp().toBuffer(),
    ]) {
      const original = await readUpload(image);
      const meta = await sharp(original).metadata();
      expect(meta.format).toBe('png');
      expect([meta.width, meta.height]).toEqual([30, 20]);
    }
  });

  it('shrinks a large image to fit and drops its metadata', async () => {
    const image = await solid(3000, 1500)
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'someone' } } })
      .toBuffer();
    const original = await readUpload(image);
    const meta = await sharp(original).metadata();
    expect([meta.width, meta.height]).toEqual([UPLOAD_MAX_SIDE, UPLOAD_MAX_SIDE / 2]);
    expect(meta.exif).toBeUndefined();
  });

  it('turns an image upright from its EXIF orientation', async () => {
    const image = await solid(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const meta = await sharp(await readUpload(image)).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]);
  });

  it('refuses what is not a PNG, JPEG or WebP image', async () => {
    const gif = await solid(10, 10).gif().toBuffer();
    for (const bytes of [Buffer.from('not an image at all'), gif, Buffer.alloc(0)]) {
      await expect(readUpload(bytes)).rejects.toThrow(VISUAL_UPLOAD_MESSAGES.notImage);
    }
  });

  it('refuses a truncated image', async () => {
    const png = await solid(200, 200).png().toBuffer();
    await expect(readUpload(png.subarray(0, 120))).rejects.toBeInstanceOf(UploadError);
  });

  it('refuses an image over the pixel limit before decoding it', async () => {
    // 8000 × 8000 = 64 megapixels; a flat PNG of that size is small on disk.
    const huge = await sharp({
      create: { width: 8000, height: 8000, channels: 3, background: '#000000' },
      limitInputPixels: false,
    })
      .png()
      .toBuffer();
    await expect(readUpload(huge)).rejects.toThrow(VISUAL_UPLOAD_MESSAGES.tooManyPixels);
  });
});
