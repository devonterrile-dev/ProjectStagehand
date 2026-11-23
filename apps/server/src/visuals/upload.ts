/**
 * An image the GM uploads (F2.6, governance §11 step 7 and §14, D-70). The bytes are never
 * trusted: sharp reads them, and only a PNG, JPEG or WebP image of a sane size is accepted,
 * whatever the request said it was. What is stored as the upload's original is sharp's own
 * re-encoding as PNG: turned upright, shrunk to fit `UPLOAD_MAX_SIDE`, its first frame only,
 * and without the file's metadata (a phone photo's location, say). It is stored under a name
 * we generate, like a generated image.
 */
import { VISUAL_UPLOAD_MESSAGES } from '@stagehand/shared';
import sharp from 'sharp';

/** An original's longest side: twice a cutout's, more than any backdrop needs. */
export const UPLOAD_MAX_SIDE = 2048;

/** Larger images are refused before they are decoded (sharp checks the header). */
export const UPLOAD_MAX_PIXELS = 50_000_000;

const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp']);

/** The original's media type: always PNG. */
export const UPLOAD_MEDIA_TYPE = 'image/png';

/** An upload that isn't a usable image; `message` is for the GM. */
export class UploadError extends Error {
  override name = 'UploadError';
}

/** Checks an upload and makes the original to store. Throws `UploadError` for a bad file. */
export async function readUpload(bytes: Buffer): Promise<Buffer> {
  let format: string;
  try {
    ({ format } = await sharp(bytes, { limitInputPixels: UPLOAD_MAX_PIXELS }).metadata());
  } catch (error) {
    throw new UploadError(
      error instanceof Error && /pixel limit/i.test(error.message)
        ? VISUAL_UPLOAD_MESSAGES.tooManyPixels
        : VISUAL_UPLOAD_MESSAGES.notImage,
    );
  }
  if (!ACCEPTED_FORMATS.has(format)) {
    throw new UploadError(VISUAL_UPLOAD_MESSAGES.notImage);
  }
  try {
    return await sharp(bytes, { limitInputPixels: UPLOAD_MAX_PIXELS })
      .rotate()
      .resize(UPLOAD_MAX_SIDE, UPLOAD_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch (error) {
    throw new UploadError(
      error instanceof Error && /pixel limit/i.test(error.message)
        ? VISUAL_UPLOAD_MESSAGES.tooManyPixels
        : VISUAL_UPLOAD_MESSAGES.notImage,
    );
  }
}
