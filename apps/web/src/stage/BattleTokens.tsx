import { useTexture } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { Square } from '@stagehand/shared';
import { Suspense, useEffect, useRef, useState } from 'react';
import { DoubleSide, MathUtils, SRGBColorSpace, type Group } from 'three';

import type { BattleTokenView, BattleView } from '@/play/stage';

import { GLIDE_SPEED } from './Cutout';
import { TABLE, type Point3 } from './dimensions';
import { isDrag, rayAtHeight } from './placement';
import { screenRay } from './pointer-ray';
import { CutoutBoundary } from './SceneObjects';
import { BATTLE_MAT } from './table-layout';
import { CLIP_COLORS, dropTarget, sameSquare, TOKEN, tokenSpots } from './tokens';

/** Pixels more see-through than this are not drawn, as on the stage (D-43). */
const ALPHA_TEST = 0.5;

/**
 * The battle's tokens on the table (F5.5, governance §12 "Battle mode"). Each glides to its
 * square. With `onMoveToken` (the GM's table) they can be dragged: dropped on a free square a
 * token goes there, dropped off the mat it goes back beside it, and dropped on a taken square it
 * goes back where it was.
 */
export function BattleTokens({
  battle,
  onMoveToken,
}: {
  battle: BattleView | null;
  onMoveToken?: (id: string, square: Square | null) => void;
}) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const [drag, setDrag] = useState<{ id: string; x: number; z: number } | null>(null);

  // A drag outlives the render it started in, so it reads the battle and handler of the moment.
  const latest = useRef({ battle, onMoveToken });
  useEffect(() => {
    latest.current = { battle, onMoveToken };
  });
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      endDrag.current?.();
    },
    [],
  );

  if (battle === null) return null;
  const spots = tokenSpots(battle);
  const top = TABLE.topY + BATTLE_MAT.lift;

  function press(event: ThreeEvent<PointerEvent>, token: BattleTokenView) {
    if (latest.current.onMoveToken === undefined || event.button !== 0) return;
    event.stopPropagation();
    const from = { clientX: event.clientX, clientY: event.clientY };
    const view = canvas.ownerDocument.defaultView ?? window;
    let at: { x: number; z: number } | null = null;

    const move = (moved: PointerEvent) => {
      if (at === null && !isDrag(from, moved)) return;
      const point = rayAtHeight(screenRay(camera, canvas, moved.clientX, moved.clientY), top);
      if (point === null) return;
      at = point;
      setDrag({ id: token.id, ...point });
    };
    const end = () => {
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', end);
      view.removeEventListener('pointercancel', end);
      endDrag.current = null;
      setDrag(null);
      const now = latest.current;
      if (at === null || now.battle === null) return;
      const target = dropTarget(now.battle, token.id, at.x, at.z);
      const current = now.battle.tokens.find((candidate) => candidate.id === token.id);
      if (target === undefined || current === undefined || sameSquare(current.square, target)) {
        return;
      }
      now.onMoveToken?.(token.id, target);
    };

    endDrag.current?.();
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    endDrag.current = end;
  }

  return (
    <>
      {battle.tokens.map((token) => {
        const spot = spots.get(token.id);
        if (spot === undefined) return null;
        const dragged = drag?.id === token.id;
        const position: Point3 = dragged ? [drag.x, spot[1] + 0.02, drag.z] : spot;
        return (
          <CutoutBoundary key={`${token.id}:${token.url}`}>
            <Suspense fallback={null}>
              <Token
                token={token}
                position={position}
                snap={dragged}
                {...(onMoveToken === undefined
                  ? {}
                  : {
                      onPress: (event: ThreeEvent<PointerEvent>) => {
                        press(event, token);
                      },
                    })}
              />
            </Suspense>
          </CutoutBoundary>
        );
      })}
    </>
  );
}

/**
 * One token (F5.5): the puppet's picture standing in a plastic clip on a round base, both in
 * its side's color. The picture is drawn on both faces, so from behind it shows mirrored, not
 * blank like a puppet's back. It glides to where it goes, or follows the pointer exactly while
 * it is dragged (`snap`).
 */
function Token({
  token,
  position,
  snap,
  onPress,
}: {
  token: BattleTokenView;
  position: Point3;
  snap: boolean;
  onPress?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const texture = useTexture(token.url, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = 4;
  });

  const tall = TOKEN.height;
  const wide = (tall * token.width) / token.height;
  const fit = Math.min(1, TOKEN.maxWidth / wide);
  const width = wide * fit;
  const height = tall * fit;
  const color = CLIP_COLORS[token.side];

  const group = useRef<Group>(null);
  const placed = useRef(false);
  useFrame((_, delta) => {
    const current = group.current;
    if (current === null) return;
    const [x, y, z] = position;
    if (!placed.current || snap) {
      current.position.set(x, y, z);
      placed.current = true;
      return;
    }
    current.position.set(
      MathUtils.damp(current.position.x, x, GLIDE_SPEED, delta),
      MathUtils.damp(current.position.y, y, GLIDE_SPEED, delta),
      MathUtils.damp(current.position.z, z, GLIDE_SPEED, delta),
    );
  });

  const clipTop = TOKEN.base.height + TOKEN.clip.height;
  return (
    <group ref={group} {...(onPress === undefined ? {} : { onPointerDown: onPress })}>
      <mesh position={[0, TOKEN.base.height / 2, 0]}>
        <cylinderGeometry args={[TOKEN.base.radius, TOKEN.base.radius, TOKEN.base.height, 24]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <mesh position={[0, TOKEN.base.height + TOKEN.clip.height / 2, 0]}>
        <boxGeometry args={[TOKEN.clip.width, TOKEN.clip.height, TOKEN.clip.depth]} />
        <meshLambertMaterial color={color} />
      </mesh>
      {/* Seated a little way down in the clip. */}
      <mesh position={[0, clipTop - TOKEN.clip.height * 0.6 + height / 2, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          map={texture}
          alphaTest={ALPHA_TEST}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
