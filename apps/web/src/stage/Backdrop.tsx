import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { use, useEffect, useMemo, useRef } from 'react';
import { MirroredRepeatWrapping, SRGBColorSpace, type MeshBasicMaterial } from 'three';

import { OPENING, THEATER_DEPTH } from './dimensions';
import { backdropOffset, distanceAt, TravelContext } from './travel';

/** Just in front of the back wall, so the two never flicker through each other. */
const BACKDROP_Z = -THEATER_DEPTH + 0.002;

/**
 * A Spot's backdrop, filling the theater's back wall and nothing else (governance §12). It is
 * unlit, so its colors stay exactly as they were drawn. Suspends while the image loads.
 *
 * In a transition scene (F5.4) it scrolls right to left while the scene plays: the texture wraps
 * mirrored, so every second copy is flipped and the edges always meet, and its offset follows
 * the travel clock (0 for a static scene, which draws the same picture). Its own copy of the
 * texture, so the offset never reaches anything else drawn from the same image.
 */
export function Backdrop({ url }: { url: string }) {
  const shared = useTexture(url, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = 4;
  });
  const travel = use(TravelContext);
  const texture = useMemo(() => {
    const looping = shared.clone();
    looping.wrapS = MirroredRepeatWrapping;
    looping.needsUpdate = true;
    return looping;
  }, [shared]);
  useEffect(
    () => () => {
      texture.dispose();
    },
    [texture],
  );

  const material = useRef<MeshBasicMaterial>(null);
  useFrame(() => {
    const map = material.current?.map;
    if (map == null) return;
    const anchor = travel.current;
    map.offset.x = anchor === null ? 0 : backdropOffset(distanceAt(anchor, performance.now()));
  });

  return (
    <mesh position={[0, OPENING.height / 2, BACKDROP_Z]}>
      <planeGeometry args={[OPENING.width, OPENING.height]} />
      <meshBasicMaterial ref={material} map={texture} toneMapped={false} />
    </mesh>
  );
}
