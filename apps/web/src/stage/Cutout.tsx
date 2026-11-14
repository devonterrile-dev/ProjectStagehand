import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { SRGBColorSpace, Texture, type Group } from 'three';

import { STAGE_COLORS } from './colors';
import { WORLD_UNITS_PER_PIXEL, type Point3 } from './dimensions';

/** Pixels more see-through than this are not drawn: transparency is all or nothing (D-43). */
const ALPHA_TEST = 0.5;

/** The drop shadow: a dark copy of the cutout, a little behind, across and below it. */
const SHADOW = { opacity: 0.3, offset: [0.045, -0.035, -0.02] } as const;

/** A puppet's stick and a prop's post both run down from the cutout into the void. */
const ROD_LENGTH = 1.5;
/** How far the rod reaches up behind the cutout, so the two visibly join. */
const ROD_OVERLAP = 0.12;
const STICK = { width: 0.04, depth: 0.02 } as const;
const POST = { width: 0.022, depth: 0.02 } as const;
const BASE = { height: 0.03, depth: 0.1, share: 0.55 } as const;

/** A swaying puppet turns about a point this far down its stick: the puppeteer's hand. */
const SWAY = { pivotDrop: 1.2, angle: 0.035, speed: 1.3 } as const;

export interface CutoutProps {
  url: string;
  /** The image's size in pixels (`assets.processed_width` and `_height`). */
  width: number;
  height: number;
  /** Where the bottom center of the cutout goes. */
  position: Point3;
  scale?: number;
  flipped?: boolean;
  /** A puppet is on a stick; a prop is on a stand. Neither is part of the image (§11). */
  mount: 'stick' | 'stand';
  /** Test only: a gentle sway on the stick. Real puppet motion is F3.7. */
  sway?: boolean;
  /** Where in the sway it starts, in radians. */
  phase?: number;
  /**
   * Test only: upload a separate copy of the image to the graphics card for this cutout, as
   * if every cutout on stage showed a different image.
   */
  ownTexture?: boolean;
}

/**
 * A cardboard cutout in the theater (governance §12): a flat image anchored at its bottom
 * center, with a fake drop shadow (D-46) and the stick or stand that holds it. Unlit, so it
 * keeps its drawn colors. Suspends while the image loads.
 */
export function Cutout({
  url,
  width,
  height,
  position,
  scale = 1,
  flipped = false,
  mount,
  sway = false,
  phase = 0,
  ownTexture = false,
}: CutoutProps) {
  const shared = useTexture(url, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = 4;
  });
  const map = useMemo(() => {
    if (!ownTexture) return shared;
    // A new texture around the same decoded image is uploaded separately.
    const own = new Texture(shared.image as HTMLImageElement);
    own.colorSpace = SRGBColorSpace;
    own.anisotropy = 4;
    own.needsUpdate = true;
    return own;
  }, [shared, ownTexture]);
  useEffect(
    () => () => {
      if (map !== shared) map.dispose();
    },
    [map, shared],
  );

  const pivot = useRef<Group>(null);
  useFrame((state) => {
    if (pivot.current === null) return;
    pivot.current.rotation.z = sway
      ? Math.sin(state.clock.elapsedTime * SWAY.speed + phase) * SWAY.angle
      : 0;
  });

  const w = width * WORLD_UNITS_PER_PIXEL * scale;
  const h = height * WORLD_UNITS_PER_PIXEL * scale;
  const [x, y, z] = position;
  const mirror = flipped ? -1 : 1;
  const rod = mount === 'stick' ? STICK : POST;

  return (
    <group ref={pivot} position={[x, y - SWAY.pivotDrop, z]}>
      {/* Everything below is placed from the cutout's bottom center. */}
      <group position={[0, SWAY.pivotDrop, 0]}>
        <mesh position={[SHADOW.offset[0], h / 2 + SHADOW.offset[1], SHADOW.offset[2]]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            map={map}
            color="#000000"
            transparent
            opacity={SHADOW.opacity}
            // Below the shadow's own opacity, or all of it would be cut away.
            alphaTest={SHADOW.opacity / 2}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, h / 2, 0]} scale={[mirror, 1, 1]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={map} alphaTest={ALPHA_TEST} toneMapped={false} />
        </mesh>
        {/* The rod sits just behind the image, so it shows only below it. */}
        <mesh position={[0, ROD_OVERLAP - ROD_LENGTH / 2, -rod.depth / 2 - 0.002]}>
          <boxGeometry args={[rod.width, ROD_LENGTH, rod.depth]} />
          <meshLambertMaterial
            color={mount === 'stick' ? STAGE_COLORS.stick : STAGE_COLORS.stand}
          />
        </mesh>
        {mount === 'stand' && (
          <mesh position={[0, -BASE.height / 2, 0]}>
            <boxGeometry args={[w * BASE.share, BASE.height, BASE.depth]} />
            <meshLambertMaterial color={STAGE_COLORS.stand} />
          </mesh>
        )}
      </group>
    </group>
  );
}
