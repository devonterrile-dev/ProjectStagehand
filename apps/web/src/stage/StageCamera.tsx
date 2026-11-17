import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

import { viewPose, type StageView } from './camera';

/** How quickly the camera settles on its view; higher is snappier. */
const CAMERA_DAMPING = 6;

/** How close (world units) the camera comes to its view before it snaps on and holds still. */
export const SETTLED_WITHIN = 0.015;

/** Reused each frame, so checking for arrival makes no garbage. */
const scratch = new Vector3();

/**
 * The locked camera (governance §12): it rests on a view and glides to it when the view or
 * the window's shape changes. There are no orbit, zoom or pan controls, on purpose.
 * `onSettle` is told once each time it arrives at a new view (F3.5b): the table's papers wait
 * for that, since HTML laid on the table flickers while the camera moves past it.
 */
export function StageCamera({
  view = 'stage',
  onSettle,
}: {
  view?: StageView;
  onSettle?: (view: StageView) => void;
}) {
  const size = useThree((state) => state.size);
  const lookingAt = useRef<Vector3 | null>(null);
  /** The view last reported as arrived at; cleared when the view changes. */
  const arrived = useRef<StageView | null>(null);
  useEffect(() => {
    arrived.current = null;
  }, [view]);

  useFrame((state, delta) => {
    // A canvas that has no size yet has no shape to fit.
    if (size.width <= 0 || size.height <= 0) return;
    const pose = viewPose(view, size.width / size.height);
    const [px, py, pz] = pose.position;
    const [tx, ty, tz] = pose.target;
    const { camera } = state;

    if (lookingAt.current === null) {
      // The first frame starts on the view rather than gliding in from nowhere.
      camera.position.set(px, py, pz);
      lookingAt.current = new Vector3(tx, ty, tz);
    } else {
      const { position } = camera;
      position.set(
        MathUtils.damp(position.x, px, CAMERA_DAMPING, delta),
        MathUtils.damp(position.y, py, CAMERA_DAMPING, delta),
        MathUtils.damp(position.z, pz, CAMERA_DAMPING, delta),
      );
      const target = lookingAt.current;
      target.set(
        MathUtils.damp(target.x, tx, CAMERA_DAMPING, delta),
        MathUtils.damp(target.y, ty, CAMERA_DAMPING, delta),
        MathUtils.damp(target.z, tz, CAMERA_DAMPING, delta),
      );
      // Damping only ever closes in, so without this the camera would keep creeping for
      // seconds. Close enough, it snaps onto the view and holds perfectly still: the HTML laid
      // on the table is redrawn by the browser on every tiny move, and flickers while it is.
      if (
        position.distanceTo(scratch.set(px, py, pz)) < SETTLED_WITHIN &&
        target.distanceTo(scratch.set(tx, ty, tz)) < SETTLED_WITHIN
      ) {
        position.set(px, py, pz);
        target.set(tx, ty, tz);
      }
    }
    camera.lookAt(lookingAt.current);

    if (camera instanceof PerspectiveCamera && camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }

    if (
      arrived.current !== view &&
      camera.position.equals(scratch.set(px, py, pz)) &&
      lookingAt.current.equals(scratch.set(tx, ty, tz))
    ) {
      arrived.current = view;
      onSettle?.(view);
    }
  });

  return null;
}
