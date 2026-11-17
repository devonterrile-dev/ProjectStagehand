import { Html } from '@react-three/drei';
import type { ReactNode } from 'react';

import type { StageCutout } from '@/lib/scenes';

import { WORLD_UNITS_PER_PIXEL } from './dimensions';
import { cutoutPosition } from './scene-layout';
import { TABLE_HTML_Z } from './table-layout';
import { Reveal } from './TablePieces';

/** The gap between a puppet and its card, in world units. */
const GAP = 0.05;
/** Past this far across the opening the card goes on the puppet's left, so it stays in view. */
const LEFT_FROM = 0.6;
/** Where the card sits against its point: beside the puppet, centered on it top to bottom. */
const ON_RIGHT = { transform: 'translate(0, -50%)' } as const;
const ON_LEFT = { transform: 'translate(-100%, -50%)' } as const;

/**
 * A card beside a puppet in the theater (F3.7): the player's emote card. Laid flat on the screen
 * rather than in the scene, so it reads at the same size however far back the puppet stands; a
 * click on it stays on it, so it doesn't count as a click on nothing.
 */
export function PuppetMenu({
  cutout,
  index,
  children,
}: {
  cutout: StageCutout;
  /** The cutout's place in the stage's list, as `cutoutPosition` takes it. */
  index: number;
  children: ReactNode;
}) {
  const [x, y, z] = cutoutPosition(cutout, index);
  const halfWidth = (cutout.width * WORLD_UNITS_PER_PIXEL * cutout.scale) / 2;
  const height = cutout.height * WORLD_UNITS_PER_PIXEL * cutout.scale;
  const left = cutout.across > LEFT_FROM;
  return (
    <Html
      position={[left ? x - halfWidth - GAP : x + halfWidth + GAP, y + height * 0.75, z]}
      zIndexRange={TABLE_HTML_Z}
      style={left ? ON_LEFT : ON_RIGHT}
    >
      <Reveal>{children}</Reveal>
    </Html>
  );
}
