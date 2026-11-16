import { memo, useEffect, useState } from 'react';

import type { StageCutout } from '@/lib/scenes';

import type { Place } from './placement';
import { SceneObjects } from './SceneObjects';
import { StageCanvas } from './StageCanvas';

export interface PlayCanvasProps {
  /** The backdrop on the back wall; null leaves the wall bare. */
  backdropUrl: string | null;
  /** What is in sight, in list order. */
  objects: readonly StageCutout[];
  curtainOpen: boolean;
  /** The GM's theater (F3.4): the object picked on the desk, framed. */
  selectedId?: string | null;
  /** The GM's theater: a cutout was pressed, or (null) the empty theater was. */
  onSelect?: (id: string | null) => void;
  /** The GM's theater: a pressed cutout is being dragged across and up its depth tick. */
  onMove?: (id: string, place: Place) => void;
}

/** How long a lowered puppet is still drawn, sinking into the void, once it has left the stage. */
export const LEAVING_MS = 700;

/**
 * Puppets that have just left `objects` (lowered, or taken off the stage), kept a moment longer
 * and drawn lowered, so they sink out of sight instead of vanishing. Props simply go.
 */
function useLeaving(objects: readonly StageCutout[]): readonly StageCutout[] {
  const [previous, setPrevious] = useState(objects);
  const [leaving, setLeaving] = useState<readonly StageCutout[]>([]);

  // Worked out while rendering, from the list before: the documented way to follow a prop.
  if (objects !== previous) {
    const present = new Set(objects.map((object) => object.id));
    const gone = previous.filter(
      (object) => !present.has(object.id) && object.mount === 'stick' && !object.lowered,
    );
    setPrevious(objects);
    setLeaving((current) => [
      ...current.filter((object) => !present.has(object.id)),
      ...gone.map((object) => ({ ...object, lowered: true })),
    ]);
  }

  useEffect(() => {
    if (leaving.length === 0) return;
    const timer = window.setTimeout(() => {
      setLeaving([]);
    }, LEAVING_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [leaving]);

  return leaving.length === 0 ? objects : [...objects, ...leaving];
}

/**
 * The theater during a live session (F3.3, F3.4): the locked player camera for everyone, the GM
 * included. Cutouts glide when they move, and puppets rise out of the void and sink back into
 * it. In the GM's theater a cutout can be picked and dragged. Everything it takes is plain
 * data, so the page around it never touches Three.js, and tests can put a stand-in in its
 * place. Memoized: the desk beside it re-rendering must not re-render the scene.
 */
export const PlayCanvas = memo(function PlayCanvas({
  backdropUrl,
  objects,
  curtainOpen,
  selectedId = null,
  onSelect,
  onMove,
}: PlayCanvasProps) {
  const drawn = useLeaving(objects);
  const [dragging, setDragging] = useState(false);

  return (
    <StageCanvas
      backdropUrl={backdropUrl}
      curtainOpen={curtainOpen}
      {...(onSelect === undefined
        ? {}
        : {
            onPointerMissed: () => {
              onSelect(null);
            },
          })}
    >
      <SceneObjects
        objects={drawn}
        selectedId={selectedId}
        glide
        snapId={dragging ? selectedId : null}
        {...(onSelect === undefined ? {} : { onSelect })}
        {...(onMove === undefined ? {} : { onMove, onDragChange: setDragging })}
      />
    </StageCanvas>
  );
});
