import { OrbitControls } from '@react-three/drei';
import type { ComponentRef, Ref } from 'react';

import { OPENING, THEATER_DEPTH, type Point3 } from './dimensions';

/** The orbit controls behind the editing camera; `enabled` is switched off while dragging. */
export type EditingControls = ComponentRef<typeof OrbitControls>;

/** The camera turns about the middle of the theater box. */
const TARGET: Point3 = [0, OPENING.height / 2, -THEATER_DEPTH / 2];

/**
 * How far the editing camera may go: always in front of the theater, from a little below eye
 * level to well above it, and never inside the box or off across the room.
 */
const LIMITS = {
  minDistance: 2.5,
  maxDistance: 12,
  /** Radians from straight above. */
  minPolar: 0.5,
  maxPolar: 1.75,
  /** Radians to either side of straight on. */
  azimuth: 1.25,
} as const;

/**
 * The scene builder's editing camera (governance §12 "Views and camera"): the GM can orbit the
 * theater box to see how the depth ticks layer, and zoom with the wheel. Players never get
 * this: their camera is `StageCamera`, locked.
 */
export function EditingCamera({ ref }: { ref?: Ref<EditingControls> }) {
  return (
    <OrbitControls
      {...(ref === undefined ? {} : { ref })}
      target={[...TARGET]}
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
      minDistance={LIMITS.minDistance}
      maxDistance={LIMITS.maxDistance}
      minPolarAngle={LIMITS.minPolar}
      maxPolarAngle={LIMITS.maxPolar}
      minAzimuthAngle={-LIMITS.azimuth}
      maxAzimuthAngle={LIMITS.azimuth}
    />
  );
}
