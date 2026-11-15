import { DEPTH_TICKS } from '@stagehand/shared';
import { DoubleSide } from 'three';

import { STAGE_COLORS } from './colors';
import { depthTickZ, OPENING } from './dimensions';

/** How wide a tick's line is drawn: the selected object's tick, and the others. */
const LINE = { active: 0.012, other: 0.005 } as const;
const OTHER_OPACITY = 0.3;
/** Just off the surfaces they mark, so they never flicker through them. */
const LIFT = 0.002;

const TICKS = Array.from({ length: DEPTH_TICKS }, (_unused, tick) => tick);

/**
 * The scene builder's depth guides (F3.2c): a line for each of the 10 depth ticks, across the
 * bottom of the opening and up both side walls, with the selected object's tick lit. They show
 * which tick an object stands on, and where "step forward" would take it.
 */
export function DepthGuides({ activeTick }: { activeTick: number }) {
  return (
    <group>
      {TICKS.map((tick) => {
        const active = tick === activeTick;
        const width = active ? LINE.active : LINE.other;
        const z = depthTickZ(tick);
        const material = (
          <meshBasicMaterial
            color={active ? STAGE_COLORS.selection : STAGE_COLORS.guide}
            transparent={!active}
            opacity={active ? 1 : OTHER_OPACITY}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        );
        return (
          <group key={tick}>
            {/* Across the bottom edge, lying flat. */}
            <mesh position={[0, LIFT, z]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[OPENING.width, width]} />
              {material}
            </mesh>
            {/* Up each side wall. */}
            {[-1, 1].map((side) => (
              <mesh
                key={side}
                position={[side * (OPENING.width / 2 - LIFT), OPENING.height / 2, z]}
                rotation={[0, Math.PI / 2, 0]}
              >
                <planeGeometry args={[width, OPENING.height]} />
                {material}
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}
