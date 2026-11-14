/**
 * The locked player camera (F3.1, governance §12 "Views and camera"). Pure numbers, no
 * Three.js: `StageCamera` applies them.
 *
 * A player never steers the camera. It rests on one of a few fixed views and moves smoothly
 * between them. F3.1 has the Stage view only; the Sheet and Inspect views arrive with F3.5.
 */
import { FRAME, OPENING, type Point3 } from './dimensions';

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

/** The views a player's camera can rest on. F3.5 adds `sheet` and `inspect`. */
export const STAGE_VIEWS = ['stage'] as const;
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

const VIEW_POSES: Record<StageView, (aspect: number) => CameraPose> = {
  stage: fitStageCamera,
};

/** Where the camera rests for a view, in a window of this shape. */
export function viewPose(view: StageView, aspect: number): CameraPose {
  return VIEW_POSES[view](aspect);
}
