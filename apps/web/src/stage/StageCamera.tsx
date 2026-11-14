import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

import { viewPose, type StageView } from './camera';

/** How quickly the camera settles on its view; higher is snappier. */
const CAMERA_DAMPING = 6;

/**
 * The locked camera (governance §12): it rests on a view and glides to it when the view or
 * the window's shape changes. There are no orbit, zoom or pan controls, on purpose.
 */
export function StageCamera({ view = 'stage' }: { view?: StageView }) {
  const size = useThree((state) => state.size);
  const lookingAt = useRef<Vector3 | null>(null);

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
    }
    camera.lookAt(lookingAt.current);

    if (camera instanceof PerspectiveCamera && camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
