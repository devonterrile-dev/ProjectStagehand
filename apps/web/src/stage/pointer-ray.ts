import { Raycaster, Vector2, type Camera, type Ray } from 'three';

import { pointerNdc, type PointerRay } from './placement';

const raycaster = new Raycaster();
const ndc = new Vector2();

/** A Three.js ray as plain numbers, for `placement.ts`. */
export function toPointerRay(ray: Ray): PointerRay {
  return {
    origin: [ray.origin.x, ray.origin.y, ray.origin.z],
    direction: [ray.direction.x, ray.direction.y, ray.direction.z],
  };
}

/** The line from the camera through a point of the window, given where the canvas is. */
export function screenRay(
  camera: Camera,
  canvas: Element,
  clientX: number,
  clientY: number,
): PointerRay {
  const point = pointerNdc(clientX, clientY, canvas.getBoundingClientRect());
  ndc.set(point.x, point.y);
  raycaster.setFromCamera(ndc, camera);
  return toPointerRay(raycaster.ray);
}
