import { useFrame } from '@react-three/fiber';
import { battleSquares, type BattleSize } from '@stagehand/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasTexture,
  SRGBColorSpace,
  type Group,
  type Mesh,
  type MeshLambertMaterial,
} from 'three';

import { STAGE_COLORS } from './colors';
import { BATTLE_MAT, matCenter, matSide } from './table-layout';

/** How long the mat takes to unroll, or to roll back up (F5.5). */
export const MAT_ROLL_SECONDS = 0.8;

/** The roll of cloth at the mat's leading edge: thickest rolled up, gone once laid flat. */
const ROLL = { radius: 0.03, least: 0.006 } as const;

/** Texture pixels to a square: enough for crisp lines from the Battle view. */
const PX_PER_SQUARE = 48;

/** The mat's cloth with its grid drawn on, for a mat of this size. */
function matTexture(size: BattleSize): CanvasTexture {
  const squares = battleSquares(size);
  const border = Math.round((BATTLE_MAT.border / BATTLE_MAT.square) * PX_PER_SQUARE);
  const grid = squares * PX_PER_SQUARE;
  const canvas = document.createElement('canvas');
  canvas.width = grid + 2 * border;
  canvas.height = grid + 2 * border;
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.fillStyle = STAGE_COLORS.matEdge;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = STAGE_COLORS.mat;
    context.fillRect(border, border, grid, grid);
    context.strokeStyle = STAGE_COLORS.matGrid;
    context.globalAlpha = 0.6;
    context.lineWidth = 2;
    context.beginPath();
    for (let line = 0; line <= squares; line += 1) {
      const at = border + line * PX_PER_SQUARE;
      context.moveTo(at, border);
      context.lineTo(at, border + grid);
      context.moveTo(border, at);
      context.lineTo(border + grid, at);
    }
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Eases in and out, so the unrolling starts and ends gently. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The battle mat on the table (F5.5, governance §12 "Battle mode"): laid out from the theater's
 * side toward the players when a battle starts, and rolled back up when it ends. `size` is null
 * while there is no battle; the mat it last had is kept until it has rolled up.
 */
export function BattleMat({ size }: { size: BattleSize | null }) {
  const [drawn, setDrawn] = useState(size);
  if (size !== null && size !== drawn) setDrawn(size);
  if (drawn === null) return null;
  return (
    <MatCloth
      key={drawn}
      size={drawn}
      open={size !== null}
      onRolledUp={() => {
        setDrawn(null);
      }}
    />
  );
}

function MatCloth({
  size,
  open,
  onRolledUp,
}: {
  size: BattleSize;
  open: boolean;
  onRolledUp: () => void;
}) {
  const texture = useMemo(() => matTexture(size), [size]);
  useEffect(
    () => () => {
      texture.dispose();
    },
    [texture],
  );

  const outer = matSide(size) + 2 * BATTLE_MAT.border;
  const [cx, top, cz] = matCenter(size);
  const back = cz - outer / 2;
  const y = top + BATTLE_MAT.lift;

  const cloth = useRef<Group>(null);
  const material = useRef<MeshLambertMaterial>(null);
  const roll = useRef<Mesh>(null);
  /** How far it is laid out, 0 (rolled up) to 1 (flat). */
  const laid = useRef(0);
  const rolledUp = useRef(onRolledUp);
  useEffect(() => {
    rolledUp.current = onRolledUp;
  });

  useFrame((_, delta) => {
    const step = delta / MAT_ROLL_SECONDS;
    const before = laid.current;
    laid.current = open ? Math.min(1, before + step) : Math.max(0, before - step);
    const eased = smooth(laid.current);
    if (cloth.current !== null) cloth.current.scale.z = Math.max(eased, 0.0001);
    // The cloth that shows is the part already unrolled: the far edge first.
    const map = material.current?.map;
    if (map != null) {
      map.repeat.y = Math.max(eased, 0.0001);
      map.offset.y = 1 - map.repeat.y;
    }
    if (roll.current !== null) {
      const radius = ROLL.least + ROLL.radius * (1 - eased);
      roll.current.visible = laid.current < 1;
      roll.current.position.set(cx, y + radius, back + outer * eased);
      roll.current.scale.set(radius, 1, radius);
    }
    if (!open && before > 0 && laid.current === 0) rolledUp.current();
  });

  return (
    <>
      <group ref={cloth} position={[cx, y, back]} scale={[1, 1, 0.0001]}>
        <mesh position={[0, 0, outer / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[outer, outer]} />
          <meshLambertMaterial ref={material} map={texture} />
        </mesh>
      </group>
      <mesh ref={roll} rotation={[0, 0, Math.PI / 2]}>
        {/* Radius 1, scaled each frame to the roll's thickness. */}
        <cylinderGeometry args={[1, 1, outer, 20]} />
        <meshLambertMaterial color={STAGE_COLORS.mat} />
      </mesh>
    </>
  );
}
