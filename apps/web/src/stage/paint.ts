/**
 * Painting the battle mat (F5.6, governance §12 "Battle mode"): the paint's colors, where on the
 * mat a point of the table is, and drawing strokes onto the mat's paint layer. Pure, but for the
 * 2D context it is handed.
 *
 * A stroke's points are in squares from the grid's far left corner, `[x0, y0, x1, y1, …]`, with
 * y running toward the players (`@stagehand/shared` `strokePointsSchema`).
 */
import {
  battleSquares,
  PAINT_SIZES,
  type BattleSize,
  type PaintColor,
  type Stroke,
} from '@stagehand/shared';

import { BATTLE_MAT, matCenter, matSide } from './table-layout';

/** How each paint color is drawn: marker colors that stand out on the tan cloth. */
export const PAINT_HEX: Record<PaintColor, string> = {
  red: '#d32f2f',
  orange: '#ef7d1a',
  yellow: '#f2c418',
  green: '#2e9d44',
  blue: '#2f6fd6',
  black: '#1d1a17',
};

/** Texture pixels to a square, for the mat's cloth and its paint alike. */
export const MAT_PX_PER_SQUARE = 48;

/** The width of the mat's plain border, in texture pixels. */
export const MAT_BORDER_PX = Math.round(
  (BATTLE_MAT.border / BATTLE_MAT.square) * MAT_PX_PER_SQUARE,
);

/** The mat's texture size in pixels, border included: the same across and down. */
export function matTexturePx(size: BattleSize): number {
  return battleSquares(size) * MAT_PX_PER_SQUARE + 2 * MAT_BORDER_PX;
}

/** Points closer together than this, in squares, add nothing to a stroke but weight. */
export const PAINT_SPACING = 0.04;

/**
 * Where on a mat of this size a point of the table is, in squares from the grid's far left
 * corner, kept to the grid's edges, in hundredths; null when it is off the mat's cloth.
 */
export function pointOnMat(size: BattleSize, x: number, z: number): [number, number] | null {
  const side = matSide(size);
  const [cx, , cz] = matCenter(size);
  const across = (x - (cx - side / 2)) / BATTLE_MAT.square;
  const down = (z - (cz - side / 2)) / BATTLE_MAT.square;
  const squares = battleSquares(size);
  const reach = BATTLE_MAT.border / BATTLE_MAT.square;
  if (across < -reach || down < -reach || across > squares + reach || down > squares + reach) {
    return null;
  }
  const keep = (value: number) => Math.round(Math.min(squares, Math.max(0, value)) * 100) / 100;
  return [keep(across), keep(down)];
}

/**
 * The points to add for the pointer at (x, y): the point itself, unless it is within
 * `PAINT_SPACING` of the stroke's last one (then nothing).
 */
export function nextPoint(last: readonly number[], x: number, y: number): number[] {
  const lastX = last.at(-2);
  const lastY = last.at(-1);
  if (lastX === undefined || lastY === undefined) return [x, y];
  return Math.hypot(x - lastX, y - lastY) < PAINT_SPACING ? [] : [x, y];
}

/** The part of a 2D canvas context that painting uses, so tests can hand in a stand-in. */
export type PaintContext = Pick<
  CanvasRenderingContext2D,
  | 'clearRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'arc'
  | 'fill'
  | 'save'
  | 'restore'
  | 'strokeStyle'
  | 'fillStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'globalCompositeOperation'
>;

/**
 * Draws the paint on a mat's paint layer, `sizePx` across, in drawing order: each stroke a line
 * of its brush's width with round ends and joins, a single point a dot. An erase takes paint
 * away where it passes, so the cloth and its grid show through again.
 */
export function drawStrokes(
  context: PaintContext,
  strokes: readonly Stroke[],
  sizePx: number,
): void {
  context.clearRect(0, 0, sizePx, sizePx);
  const at = (value: number) => MAT_BORDER_PX + value * MAT_PX_PER_SQUARE;
  for (const stroke of strokes) {
    const { points } = stroke;
    if (points.length < 2) continue;
    const width = PAINT_SIZES[stroke.size] * MAT_PX_PER_SQUARE;
    const ink = stroke.color === null ? '#000000' : PAINT_HEX[stroke.color];
    context.save();
    context.globalCompositeOperation = stroke.tool === 'erase' ? 'destination-out' : 'source-over';
    context.strokeStyle = ink;
    context.fillStyle = ink;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    if (points.length === 2) {
      context.arc(at(points[0] ?? 0), at(points[1] ?? 0), width / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(at(points[0] ?? 0), at(points[1] ?? 0));
      for (let index = 2; index + 1 < points.length; index += 2) {
        context.lineTo(at(points[index] ?? 0), at(points[index + 1] ?? 0));
      }
      context.stroke();
    }
    context.restore();
  }
}
