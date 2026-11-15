import { useThree } from '@react-three/fiber';
import { useEffect, type RefObject } from 'react';

import { depthTickZ } from './dimensions';
import { dragPlace, type Place } from './placement';
import { screenRay } from './pointer-ray';

/**
 * Where a point of the window is in the theater's opening, on a depth tick; null when it
 * can't be told (the pointer's ray misses that depth).
 */
export type PlaceProbe = (clientX: number, clientY: number, depthTick: number) => Place | null;

/**
 * Lets the page around the canvas ask where a point of the window is in the theater: a record
 * dragged from the tray is dropped on the canvas as an ordinary web page drop, which knows only
 * window coordinates. Sits inside the canvas, where the camera is, and fills `probeRef` with the
 * answering function while it is mounted.
 */
export function PlacementProbe({ probeRef }: { probeRef: RefObject<PlaceProbe | null> }) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);

  useEffect(() => {
    probeRef.current = (clientX, clientY, depthTick) =>
      dragPlace(
        screenRay(camera, canvas, clientX, clientY),
        { dx: 0, dy: 0 },
        depthTickZ(depthTick),
      );
    return () => {
      probeRef.current = null;
    };
  }, [camera, canvas, probeRef]);

  return null;
}
