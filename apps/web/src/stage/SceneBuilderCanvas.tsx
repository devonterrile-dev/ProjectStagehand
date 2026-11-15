import { memo, useCallback, useRef, type DragEvent } from 'react';

import { NEW_DEPTH_TICK, RECORD_DRAG_TYPE, type StageCutout } from '@/lib/scenes';

import { DepthGuides } from './DepthGuides';
import { EditingCamera, type EditingControls } from './EditingCamera';
import type { Place } from './placement';
import { PlacementProbe, type PlaceProbe } from './PlacementProbe';
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
  /** Whether cutouts can be dragged and records dropped in: not in preview or when archived. */
  editable: boolean;
  /** The editing camera, which orbits the box, in place of the locked player camera. */
  lookAround: boolean;
  /** The depth tick to light among the depth guides; null draws no guides. */
  guideTick: number | null;
  /** A cutout was dragged to a new place on its depth tick. */
  onMove: (id: string, place: Place) => void;
  /**
   * A record was dragged from the tray and dropped in the theater. `place` is where, on the
   * tick new objects go on; null when it couldn't be told, for the usual starting place.
   */
  onDropRecord: (recordId: string, place: Place | null) => void;
}

/**
 * The scene builder's canvas (F3.2): the theater with one scene in it, where cutouts are
 * selected, dragged and dropped in. Everything it takes is plain data and callbacks, so the
 * page around it never touches Three.js, and tests can put a stand-in in its place. Memoized:
 * typing in the page's panels must not re-render the scene.
 */
export const SceneBuilderCanvas = memo(function SceneBuilderCanvas({
  backdropUrl,
  objects,
  selectedId,
  onSelect,
  editable,
  lookAround,
  guideTick,
  onMove,
  onDropRecord,
}: SceneBuilderCanvasProps) {
  const controls = useRef<EditingControls | null>(null);
  const probe = useRef<PlaceProbe | null>(null);

  // While a cutout is dragged, the same pointer must not also turn the camera.
  const holdCamera = useCallback((dragging: boolean) => {
    if (controls.current !== null) controls.current.enabled = !dragging;
  }, []);

  function allowDrop(event: DragEvent) {
    if (!editable || !event.dataTransfer.types.includes(RECORD_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function drop(event: DragEvent) {
    const recordId = event.dataTransfer.getData(RECORD_DRAG_TYPE);
    if (!editable || recordId === '') return;
    event.preventDefault();
    onDropRecord(recordId, probe.current?.(event.clientX, event.clientY, NEW_DEPTH_TICK) ?? null);
  }

  return (
    <div className="h-full w-full" onDragOver={allowDrop} onDrop={drop}>
      <StageCanvas
        backdropUrl={backdropUrl}
        curtainOpen
        onPointerMissed={() => {
          onSelect(null);
        }}
        {...(lookAround ? { cameraRig: <EditingCamera ref={controls} /> } : {})}
      >
        <SceneObjects
          objects={objects}
          selectedId={selectedId}
          onSelect={onSelect}
          {...(editable ? { onMove, onDragChange: holdCamera } : {})}
        />
        {guideTick !== null && <DepthGuides activeTick={guideTick} />}
        <PlacementProbe probeRef={probe} />
      </StageCanvas>
    </div>
  );
});
