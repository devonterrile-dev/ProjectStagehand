import {
  battleSquares,
  type BattleSide,
  type BattleSize,
  type Square,
  type Stroke,
} from '@stagehand/shared';
import { memo, useEffect, useRef, useState } from 'react';

import type { BattleView } from '@/play/stage';

import { BattleMat } from './BattleMat';
import { BattleTokens } from './BattleTokens';
import type { EmoteCue } from './Cutout';
import { MatPaint } from './MatPaint';
import { PerfProbe, type PerfProbeProps } from './PerfProbe';
import { StageCanvas } from './StageCanvas';
import { SAMPLE_CUTOUTS } from './samples';
import { TableStandIns, TestPasser, TestScene } from './TestScene';
import type { TravelAnchor } from './travel';

export interface StageTestCanvasProps extends PerfProbeProps {
  backdropUrl: string | null;
  curtainOpen: boolean;
  /** How many sample cutouts are in the theater, up to 30. */
  objectCount: number;
  sway: boolean;
  /** Every puppet talking (F3.7). */
  talking: boolean;
  /** The emote every puppet plays (F3.7): a new id plays it again. */
  emote: EmoteCue | null;
  /**
   * A transition scene playing (F5.4): the backdrop scrolls, the puppets walk, and a test prop
   * passes by, over and over.
   */
  travel?: boolean;
  /**
   * A battle on the table (F5.5): the mat of this size with a token for each sample object,
   * dragged as the GM drags them, and the theater's cutouts put away as behind the curtain.
   */
  battle?: BattleSize | null;
  /** Painting on the test mat (F5.6): a drag paints, locally, instead of moving a token. */
  painting?: boolean;
  /** The most device pixels per CSS pixel to draw at. */
  maxPixelRatio: number;
}

/**
 * The stage test page's canvas (F3.1): the theater with the performance test scene and the
 * probe that measures it. Everything it takes is plain data, so the page around it never
 * touches Three.js. Memoized: the page re-renders twice a second with new live numbers, and
 * that must not re-render the scene it is measuring.
 */
export const StageTestCanvas = memo(function StageTestCanvas({
  backdropUrl,
  curtainOpen,
  objectCount,
  sway,
  talking,
  emote,
  travel = false,
  battle = null,
  painting = false,
  maxPixelRatio,
  measure,
  onLive,
  onMeasured,
}: StageTestCanvasProps) {
  // The test mat's paint (F5.6): a few sample strokes, and whatever is painted on it here.
  const [strokes, setStrokes] = useState<readonly Stroke[]>(SAMPLE_STROKES);

  // Playing from the start each time Travel is turned on (F5.4).
  const anchor = useRef<TravelAnchor | null>(null);
  useEffect(() => {
    anchor.current = travel ? { playing: true, distance: 0, at: performance.now() } : null;
  }, [travel]);

  return (
    <StageCanvas
      backdropUrl={backdropUrl}
      curtainOpen={curtainOpen && battle === null}
      maxPixelRatio={maxPixelRatio}
      travel={anchor}
      view={battle === null ? 'stage' : 'battle'}
      battle={battle}
    >
      {battle === null ? (
        <TestScene
          count={objectCount}
          sway={sway}
          talking={talking}
          emote={emote}
          walking={travel}
        />
      ) : (
        <TestBattle
          key={`${battle}:${String(objectCount)}`}
          size={battle}
          count={objectCount}
          painting={painting}
        />
      )}
      <BattleMat size={battle} strokes={strokes} />
      {battle !== null && painting && (
        <MatPaint
          size={battle}
          brush={{ tool: 'paint', color: 'blue', size: 'medium' }}
          onPaint={(stroke, points) => {
            setStrokes((current) => {
              const at = current.findIndex((candidate) => candidate.id === stroke.id);
              if (at === -1) return [...current, { ...stroke, points }];
              return current.map((candidate, index) =>
                index === at
                  ? { ...candidate, points: [...candidate.points, ...points] }
                  : candidate,
              );
            });
          }}
        />
      )}
      {travel && <TestPasser travel={anchor} />}
      <TableStandIns />
      <PerfProbe measure={measure} onLive={onLive} onMeasured={onMeasured} />
    </StageCanvas>
  );
});

/** The test mat's sample paint (F5.6): a wall, a river, a spot rubbed out of it, and an X. */
const SAMPLE_STROKES: readonly Stroke[] = [
  {
    id: '00000000-0000-4000-8000-0000000005f1',
    tool: 'paint',
    color: 'black',
    size: 'broad',
    points: [0.5, 0.5, 5.5, 0.5, 5.5, 2.5],
  },
  {
    id: '00000000-0000-4000-8000-0000000005f2',
    tool: 'paint',
    color: 'blue',
    size: 'medium',
    points: [0.2, 4, 1.5, 3.6, 3, 4.2, 4.5, 3.8, 5.8, 4.3],
  },
  {
    id: '00000000-0000-4000-8000-0000000005f3',
    tool: 'erase',
    color: null,
    size: 'broad',
    points: [3, 4.2],
  },
  {
    id: '00000000-0000-4000-8000-0000000005f4',
    tool: 'paint',
    color: 'red',
    size: 'fine',
    points: [2, 2, 2.6, 2.6],
  },
  {
    id: '00000000-0000-4000-8000-0000000005f5',
    tool: 'paint',
    color: 'red',
    size: 'fine',
    points: [2.6, 2, 2, 2.6],
  },
];

/** Which side a sample token is on: monsters red, characters taking turns as PCs and NPCs. */
function sampleSide(kind: string, index: number): BattleSide {
  if (kind === 'monster') return 'monster';
  return index % 2 === 0 ? 'pc' : 'npc';
}

/**
 * The stage test's battle (F5.5): a token for each of `count` sample cutouts, spread over the
 * mat with the last two waiting beside it, and dragged as the GM drags them, locally.
 */
function TestBattle({
  size,
  count,
  painting,
}: {
  size: BattleSize;
  count: number;
  painting: boolean;
}) {
  const squares = battleSquares(size);
  const [places, setPlaces] = useState<(Square | null)[]>(() => {
    const step = Math.max(1, Math.floor((squares * squares) / count));
    return Array.from({ length: count }, (_, index) => {
      if (index >= count - 2) return null;
      const at = (index * step) % (squares * squares);
      return { column: at % squares, row: Math.floor(at / squares) };
    });
  });
  const battle: BattleView = {
    size,
    // The paint is the canvas's to draw: the tokens only need where they stand.
    strokes: [],
    tokens: places.flatMap((square, index) => {
      const sample = SAMPLE_CUTOUTS[index % SAMPLE_CUTOUTS.length];
      if (sample === undefined) return [];
      return [
        {
          id: `test-token-${String(index)}`,
          side: sampleSide(sample.kind, index),
          url: sample.url,
          width: sample.width,
          height: sample.height,
          name: sample.label,
          square,
        },
      ];
    }),
  };
  return (
    <BattleTokens
      battle={battle}
      onMoveToken={(id, square) => {
        if (painting) return;
        const moved = Number(id.slice('test-token-'.length));
        setPlaces((current) => current.map((place, index) => (index === moved ? square : place)));
      }}
    />
  );
}
