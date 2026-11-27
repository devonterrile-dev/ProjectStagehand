import { PASS_SPAN, TRAVEL_SPEED } from '@stagehand/shared';
import { useEffect, useMemo, useState } from 'react';

import { STAGE_COLORS } from './colors';
import { Cutout, type EmoteCue } from './Cutout';
import { FRAME, openingToWorld, TABLE } from './dimensions';
import { SAMPLE_CUTOUTS } from './samples';
import { testSceneObjects } from './test-scene';
import { STAGE_TEXTURES } from './textures';
import { TiledBox } from './TiledBox';
import { distanceAt, halfWidthOf, leavingY, type TravelRef } from './travel';
import { useTiledTexture } from './use-tiled-texture';

/**
 * The performance test scene (F3.1, governance §12 "Performance budget"): up to 30 sample
 * cutouts in the theater. Each uploads its own copy of its image, so the graphics card holds
 * as much as it would for 30 different props and puppets. The puppets can also be made to talk
 * and to play an emote, all at once, to judge puppet motion (F3.7), and walk while a transition
 * scene's travel plays (F5.4).
 */
export function TestScene({
  count,
  sway,
  talking = false,
  emote = null,
  walking = false,
}: {
  count: number;
  sway: boolean;
  talking?: boolean;
  emote?: EmoteCue | null;
  walking?: boolean;
}) {
  const objects = useMemo(() => testSceneObjects(count, SAMPLE_CUTOUTS), [count]);

  return (
    <>
      {objects.map((object) => {
        const sample = SAMPLE_CUTOUTS[object.sampleIndex];
        if (sample === undefined) return null;
        return (
          <Cutout
            key={object.id}
            url={sample.url}
            width={sample.width}
            height={sample.height}
            position={openingToWorld(object.across, object.up, object.tick)}
            scale={object.scale}
            flipped={object.flipped}
            mount={object.mount}
            sway={sway && object.mount === 'stick'}
            walking={walking && object.mount === 'stick'}
            phase={object.phase}
            {...(object.mount === 'stick' ? { talking, emote } : {})}
            ownTexture
          />
        );
      })}
    </>
  );
}

/** How long the test passer takes, from coming in to coming in again: its pass and a pause. */
const PASS_EVERY_MS = (PASS_SPAN / TRAVEL_SPEED) * 1000 + 1000;

/**
 * A prop passing by while the stage test travels (F5.4): it comes in from behind the right
 * wall, slides left with the backdrop and sinks at the left edge, then comes round again.
 */
export function TestPasser({ travel }: { travel: TravelRef }) {
  const sample = SAMPLE_CUTOUTS.find((cutout) => cutout.kind === 'prop') ?? SAMPLE_CUTOUTS[0];
  const [from, setFrom] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const anchor = travel.current;
      if (anchor !== null) setFrom(distanceAt(anchor, performance.now()));
    }, PASS_EVERY_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [travel]);
  if (sample === undefined) return null;
  const shape = { width: sample.width, height: sample.height, scale: 1, mount: 'stand' as const };
  return (
    <Cutout
      key={from}
      url={sample.url}
      width={sample.width}
      height={sample.height}
      position={openingToWorld(1.2, 0, 1)}
      mount="stand"
      glide
      pass={{ from, halfWidth: halfWidthOf(shape), leaveY: leavingY(shape), gone: false }}
    />
  );
}

/** The inspect stage's stand-in: a small theater on the table, to the right of the main one. */
const MINI = { x: 2.9, z: 0.9, width: 0.9, height: 0.55, post: 0.07, depth: 0.3 } as const;
/** The sheet page's stand-in: a sheet of paper on the table in front of the player. */
const SHEET = { width: 0.62, height: 0.8, z: 2.6 } as const;

/**
 * Stand-ins for what else will sit on the table (F3.5): the inspect stage and the sheet page.
 * §12 counts them in the budget, so the test scene draws something of their size. The real
 * sheet is HTML on a plane, and what that costs is measured when it exists.
 */
export function TableStandIns() {
  const cardboard = useTiledTexture(STAGE_TEXTURES.cardboard.url);
  const tile = STAGE_TEXTURES.cardboard.tile;
  const floor = TABLE.topY;
  const frontZ = FRAME.thickness + MINI.z;

  return (
    <group>
      {[-1, 1].map((side) => (
        <TiledBox
          key={side}
          size={[MINI.post, MINI.height, MINI.depth]}
          position={[
            MINI.x + (side * (MINI.width - MINI.post)) / 2,
            floor + MINI.height / 2,
            frontZ,
          ]}
          map={cardboard}
          tile={tile}
        />
      ))}
      <TiledBox
        size={[MINI.width, MINI.post, MINI.depth]}
        position={[MINI.x, floor + MINI.height + MINI.post / 2, frontZ]}
        map={cardboard}
        tile={tile}
      />
      {/* Its curtain, closed. */}
      <mesh position={[MINI.x, floor + MINI.height / 2, frontZ + MINI.depth / 2 - 0.02]}>
        <planeGeometry args={[MINI.width - 2 * MINI.post, MINI.height]} />
        <meshLambertMaterial color={STAGE_COLORS.curtain} />
      </mesh>

      <mesh position={[0, floor + 0.003, SHEET.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[SHEET.width, SHEET.height]} />
        <meshLambertMaterial color={STAGE_COLORS.paper} />
      </mesh>
    </group>
  );
}
