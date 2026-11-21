/**
 * The locked player camera (F3.1, governance §12 "Views and camera"). Pure numbers, no
 * Three.js: `StageCamera` applies them.
 *
 * A player never steers the camera. It rests on one of a few fixed views and moves smoothly
 * between them: the Stage view (F3.1), the Inspect, Note and Binder views at the table (F3.5b),
 * and the Sheet view (F3.6).
 */
import { FRAME, OPENING, type Point3 } from './dimensions';
import {
  BINDER,
  BINDER_PAD,
  INSPECT_CARD,
  INSPECT_PAD,
  INSPECT_STAGE,
  INSPECT_TITLE,
  SHEET,
  SHEET_CARDS,
} from './table-layout';

/** Vertical field of view, in degrees. Narrow, so the theater's perspective stays gentle. */
export const STAGE_FOV = 30;

/** Air around the theater's front, as a share of its size, so nothing touches the window edge. */
export const STAGE_MARGIN = 0.06;

/** How much of the table shows below the theater's apron in the Stage view. */
export const TABLE_STRIP = 0.3;

/**
 * What the Stage view must always show, on the theater's front plane: the opening, its frame
 * and a strip of the table.
 */
export const STAGE_FRAMING = {
  left: -(OPENING.width / 2 + FRAME.side),
  right: OPENING.width / 2 + FRAME.side,
  bottom: -(FRAME.apron + TABLE_STRIP),
  top: OPENING.height + FRAME.top,
} as const;

export interface CameraPose {
  position: Point3;
  /** The point the camera looks at. */
  target: Point3;
  /** Vertical field of view, in degrees. */
  fov: number;
}

/**
 * The views a player's camera can rest on: the theater; the inspect stage; the sticky pad in
 * front of it, looked down at; the binder with its pad, looked down at (F3.5b); and the
 * player's sheet page in front of them (F3.6).
 */
export const STAGE_VIEWS = ['stage', 'inspect', 'note', 'binder', 'sheet'] as const;
export type StageView = (typeof STAGE_VIEWS)[number];

/**
 * The Stage view for a window of this shape (width / height): the whole theater, front on.
 * The camera backs away until the framing fits both across and up, so a narrow window (a
 * phone, the Discord frame) shows a smaller theater rather than a cut-off one (§17).
 */
export function fitStageCamera(aspect: number): CameraPose {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError(`Not a window shape: ${String(aspect)}`);
  }
  const width = (STAGE_FRAMING.right - STAGE_FRAMING.left) * (1 + STAGE_MARGIN);
  const height = (STAGE_FRAMING.top - STAGE_FRAMING.bottom) * (1 + STAGE_MARGIN);
  const centerY = (STAGE_FRAMING.top + STAGE_FRAMING.bottom) / 2;

  const halfFov = Math.tan((STAGE_FOV * Math.PI) / 360);
  const distanceForHeight = height / 2 / halfFov;
  const distanceForWidth = width / 2 / (halfFov * aspect);
  const distance = Math.max(distanceForHeight, distanceForWidth);

  return { position: [0, centerY, distance], target: [0, centerY, 0], fov: STAGE_FOV };
}

/** Air around a table view's framing, as a share of its size. */
export const TABLE_MARGIN = 0.12;

/**
 * Something on the table to frame: the point to look at, the direction the camera looks from
 * (toward the camera; any length), and the size to fit across and up, as seen from there.
 */
export interface Framing {
  target: Point3;
  from: Point3;
  width: number;
  height: number;
}

/** The camera that fits `framing` in a window of this shape. */
export function fitFraming(framing: Framing, aspect: number): CameraPose {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError(`Not a window shape: ${String(aspect)}`);
  }
  const halfFov = Math.tan((STAGE_FOV * Math.PI) / 360);
  const width = framing.width * (1 + TABLE_MARGIN);
  const height = framing.height * (1 + TABLE_MARGIN);
  const distance = Math.max(height / 2 / halfFov, width / 2 / (halfFov * aspect));
  const [fx, fy, fz] = framing.from;
  const length = Math.hypot(fx, fy, fz);
  const [tx, ty, tz] = framing.target;
  return {
    position: [
      tx + (fx / length) * distance,
      ty + (fy / length) * distance,
      tz + (fz / length) * distance,
    ],
    target: framing.target,
    fov: STAGE_FOV,
  };
}

const TOP = INSPECT_STAGE.floorY;
const cardDepth = INSPECT_CARD.heightPx * INSPECT_CARD.unitsPerPx;

/** The inspect stage, from a little above: its sign above, its card in front. */
export const INSPECT_FRAMING: Framing = {
  target: [INSPECT_STAGE.x, (TOP + INSPECT_TITLE.center[1]) / 2 - 0.05, INSPECT_STAGE.z + 0.2],
  from: [0, 0.45, 1],
  width: Math.max(
    INSPECT_STAGE.opening.width + 2 * INSPECT_STAGE.post,
    INSPECT_CARD.widthPx * INSPECT_CARD.unitsPerPx,
  ),
  height: INSPECT_TITLE.center[1] + 0.12 - TOP + cardDepth * 0.5,
};

/** The sticky pad in front of the inspect stage, looked down at. */
export const NOTE_FRAMING: Framing = {
  target: INSPECT_PAD.center,
  from: [0, 1.6, 0.9],
  width: INSPECT_PAD.size * 1.3,
  height: INSPECT_PAD.size * 1.3,
};

/** The open binder and the pad beside it, looked down at. */
export const BINDER_FRAMING: Framing = {
  target: [
    (BINDER.center[0] - BINDER.page.width + BINDER_PAD.center[0] + BINDER_PAD.size / 2) / 2,
    BINDER.center[1] + BINDER.thickness,
    BINDER.center[2],
  ],
  from: [0, 2.2, 0.8],
  width: BINDER_PAD.center[0] + BINDER_PAD.size / 2 - (BINDER.center[0] - BINDER.page.width),
  height: BINDER.page.depth,
};

/** The player's sheet page and the cards beside it (F4.7), looked down at from their seat. */
export const SHEET_FRAMING: Framing = {
  target: SHEET.center,
  from: [0, 2.4, 0.9],
  width: SHEET_CARDS.spread.width,
  height: SHEET_CARDS.spread.depth,
};

const VIEW_POSES: Record<StageView, (aspect: number) => CameraPose> = {
  stage: fitStageCamera,
  inspect: (aspect) => fitFraming(INSPECT_FRAMING, aspect),
  note: (aspect) => fitFraming(NOTE_FRAMING, aspect),
  binder: (aspect) => fitFraming(BINDER_FRAMING, aspect),
  sheet: (aspect) => fitFraming(SHEET_FRAMING, aspect),
};

/** Where the camera rests for a view, in a window of this shape. */
export function viewPose(view: StageView, aspect: number): CameraPose {
  return VIEW_POSES[view](aspect);
}
