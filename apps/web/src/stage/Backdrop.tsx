import { useTexture } from '@react-three/drei';
import { SRGBColorSpace } from 'three';

import { OPENING, THEATER_DEPTH } from './dimensions';

/** Just in front of the back wall, so the two never flicker through each other. */
const BACKDROP_Z = -THEATER_DEPTH + 0.002;

/**
 * A Spot's backdrop, filling the theater's back wall and nothing else (governance §12). It is
 * unlit, so its colors stay exactly as they were drawn. Suspends while the image loads.
 */
export function Backdrop({ url }: { url: string }) {
  const texture = useTexture(url, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = 4;
  });

  return (
    <mesh position={[0, OPENING.height / 2, BACKDROP_Z]}>
      <planeGeometry args={[OPENING.width, OPENING.height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}
