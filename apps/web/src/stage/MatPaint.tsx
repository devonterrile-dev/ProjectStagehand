import { useThree, type ThreeEvent } from '@react-three/fiber';
import type { BattleSize, PaintColor, PaintSize } from '@stagehand/shared';
import { useEffect, useRef } from 'react';

import type { StrokeBrush } from '@/play/room';

import { nextPoint, pointOnMat } from './paint';
import { rayAtHeight } from './placement';
import { screenRay } from './pointer-ray';
import { BATTLE_MAT, matCenter, matSide } from './table-layout';

/** What the GM's pointer does on the mat (F5.6): moves tokens, paints, or rubs paint out. */
export type MatTool = 'move' | 'paint' | 'erase';

/** The GM's brush (F5.6): the tool in hand, and the color and size it paints with. */
export interface MatBrush {
  tool: MatTool;
  color: PaintColor;
  size: PaintSize;
}

/**
 * The GM's hand on the mat while painting or rubbing out (F5.6): an unseen sheet over the mat's
 * cloth that takes the press. Dragging lays a stroke from where it was pressed, each new point
 * handed to `onPaint` as the pointer moves over the table; leaving the cloth adds nothing more
 * until it comes back. Each press is a new stroke.
 */
export function MatPaint({
  size,
  brush,
  onPaint,
}: {
  size: BattleSize;
  brush: MatBrush;
  onPaint: (stroke: StrokeBrush, points: number[]) => void;
}) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const latest = useRef({ brush, onPaint });
  useEffect(() => {
    latest.current = { brush, onPaint };
  });
  const endStroke = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      endStroke.current?.();
    },
    [],
  );

  const outer = matSide(size) + 2 * BATTLE_MAT.border;
  const [cx, top, cz] = matCenter(size);
  const y = top + BATTLE_MAT.lift;

  function press(event: ThreeEvent<PointerEvent>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const { brush: held } = latest.current;
    if (held.tool === 'move') return;
    const stroke: StrokeBrush = {
      id: crypto.randomUUID(),
      tool: held.tool,
      color: held.tool === 'paint' ? held.color : null,
      size: held.size,
    };
    let drawn: number[] = [];
    const add = (clientX: number, clientY: number) => {
      const point = rayAtHeight(screenRay(camera, canvas, clientX, clientY), y);
      if (point === null) return;
      const onMat = pointOnMat(size, point.x, point.z);
      if (onMat === null) return;
      const added = nextPoint(drawn, onMat[0], onMat[1]);
      if (added.length === 0) return;
      drawn = [...drawn, ...added];
      latest.current.onPaint(stroke, added);
    };
    const view = canvas.ownerDocument.defaultView ?? window;
    const move = (moved: PointerEvent) => {
      add(moved.clientX, moved.clientY);
    };
    const end = () => {
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', end);
      view.removeEventListener('pointercancel', end);
      endStroke.current = null;
    };

    endStroke.current?.();
    add(event.clientX, event.clientY);
    // On the window, so the stroke carries on when the pointer leaves the canvas for a moment.
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    endStroke.current = end;
  }

  return (
    <mesh position={[cx, y + 0.001, cz]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={press}>
      <planeGeometry args={[outer, outer]} />
      {/* Unseen, but there to be pressed. */}
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
