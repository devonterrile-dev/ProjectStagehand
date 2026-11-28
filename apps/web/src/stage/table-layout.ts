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
import { battleSquares, type BattleSize, type Square } from '@stagehand/shared';

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
 * The cards beside the sheet page (F4.7, §12): the loadout and vault piles to its left, the
 * subclass and ancestry cards to its right, at the page's own scale so their text matches it. A
 * pile is drawn on a paper tray with its name across the top; a card is the card alone.
 */
export const SHEET_CARDS = (() => {
  const units = SHEET.width / SHEET.widthPx;
  const pile = { widthPx: 312, heightPx: 444 };
  const card = { widthPx: 280, heightPx: 380 };
  /** Between the page and a column, and between the two in a column. */
  const gap = 0.04;
  const [cx, cy, cz] = SHEET.center;
  const pileW = pile.widthPx * units;
  const pileD = pile.heightPx * units;
  const cardW = card.widthPx * units;
  const cardD = card.heightPx * units;
  const leftX = cx - SHEET.width / 2 - gap - pileW / 2;
  // The right column's outer edge matches the left's, so the spread is centered on the page.
  const rightX = cx + SHEET.width / 2 + gap + pileW - cardW / 2;
  return {
    units,
    pile: { ...pile, width: pileW, depth: pileD },
    card: { ...card, width: cardW, depth: cardD },
    loadout: [leftX, cy, cz - (pileD + gap) / 2] as Point3,
    vault: [leftX, cy, cz + (pileD + gap) / 2] as Point3,
    subclass: [rightX, cy, cz - (cardD + gap) / 2] as Point3,
    ancestry: [rightX, cy, cz + (cardD + gap) / 2] as Point3,
    /** Everything on this part of the table, page and cards: what the Sheet view frames. */
    spread: { width: 2 * (SHEET.width / 2 + gap + pileW), depth: 2 * pileD + gap },
  };
})();

/**
 * Where the two dice land (F3.6), on the strip of table in front of the theater that the Stage
 * view shows, between the middle and the Fear bowl. `size` is a die's radius; the dice are
 * tossed from `from`, relative to where they land: from the players' side, and above. `edge` is
 * where the white d6 of a roll with advantage or disadvantage lands (F5.1): in front of the two,
 * between them.
 */
export const DICE = {
  hope: [0.5, TOP, FRONT + 0.5] as Point3,
  fear: [0.82, TOP, FRONT + 0.44] as Point3,
  edge: [0.66, TOP, FRONT + 0.6] as Point3,
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

/**
 * The battle mat (F5.5, governance §12 "Battle mode"): a tan sheet with a square grid, laid in
 * the middle of the table, between the strip in front of the theater and the sheet page, which
 * slides back by `sheetShift` to make room. Every square is `square` across whatever the size,
 * so a larger mat covers more of the table. `border` is the plain edge round the grid. Every
 * size starts at the same far edge (`far`, the theater's side) and reaches toward the players,
 * so a smaller mat sits up near the dice rather than out in the middle of the table.
 *
 * The GM's tokens waiting beside the mat stand in rows of `besideColumns` to its left, from its
 * far edge toward the players, `beside` apart.
 */
export const BATTLE_MAT = {
  /** Across, the middle of the grid; and the grid's far edge, toward the theater. */
  x: 0,
  far: FRONT + 1.0,
  square: 0.08,
  border: 0.035,
  /** Raised a hair off the table, so the two never flicker into each other. */
  lift: 0.002,
  sheetShift: 0.5,
  beside: 0.1,
  besideColumns: 4,
  /** Between the mat's border and the nearest row of waiting tokens. */
  besideGap: 0.06,
} as const;

/** The grid's side, in world units, for a mat of this size. */
export function matSide(size: BattleSize): number {
  return battleSquares(size) * BATTLE_MAT.square;
}

/** The middle of the grid of a mat of this size, on the table. */
export function matCenter(size: BattleSize): Point3 {
  return [BATTLE_MAT.x, TOP, BATTLE_MAT.far + matSide(size) / 2];
}

/** Where a square's middle is on the table. */
export function squareCenter(size: BattleSize, square: Square): Point3 {
  const half = matSide(size) / 2;
  const [cx, , cz] = matCenter(size);
  return [
    cx - half + (square.column + 0.5) * BATTLE_MAT.square,
    TOP + BATTLE_MAT.lift,
    cz - half + (square.row + 0.5) * BATTLE_MAT.square,
  ];
}

/** The square under a point on the table, or null when it is off the grid. */
export function squareAt(size: BattleSize, x: number, z: number): Square | null {
  const half = matSide(size) / 2;
  const [cx, , cz] = matCenter(size);
  const column = Math.floor((x - (cx - half)) / BATTLE_MAT.square);
  const row = Math.floor((z - (cz - half)) / BATTLE_MAT.square);
  const squares = battleSquares(size);
  if (column < 0 || row < 0 || column >= squares || row >= squares) return null;
  return { column, row };
}

/** Where the GM's `index`th token waiting beside the mat stands: rows to the mat's left. */
export function besideSpot(size: BattleSize, index: number): Point3 {
  const half = matSide(size) / 2;
  const [cx, , cz] = matCenter(size);
  const column = index % BATTLE_MAT.besideColumns;
  const row = Math.floor(index / BATTLE_MAT.besideColumns);
  const right = cx - half - BATTLE_MAT.border - BATTLE_MAT.besideGap;
  return [
    right - (column + 0.5) * BATTLE_MAT.beside,
    TOP,
    cz - half + (row + 0.5) * BATTLE_MAT.beside,
  ];
}

/** How far left of the mat's middle the waiting rows reach, for the Battle view to take in. */
export function besideReach(size: BattleSize): number {
  return (
    matSide(size) / 2 +
    BATTLE_MAT.border +
    BATTLE_MAT.besideGap +
    BATTLE_MAT.besideColumns * BATTLE_MAT.beside
  );
}
