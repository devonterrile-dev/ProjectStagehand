import { BackSide } from 'three';

import { STAGE_COLORS } from './colors';
import { FRAME, OPENING, THEATER_DEPTH, VOID_DEPTH, WALL_THICKNESS } from './dimensions';
import { STAGE_TEXTURES } from './textures';
import { TiledBox } from './TiledBox';
import { useTiledTexture } from './use-tiled-texture';

const { width: W, height: H } = OPENING;
const D = THEATER_DEPTH;
const T = WALL_THICKNESS;

/** The front posts run from the table up past the opening to the top of the beam. */
const POST_HEIGHT = FRAME.apron + H + FRAME.top;
const POST_Y = (H + FRAME.top - FRAME.apron) / 2;
const FRAME_Z = FRAME.thickness / 2;

/**
 * The puppet theater (governance §12, D-36): a back wall, two side walls and a roof, open at
 * the front and at the bottom. Its cardboard front (posts, beam and apron) frames the
 * opening, and below the scene is the void, black and open, where puppets wait.
 * Suspends while its texture loads.
 */
export function TheaterBox({ tint = STAGE_COLORS.walls }: { tint?: string }) {
  const cardboard = useTiledTexture(STAGE_TEXTURES.cardboard.url);
  const tile = STAGE_TEXTURES.cardboard.tile;

  return (
    <group>
      {/* Back wall: the backdrop hangs on its front face. */}
      <mesh position={[0, H / 2, -D - T / 2]}>
        <boxGeometry args={[W + 2 * T, H, T]} />
        <meshLambertMaterial color={tint} />
      </mesh>
      {/* Side walls. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (W / 2 + T / 2), H / 2, -D / 2]}>
          <boxGeometry args={[T, H, D]} />
          <meshLambertMaterial color={tint} />
        </mesh>
      ))}
      {/* Roof. */}
      <mesh position={[0, H + T / 2, -D / 2]}>
        <boxGeometry args={[W + 2 * T, T, D]} />
        <meshLambertMaterial color={tint} />
      </mesh>

      {/* The void: a black pit seen from inside, so only its far sides and floor are drawn. */}
      <mesh position={[0, -VOID_DEPTH / 2, -D / 2]}>
        <boxGeometry args={[W, VOID_DEPTH, D]} />
        <meshBasicMaterial color={STAGE_COLORS.void} side={BackSide} />
      </mesh>

      {/* The cardboard front: a post each side, the beam above, the apron below. */}
      {[-1, 1].map((side) => (
        <TiledBox
          key={side}
          size={[FRAME.side, POST_HEIGHT, FRAME.thickness]}
          position={[side * (W / 2 + FRAME.side / 2), POST_Y, FRAME_Z]}
          map={cardboard}
          tile={tile}
          color={STAGE_COLORS.frame}
        />
      ))}
      <TiledBox
        size={[W, FRAME.top, FRAME.thickness]}
        position={[0, H + FRAME.top / 2, FRAME_Z]}
        map={cardboard}
        tile={tile}
        color={STAGE_COLORS.frame}
      />
      <TiledBox
        size={[W, FRAME.apron, FRAME.thickness]}
        position={[0, -FRAME.apron / 2, FRAME_Z]}
        map={cardboard}
        tile={tile}
        color={STAGE_COLORS.apron}
      />
    </group>
  );
}
