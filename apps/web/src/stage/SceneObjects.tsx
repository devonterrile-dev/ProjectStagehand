import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react';

import type { StageCutout } from '@/lib/scenes';

import { Cutout } from './Cutout';
import type { Point3 } from './dimensions';
import { dragPlace, isDrag, rayAtDepth, type Place } from './placement';
import { screenRay, toPointerRay } from './pointer-ray';
import { cutoutPosition } from './scene-layout';

/**
 * One cutout whose image can't be loaded is left out; the rest of the theater keeps drawing.
 * Without this, a single missing image would take the whole stage down.
 */
class CutoutBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export interface SceneObjectsProps {
  /** In the scene's list order: later ones are in front on the same depth tick. */
  objects: readonly StageCutout[];
  /** The object being edited, framed. */
  selectedId?: string | null;
  /** Called with the id of a cutout that is pressed. Without it they ignore the pointer. */
  onSelect?: (id: string) => void;
  /**
   * Called as a pressed cutout is dragged across and up its own depth tick (F3.2c). Without
   * it, cutouts can be selected but not moved.
   */
  onMove?: (id: string, place: Place) => void;
  /** Called when a drag starts (true) and ends (false), so the editing camera can hold still. */
  onDragChange?: (dragging: boolean) => void;
  /**
   * Live play (F3.4): cutouts glide to new places, and puppets rise out of the void as they
   * appear. `snapId` names one that follows the pointer exactly instead: the one being dragged.
   */
  glide?: boolean;
  snapId?: string | null;
}

/**
 * A scene's props and puppets in the theater (F3.2, governance §12). Each waits for its own
 * image, so placing one never blanks the others. In the scene builder a cutout is selected by
 * pressing it and moved by dragging it.
 */
export function SceneObjects({
  objects,
  selectedId = null,
  onSelect,
  onMove,
  onDragChange,
  glide = false,
  snapId = null,
}: SceneObjectsProps) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);

  // A drag outlives the render it started in, so it calls whatever the handlers are by then.
  const handlers = useRef({ onMove, onDragChange });
  useEffect(() => {
    handlers.current = { onMove, onDragChange };
  });
  /** Ends the drag in progress, if any. */
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      endDrag.current?.();
    },
    [],
  );

  function press(event: ThreeEvent<PointerEvent>, id: string, base: Point3) {
    // The nearest cutout under the pointer takes the press.
    event.stopPropagation();
    onSelect?.(id);
    if (handlers.current.onMove === undefined || event.button !== 0) return;

    // Where on its depth plane the cutout was taken hold of, from its bottom center.
    const [baseX, baseY, z] = base;
    const hold = rayAtDepth(toPointerRay(event.ray), z);
    if (hold === null) return;
    const grab = { dx: hold.x - baseX, dy: hold.y - baseY };
    const from = { clientX: event.clientX, clientY: event.clientY };
    const view = canvas.ownerDocument.defaultView ?? window;
    let dragging = false;

    const move = (moved: PointerEvent) => {
      if (!dragging) {
        if (!isDrag(from, moved)) return;
        dragging = true;
        handlers.current.onDragChange?.(true);
      }
      const place = dragPlace(screenRay(camera, canvas, moved.clientX, moved.clientY), grab, z);
      if (place !== null) handlers.current.onMove?.(id, place);
    };
    const end = () => {
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', end);
      view.removeEventListener('pointercancel', end);
      endDrag.current = null;
      if (dragging) handlers.current.onDragChange?.(false);
    };

    endDrag.current?.();
    // On the window, so the drag carries on when the pointer leaves the cutout or the canvas.
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    endDrag.current = end;
  }

  return (
    <>
      {objects.map((object, index) => {
        const position = cutoutPosition(object, index);
        const glides = glide && object.id !== snapId;
        const rises = glides && object.mount === 'stick';
        return (
          // Keyed by the image too: a boundary that gave up tries again with a new image.
          <CutoutBoundary key={`${object.id}:${object.url}`}>
            <Suspense fallback={null}>
              <Cutout
                url={object.url}
                width={object.width}
                height={object.height}
                position={position}
                scale={object.scale}
                flipped={object.flipped}
                mount={object.mount}
                faded={object.faded}
                selected={object.id === selectedId}
                glide={glides}
                {...(rises
                  ? { enterFrom: cutoutPosition({ ...object, lowered: true }, index) }
                  : {})}
                {...(onSelect === undefined
                  ? {}
                  : {
                      onPress: (event) => {
                        press(event, object.id, position);
                      },
                    })}
              />
            </Suspense>
          </CutoutBoundary>
        );
      })}
    </>
  );
}
