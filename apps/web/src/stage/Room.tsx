import { useTexture } from '@react-three/drei';
import { BackSide, SRGBColorSpace } from 'three';

import { STAGE_TEXTURES } from './textures';

/** Far enough out to hold the table and the camera, even pulled back for a tall window. */
const ROOM_RADIUS = 30;
/** Centered on the theater, at about the camera's eye height. */
const ROOM_CENTER: [number, number, number] = [0, 1, 0];

/**
 * The room around the table (F3.1): a big sphere seen from inside, carrying a picture of a
 * plain room that is already blurred, so the room is there but out of focus. It is unlit and
 * costs one draw call. Suspends while the picture loads.
 *
 * The sphere is mirrored across x so the picture reads the right way round from inside, and
 * so column u of the picture looks toward (cos 2πu, sin 2πu): u = 0.75 is the wall behind
 * the theater. `apps/server/eval/stage-textures/room.ts` draws to the same rule.
 */
export function Room() {
  const picture = useTexture(STAGE_TEXTURES.room.url, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
  });

  return (
    <mesh position={ROOM_CENTER} scale={[-1, 1, 1]}>
      <sphereGeometry args={[ROOM_RADIUS, 48, 24]} />
      <meshBasicMaterial map={picture} side={BackSide} toneMapped={false} />
    </mesh>
  );
}
