import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, MathUtils, RepeatWrapping, SRGBColorSpace, type Group } from 'three';

import { STAGE_COLORS } from './colors';
import { CURTAIN_OPEN_SCALE, CURTAIN_PANEL_WIDTH, CURTAIN_SIDE_INSET } from './curtain-cover';
import { CURTAIN_Z, OPENING } from './dimensions';

/** Hung from above the opening and long enough to pass its bottom edge. */
const PANEL_HEIGHT = OPENING.height + 0.12;
const PANEL_Y = OPENING.height / 2;
/** How quickly the curtain moves; higher is faster. */
const CURTAIN_SPEED = 3.5;
const FOLDS = 9;
const VALANCE_HEIGHT = 0.16;

/** Soft vertical bands that read as folds of cloth; the material's color tints them. */
function makeFoldTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 4;
  const context = canvas.getContext('2d');
  if (context !== null) {
    const band = context.createLinearGradient(0, 0, canvas.width, 0);
    band.addColorStop(0, '#9a9a9a');
    band.addColorStop(0.5, '#ffffff');
    band.addColorStop(1, '#9a9a9a');
    context.fillStyle = band;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.repeat.set(FOLDS, 1);
  return texture;
}

/**
 * The front curtain (governance §12): two halves across the front of the theater that gather
 * to the sides when it opens. `open` is where it should be; it glides there.
 */
export function Curtain({ open }: { open: boolean }) {
  const folds = useMemo(() => makeFoldTexture(), []);
  useEffect(
    () => () => {
      folds.dispose();
    },
    [folds],
  );

  const left = useRef<Group>(null);
  const right = useRef<Group>(null);
  /** 0 is closed, 1 is open. Starts where it should be, so a page never opens mid-move. */
  const progress = useRef(open ? 1 : 0);

  useFrame((_state, delta) => {
    progress.current = MathUtils.damp(progress.current, open ? 1 : 0, CURTAIN_SPEED, delta);
    const share = MathUtils.lerp(1, CURTAIN_OPEN_SCALE, progress.current);
    left.current?.scale.setX(share);
    right.current?.scale.setX(share);
  });

  return (
    <group position={[0, 0, CURTAIN_Z]}>
      {/* Each half is fixed at its outer edge and scaled toward it. */}
      <group ref={left} position={[-(OPENING.width / 2 + CURTAIN_SIDE_INSET), PANEL_Y, 0]}>
        <mesh position={[CURTAIN_PANEL_WIDTH / 2, 0, 0]}>
          <planeGeometry args={[CURTAIN_PANEL_WIDTH, PANEL_HEIGHT]} />
          <meshLambertMaterial color={STAGE_COLORS.curtain} map={folds} />
        </mesh>
      </group>
      <group ref={right} position={[OPENING.width / 2 + CURTAIN_SIDE_INSET, PANEL_Y, 0]}>
        <mesh position={[-CURTAIN_PANEL_WIDTH / 2, 0, 0]}>
          <planeGeometry args={[CURTAIN_PANEL_WIDTH, PANEL_HEIGHT]} />
          <meshLambertMaterial color={STAGE_COLORS.curtain} map={folds} />
        </mesh>
      </group>
      {/* The valance: a short strip across the top that stays put. */}
      <mesh position={[0, OPENING.height - VALANCE_HEIGHT / 2, 0.01]}>
        <planeGeometry args={[OPENING.width, VALANCE_HEIGHT]} />
        <meshLambertMaterial color={STAGE_COLORS.valance} map={folds} />
      </mesh>
    </group>
  );
}
