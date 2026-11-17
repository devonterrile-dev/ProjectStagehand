import { useTexture } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { MathUtils, SRGBColorSpace, Texture, type Group } from 'three';

import { STAGE_COLORS } from './colors';
import { OPENING, WORLD_UNITS_PER_PIXEL, type Point3 } from './dimensions';

/** Pixels more see-through than this are not drawn: transparency is all or nothing (D-43). */
const ALPHA_TEST = 0.5;

/** The drop shadow: a dark copy of the cutout, a little behind, across and below it. */
const SHADOW = { opacity: 0.3, offset: [0.045, -0.035, -0.02] } as const;

/** A puppet's stick and a prop's post both run this far down from the cutout, into the void. */
const ROD_DROP = 1.4;
/**
 * How far up behind the cutout the rod reaches, as a share of the cutout's height, so the two
 * visibly join. A stick goes up to the middle: a puppet with a gap at its bottom center (a
 * spider's legs) would otherwise float above its stick. A prop sits on its base, so its post
 * only needs to reach it.
 */
const ROD_REACH = { stick: 0.5, stand: 0.08 } as const;
const STICK = { width: 0.04, depth: 0.02 } as const;
const POST = { width: 0.022, depth: 0.02 } as const;
const BASE = { height: 0.03, depth: 0.1, share: 0.55 } as const;
/** A hanging prop's string: thin, and tucked a little way down behind the top of the cutout. */
const STRING = { width: 0.008, tuck: 0.04 } as const;

/** A swaying puppet turns about a point this far down its stick: the puppeteer's hand. */
const SWAY = { pivotDrop: 1.2, angle: 0.035, speed: 1.3 } as const;

/**
 * How fast a gliding cutout closes on where it is going (`MathUtils.damp`): most of the way in
 * a third of a second, all of it in about half a second, like a hand moving the stick.
 */
export const GLIDE_SPEED = 7;

/** How see-through a faded cutout is drawn. */
const FADED_OPACITY = 0.4;
/** The frame around a selected cutout: this far outside it, and this thick. */
const SELECTION = { gap: 0.03, thickness: 0.012 } as const;

