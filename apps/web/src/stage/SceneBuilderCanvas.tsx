import { memo } from 'react';

import type { StageCutout } from '@/lib/scenes';

import { SceneObjects } from './SceneObjects';
import { StageCanvas } from './StageCanvas';

export interface SceneBuilderCanvasProps {
  /** The Spot's backdrop; null leaves the back wall bare. */
  backdropUrl: string | null;
  /** The scene's props and puppets, in list order. */
  objects: readonly StageCutout[];
  /** The object being edited, or null. */
  selectedId: string | null;
  /** A cutout was pressed (its id), or the theater beside every cutout (null). */
  onSelect: (id: string | null) => void;
}

/**
 * The scene builder's canvas (F3.2): the theater with one scene in it. Everything it takes is
 * plain data, so the page around it never touches Three.js, and tests can put a stand-in in
 * its place. Memoized: typing in the page's panels must not re-render the scene.
 */
export const SceneBuilderCanvas = memo(function SceneBuilderCanvas({
  backdropUrl,
  objects,
  selectedId,
  onSelect,
}: SceneBuilderCanvasProps) {
  return (
    <StageCanvas
      backdropUrl={backdropUrl}
      curtainOpen
      onPointerMissed={() => {
        onSelect(null);
      }}
    >
      <SceneObjects objects={objects} selectedId={selectedId} onSelect={onSelect} />
    </StageCanvas>
  );
});
