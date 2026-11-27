import { memo, useEffect, useRef } from 'react';

import type { EmoteCue } from './Cutout';
import { PerfProbe, type PerfProbeProps } from './PerfProbe';
import { StageCanvas } from './StageCanvas';
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
  maxPixelRatio,
  measure,
  onLive,
  onMeasured,
}: StageTestCanvasProps) {
  // Playing from the start each time Travel is turned on (F5.4).
  const anchor = useRef<TravelAnchor | null>(null);
  useEffect(() => {
    anchor.current = travel ? { playing: true, distance: 0, at: performance.now() } : null;
  }, [travel]);

  return (
    <StageCanvas
      backdropUrl={backdropUrl}
      curtainOpen={curtainOpen}
      maxPixelRatio={maxPixelRatio}
      travel={anchor}
    >
      <TestScene count={objectCount} sway={sway} talking={talking} emote={emote} walking={travel} />
      {travel && <TestPasser travel={anchor} />}
      <TableStandIns />
      <PerfProbe measure={measure} onLive={onLive} onMeasured={onMeasured} />
    </StageCanvas>
  );
});
