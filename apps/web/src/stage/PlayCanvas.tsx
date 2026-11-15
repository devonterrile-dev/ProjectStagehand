import { memo } from 'react';

import type { StageCutout } from '@/lib/scenes';

import { SceneObjects } from './SceneObjects';
import { StageCanvas } from './StageCanvas';

export interface PlayCanvasProps {
  /** The backdrop on the back wall; null leaves the wall bare. */
  backdropUrl: string | null;
  /** What is in sight, in list order. */
  objects: readonly StageCutout[];
  curtainOpen: boolean;
}

/**
 * The theater during a live session (F3.3): the locked player camera for everyone, the GM
 * included, and nothing to select or drag. Everything it takes is plain data, so the page
 * around it never touches Three.js, and tests can put a stand-in in its place. Memoized: the
 * desk beside it re-rendering must not re-render the scene.
 */
export const PlayCanvas = memo(function PlayCanvas({
  backdropUrl,
  objects,
  curtainOpen,
}: PlayCanvasProps) {
  return (
    <StageCanvas backdropUrl={backdropUrl} curtainOpen={curtainOpen}>
      <SceneObjects objects={objects} />
    </StageCanvas>
  );
});
