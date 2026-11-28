import { useFrame } from '@react-three/fiber';
import { battleSquares, type BattleSize, type Stroke } from '@stagehand/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasTexture,
  SRGBColorSpace,
  type Group,
  type Mesh,
  type MeshLambertMaterial,
} from 'three';

import { STAGE_COLORS } from './colors';
import { drawStrokes, MAT_BORDER_PX, MAT_PX_PER_SQUARE, matTexturePx } from './paint';
import { BATTLE_MAT, matCenter, matSide } from './table-layout';

/** How long the mat takes to unroll, or to roll back up (F5.5). */
export const MAT_ROLL_SECONDS = 0.8;

/** The roll of cloth at the mat's leading edge: thickest rolled up, gone once laid flat. */
const ROLL = { radius: 0.03, least: 0.006 } as const;

/** The paint lies a hair above the cloth, so the two never flicker into each other. */
const PAINT_LIFT = 0.0006;

/** A blank canvas the size of a mat's texture, as a texture. */
function matCanvas(size: BattleSize): { canvas: HTMLCanvasElement; texture: CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = matTexturePx(size);
  canvas.height = matTexturePx(size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, texture };
}

/** The mat's cloth with its grid drawn on, for a mat of this size. */
function matTexture(size: BattleSize): CanvasTexture {
  const squares = battleSquares(size);
  const border = MAT_BORDER_PX;
  const grid = squares * MAT_PX_PER_SQUARE;
  const { canvas, texture } = matCanvas(size);
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
      const at = border + line * MAT_PX_PER_SQUARE;
      context.moveTo(at, border);
      context.lineTo(at, border + grid);
      context.moveTo(border, at);
      context.lineTo(border + grid, at);
    }
    context.stroke();
  }
  texture.needsUpdate = true;
  return texture;
}

/** Eases in and out, so the unrolling starts and ends gently. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The battle mat on the table (F5.5, governance §12 "Battle mode"): laid out from the theater's
 * side toward the players when a battle starts, and rolled back up when it ends. `size` is null
 * while there is no battle; the mat it last had is kept until it has rolled up. The GM's paint
 * (F5.6) lies on it and rolls up with it.
 */
export function BattleMat({
  size,
  strokes = NO_STROKES,
}: {
  size: BattleSize | null;
  strokes?: readonly Stroke[];
}) {
  const [drawn, setDrawn] = useState(size);
  if (size !== null && size !== drawn) setDrawn(size);
  if (drawn === null) return null;
  return (
    <MatCloth
      key={drawn}
      size={drawn}
      strokes={strokes}
      open={size !== null}
      onRolledUp={() => {
        setDrawn(null);
      }}
    />
  );
}

const NO_STROKES: readonly Stroke[] = [];

function MatCloth({
  size,
  strokes,
  open,
  onRolledUp,
}: {
  size: BattleSize;
  strokes: readonly Stroke[];
  open: boolean;
  onRolledUp: () => void;
}) {
  const texture = useMemo(() => matTexture(size), [size]);
  const paint = useMemo(() => matCanvas(size), [size]);
  useEffect(
    () => () => {
      texture.dispose();
      paint.texture.dispose();
    },
    [texture, paint],
  );

  const outer = matSide(size) + 2 * BATTLE_MAT.border;
  const [cx, top, cz] = matCenter(size);
  const back = cz - outer / 2;
  const y = top + BATTLE_MAT.lift;

  const cloth = useRef<Group>(null);
  const material = useRef<MeshLambertMaterial>(null);
  const paintMaterial = useRef<MeshLambertMaterial>(null);
  // The paint is drawn afresh whenever a stroke changes: a few thousand points at most.
  useEffect(() => {
    const context = paint.canvas.getContext('2d');
    const map = paintMaterial.current?.map;
    if (context === null || map == null) return;
    drawStrokes(context, strokes, paint.canvas.width);
    map.needsUpdate = true;
  }, [paint, strokes]);
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
    for (const map of [material.current?.map, paintMaterial.current?.map]) {
      if (map == null) continue;
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
        <mesh position={[0, PAINT_LIFT, outer / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[outer, outer]} />
          <meshLambertMaterial
            ref={paintMaterial}
            map={paint.texture}
            transparent
            depthWrite={false}
          />
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
