/**
 * Where the player's things sit on the table (F3.5b, governance §12), in world units. Pure
 * numbers: the camera's views and the pieces that draw them both read these, so they can never
 * disagree.
 *
 * The table's top is at `TABLE.topY`; it runs from the theater's front (`FRAME.thickness`) toward
 * the players along +z. In the Stage view only a strip of it shows just in front of the theater,
 * so the binder lies there, where it can be seen and picked up. The inspect stage is off to the
 * right, out of the Stage view: the camera turns to it.
 */
import { FRAME, TABLE, type Point3 } from './dimensions';

const TOP = TABLE.topY;
const FRONT = FRAME.thickness;

/** World units per CSS pixel of the HTML drawn on a piece (drei `Html transform`). */
export const HTML_DEFAULT_UNITS_PER_PX = 0.025;

/**
 * The small theater a player inspects a record in. `opening` is its inside, `x` its middle and
 * `z` its front; `post` and `beam` are its cardboard front.
 */
export const INSPECT_STAGE = {
  x: 2.45,
  z: FRONT + 0.85,
  opening: { width: 1.0, height: 0.64 },
  depth: 0.42,
  post: 0.07,
  beam: 0.08,
  /** The cutout fits inside this share of the opening. */
  fill: 0.8,
  floorY: TOP,
} as const;

/** The paper sign above the inspect stage: the record's name. */
export const INSPECT_TITLE = {
  center: [
    INSPECT_STAGE.x,
    TOP + INSPECT_STAGE.opening.height + INSPECT_STAGE.beam + 0.13,
    INSPECT_STAGE.z + 0.02,
  ] as Point3,
  /** CSS pixels across, and world units per pixel. */
  widthPx: 520,
  unitsPerPx: 0.0016,
} as const;

/** The paper card in front of the inspect stage, tipped up toward the player: what is seen. */
export const INSPECT_CARD = {
  center: [INSPECT_STAGE.x, TOP + 0.09, INSPECT_STAGE.z + 0.42] as Point3,
  /** Tipped back from upright, in radians: nearly flat on the table. */
  tilt: -Math.PI / 2 + 0.45,
  widthPx: 600,
  heightPx: 300,
  unitsPerPx: 0.0016,
} as const;

/** The sticky pad on the table in front of the inspect stage. */
export const INSPECT_PAD = {
  center: [INSPECT_STAGE.x + 0.15, TOP, INSPECT_STAGE.z + 1.05] as Point3,
  size: 0.4,
  thickness: 0.03,
  /** The note's HTML, square. */
  sizePx: 400,
} as const;

/** The three-ring binder, closed, on the strip of table in front of the theater. */
export const BINDER = {
  center: [-1.15, TOP, FRONT + 0.5] as Point3,
  /** One page's size on the table: across (x) and toward the player (z). */
  page: { width: 0.44, depth: 0.56 },
  thickness: 0.07,
  /** The page's HTML. */
  pageWidthPx: 440,
  pageHeightPx: 560,
} as const;

/** The sticky pad beside the binder, for a note written in the binder. */
export const BINDER_PAD = {
  center: [BINDER.center[0] + BINDER.page.width / 2 + 0.36, TOP, BINDER.center[2]] as Point3,
  size: INSPECT_PAD.size,
  thickness: INSPECT_PAD.thickness,
  sizePx: INSPECT_PAD.sizePx,
} as const;

/** World units per CSS pixel for HTML `sizePx` across that spans `size` world units. */
export function unitsPerPx(size: number, sizePx: number): number {
  return size / sizePx;
}

/** drei `Html`'s `scale` for HTML drawn at `units` world units per CSS pixel (`transform`). */
export function htmlScale(units: number): number {
  return units / HTML_DEFAULT_UNITS_PER_PX;
}

/**
 * The HTML on the table stacks below the page's own overlays (the Back button, the connection
 * notice, `z-20`); drei's default would cover them.
 */
export const TABLE_HTML_Z: [number, number] = [10, 0];

/**
 * The player's sheet page (F3.6), lying on the table in front of them: out of the Stage view,
 * looked down at in the Sheet view. Its HTML is `widthPx` × `heightPx`.
 */
export const SHEET = {
  center: [0, TOP, FRONT + 2.5] as Point3,
  width: 0.62,
  depth: 0.8,
  widthPx: 620,
  heightPx: 800,
} as const;

/**
 * Where the two dice land (F3.6), on the strip of table in front of the theater that the Stage
 * view shows, between the middle and the Fear bowl. `size` is a die's radius; the dice are
 * tossed from `from`, relative to where they land: from the players' side, and above.
 */
export const DICE = {
  hope: [0.5, TOP, FRONT + 0.5] as Point3,
  fear: [0.82, TOP, FRONT + 0.44] as Point3,
  size: 0.075,
  from: [-0.35, 0.55, 1.1] as Point3,
} as const;

/**
 * Where a free roll's die lands (F4.2), on the same strip, left of the Hope and Fear dice; a d%
 * roll's ones die lands at `second`. Tossed from the players' side, like the d12s.
 */
export const FREE_DICE = {
  landing: [0.08, TOP, FRONT + 0.5] as Point3,
  second: [0.26, TOP, FRONT + 0.47] as Point3,
  size: 0.07,
  from: [-0.3, 0.55, 1.1] as Point3,
} as const;

/** The GM's Fear (F3.6): a bowl of beads on the strip in front of the theater. */
export const FEAR_BOWL = {
  center: [1.42, TOP, FRONT + 0.5] as Point3,
  radius: 0.17,
  height: 0.08,
  bead: 0.032,
} as const;