export interface CutoutProps {
  url: string;
  /** The image's size in pixels (`assets.processed_width` and `_height`). */
  width: number;
  height: number;
  /** Where the bottom center of the cutout goes. */
  position: Point3;
  scale?: number;
  flipped?: boolean;
  /**
   * A puppet is on a stick. A prop is on a stand, or hangs on a string from the roof. None of
   * them is part of the image (§11).
   */
  mount: 'stick' | 'stand' | 'hang';
  /** Scene builder only: drawn see-through, for a prop that is placed but hidden. */
  faded?: boolean;
  /** Scene builder only: framed, as the object being edited. */
  selected?: boolean;
  /** Called when the image is pressed. Without it the cutout ignores the pointer. */
  onPress?: (event: ThreeEvent<MouseEvent>) => void;
  /**
   * When a press counts: as the pointer goes down (picking, then dragging, in the builder and
   * the GM's theater), or on a whole click (a player inspecting, F3.5b, so the camera turning
   * away mid-press can't make the release look like a click on nothing).
   */
  pressOn?: 'down' | 'click';
  /**
   * Live play (F3.4): the cutout glides to a new position instead of jumping there, and
   * starts out at `enterFrom` when given (a puppet rising out of the void).
   */
  glide?: boolean;
  enterFrom?: Point3;
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

/** A bright frame around the cutout being edited, just in front of it. */
function SelectionFrame({ width, height }: { width: number; height: number }) {
  const w = width + 2 * SELECTION.gap;
  const h = height + 2 * SELECTION.gap;
  const t = SELECTION.thickness;
  const bars: [x: number, y: number, barWidth: number, barHeight: number][] = [
    [0, h / 2, w + t, t],
    [0, -h / 2, w + t, t],
    [-w / 2, 0, t, h + t],
    [w / 2, 0, t, h + t],
  ];
  return (
    <group position={[0, height / 2, 0.004]}>
      {bars.map(([x, y, barWidth, barHeight], index) => (
        <mesh key={index} position={[x, y, 0]}>
          <planeGeometry args={[barWidth, barHeight]} />
          <meshBasicMaterial color={STAGE_COLORS.selection} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A cardboard cutout in the theater (governance §12): a flat image anchored at its bottom
 * center, with a fake drop shadow (D-46) and the stick, stand or string that holds it. Unlit,
 * so it keeps its drawn colors. Suspends while the image loads.
 */
export function Cutout({
  url,
  width,
  height,
  position,
  scale = 1,
  flipped = false,
  mount,
  faded = false,
  selected = false,
  onPress,
  pressOn = 'down',
  glide = false,
  enterFrom,
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

  const [x, y, z] = position;
  const pivot = useRef<Group>(null);
  /** Where the pivot is headed: read each frame while gliding. */
  const target = useRef<Point3>([x, y - SWAY.pivotDrop, z]);
  // Before the frame loop and the placing effect below read it.
  useLayoutEffect(() => {
    target.current = [x, y - SWAY.pivotDrop, z];
  }, [x, y, z]);

  // When gliding starts the cutout is placed, and the frame loop moves it from then on. The
  // first time it is placed where it enters; after that (gliding again once the GM lets go of
  // a drag) it starts where it is headed.
  const enter = useRef(enterFrom);
  useLayoutEffect(() => {
    if (!glide || pivot.current === null) return;
    const entering = enter.current;
    const [startX, startY, startZ] = entering ?? target.current;
    pivot.current.position.set(
      startX,
      startY - (entering === undefined ? 0 : SWAY.pivotDrop),
      startZ,
    );
  }, [glide]);

  useFrame((state, delta) => {
    const group = pivot.current;
    if (group === null) return;
    group.rotation.z = sway
      ? Math.sin(state.clock.elapsedTime * SWAY.speed + phase) * SWAY.angle
      : 0;
    if (!glide) return;
    // On its way: placed where it is headed if gliding starts again (cleared here, not in the
    // effect, so React running effects twice in development can't skip the entrance).
    enter.current = undefined;
    const [toX, toY, toZ] = target.current;
    group.position.set(
      MathUtils.damp(group.position.x, toX, GLIDE_SPEED, delta),
      MathUtils.damp(group.position.y, toY, GLIDE_SPEED, delta),
      MathUtils.damp(group.position.z, toZ, GLIDE_SPEED, delta),
    );
  });

  const w = width * WORLD_UNITS_PER_PIXEL * scale;
  const h = height * WORLD_UNITS_PER_PIXEL * scale;
  const mirror = flipped ? -1 : 1;

  /** A stick or a post, from behind the cutout down into the void. */
  const rod = mount === 'hang' ? null : mount === 'stick' ? STICK : POST;
  const rodTop = mount === 'hang' ? 0 : h * ROD_REACH[mount];
  const rodLength = rodTop + ROD_DROP;
  /** A string, from behind the top of the cutout up to the roof. */
  const stringBottom = h - STRING.tuck;
  const stringLength = OPENING.height - y - stringBottom;

  return (
    <group ref={pivot} {...(glide ? {} : { position: [x, y - SWAY.pivotDrop, z] })}>
      {/* Everything below is placed from the cutout's bottom center. */}
      <group position={[0, SWAY.pivotDrop, 0]}>
        {!faded && (
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
        )}
        <mesh
          position={[0, h / 2, 0]}
          scale={[mirror, 1, 1]}
          {...(onPress === undefined
            ? {}
            : pressOn === 'down'
              ? { onPointerDown: onPress }
              : { onClick: onPress })}
        >
          <planeGeometry args={[w, h]} />
          {faded ? (
            <meshBasicMaterial
              key="faded"
              map={map}
              transparent
              opacity={FADED_OPACITY}
              // Below its own opacity, as for the shadow.
              alphaTest={FADED_OPACITY / 2}
              toneMapped={false}
            />
          ) : (
            <meshBasicMaterial key="solid" map={map} alphaTest={ALPHA_TEST} toneMapped={false} />
          )}
        </mesh>
        {selected && <SelectionFrame width={w} height={h} />}
        {rod !== null && (
          // The rod sits just behind the image, so it shows only below it.
          <mesh position={[0, rodTop - rodLength / 2, -rod.depth / 2 - 0.002]}>
            <boxGeometry args={[rod.width, rodLength, rod.depth]} />
            <meshLambertMaterial
              color={mount === 'stick' ? STAGE_COLORS.stick : STAGE_COLORS.stand}
            />
          </mesh>
        )}
        {mount === 'stand' && (
          <mesh position={[0, -BASE.height / 2, 0]}>
            <boxGeometry args={[w * BASE.share, BASE.height, BASE.depth]} />
            <meshLambertMaterial color={STAGE_COLORS.stand} />
          </mesh>
        )}
        {mount === 'hang' && stringLength > 0 && (
          <mesh position={[0, stringBottom + stringLength / 2, -STRING.width]}>
            <boxGeometry args={[STRING.width, stringLength, STRING.width]} />
            <meshLambertMaterial color={STAGE_COLORS.string} />
          </mesh>
        )}
      </group>
    </group>
  );
}
