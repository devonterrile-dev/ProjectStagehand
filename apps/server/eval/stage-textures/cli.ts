/**
 * `pnpm stage:textures`: makes the stage's generated textures (F3.1) and writes them into the
 * web app, which ships them: `wood.webp` for the table, `cardboard.webp` for the outside of
 * the theater, and `room.webp`, the blurred room around the table. Free: nothing is called.
 *
 *   pnpm stage:textures             make the three textures
 *   pnpm stage:textures --preview   also write check images to the git-ignored
 *                                   eval/results/stage-textures/: each surface tiled 2 × 2
 *                                   (to look for seams), the room before blurring, and the
 *                                   part of the room the Stage view sees, enlarged
 *
 * Run it again after changing a drawing, and commit the result.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import sharp, { type Sharp } from 'sharp';

import { roomSvg } from './room';
import { drawCardboard, drawWood, type Raster } from './surfaces';

const OUT_DIR = fileURLToPath(new URL('../../../web/src/stage/textures/', import.meta.url));
const PREVIEW_DIR = fileURLToPath(new URL('../results/stage-textures/', import.meta.url));

/** The room picture's size. Only a small part is on screen at once, so it needs the pixels. */
const ROOM_SIZE = { width: 2048, height: 1024 } as const;
/** How out of focus the room is, in pixels of the picture. */
const ROOM_BLUR = 9;
/** The room is dimmed and muted, so the theater stays the brightest thing in view. */
const ROOM_BRIGHTNESS = 0.72;
const ROOM_SATURATION = 0.85;

const { values } = parseArgs({ options: { preview: { type: 'boolean', default: false } } });

const raw = (raster: Raster) =>
  sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 3 } });

async function write(name: string, image: Sharp, quality: number): Promise<Buffer> {
  const data = await image.webp({ quality }).toBuffer();
  writeFileSync(join(OUT_DIR, name), data);
  console.log(`  ${name}: ${String(Math.round(data.length / 1024))} KB`);
  return data;
}

/** The texture four times over, so a seam between copies would show. */
async function tiled(name: string, texture: Buffer, size: number): Promise<void> {
  const image = await sharp({
    create: { width: size * 2, height: size * 2, channels: 3, background: '#000000' },
  })
    .composite([{ input: texture, tile: true }])
    .png()
    .toBuffer();
  writeFileSync(join(PREVIEW_DIR, name), image);
}

mkdirSync(OUT_DIR, { recursive: true });
if (values.preview) mkdirSync(PREVIEW_DIR, { recursive: true });

const wood = drawWood();
const cardboard = drawCardboard();
const woodFile = await write('wood.webp', raw(wood), 86);
const cardboardFile = await write('cardboard.webp', raw(cardboard), 86);

const sharpRoom = await sharp(Buffer.from(roomSvg(ROOM_SIZE.width, ROOM_SIZE.height)))
  .resize(ROOM_SIZE.width, ROOM_SIZE.height)
  .png()
  .toBuffer();
const roomFile = await write(
  'room.webp',
  sharp(sharpRoom)
    .blur(ROOM_BLUR)
    .modulate({ brightness: ROOM_BRIGHTNESS, saturation: ROOM_SATURATION }),
  96,
);

if (values.preview) {
  await tiled('wood-tiled.png', woodFile, wood.width);
  await tiled('cardboard-tiled.png', cardboardFile, cardboard.width);
  writeFileSync(join(PREVIEW_DIR, 'room-sharp.png'), sharpRoom);
  // About what a 16:9 Stage view shows: 35° either side of the wall behind the theater.
  const view = {
    left: Math.round(ROOM_SIZE.width * (0.75 - 0.097)),
    top: Math.round(ROOM_SIZE.height * (0.5 - 0.11)),
    width: Math.round(ROOM_SIZE.width * 0.194),
    height: Math.round(ROOM_SIZE.height * 0.22),
  };
  const seen = await sharp(roomFile).extract(view).resize({ width: 1280 }).png().toBuffer();
  writeFileSync(join(PREVIEW_DIR, 'room-view.png'), seen);
  console.log(`Previews: ${PREVIEW_DIR}`);
}
console.log(`Wrote 3 textures to ${OUT_DIR}`);
