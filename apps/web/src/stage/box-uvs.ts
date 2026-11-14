/**
 * Texture scales for a box (F3.1). A box normally stretches one whole copy of its texture
 * over each face, so a thin post and a wide beam would show the same cardboard at different
 * grain sizes. These scales make one tile of the texture cover the same world size on every
 * face of every box.
 */

/** How many times the texture repeats across (u) and up (v) one face. */
export type FaceUvScale = readonly [u: number, v: number];

/**
 * The scales for a box's six faces, in Three.js `BoxGeometry` order: +x, -x, +y, -y, +z, -z.
 * `tile` is the world size one copy of the texture covers.
 */
export function boxFaceUvScales(
  width: number,
  height: number,
  depth: number,
  tile: number,
): readonly FaceUvScale[] {
  if (!(tile > 0)) throw new RangeError(`Not a tile size: ${String(tile)}`);
  // The side faces run along the depth, the top and bottom along the width and the depth,
  // and the front and back along the width.
  const side: FaceUvScale = [depth / tile, height / tile];
  const top: FaceUvScale = [width / tile, depth / tile];
  const front: FaceUvScale = [width / tile, height / tile];
  return [side, side, top, top, front, front];
}
