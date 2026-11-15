import { Component, Suspense, type ReactNode } from 'react';

import type { StageCutout } from '@/lib/scenes';

import { Cutout } from './Cutout';
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
}

/**
 * A scene's props and puppets in the theater (F3.2, governance §12). Each waits for its own
 * image, so placing one never blanks the others.
 */
export function SceneObjects({ objects, selectedId = null, onSelect }: SceneObjectsProps) {
  return (
    <>
      {objects.map((object, index) => (
        // Keyed by the image too: a boundary that gave up tries again with a new image.
        <CutoutBoundary key={`${object.id}:${object.url}`}>
          <Suspense fallback={null}>
            <Cutout
              url={object.url}
              width={object.width}
              height={object.height}
              position={cutoutPosition(object, index)}
              scale={object.scale}
              flipped={object.flipped}
              mount={object.mount}
              faded={object.faded}
              selected={object.id === selectedId}
              {...(onSelect === undefined
                ? {}
                : {
                    onPress: (event) => {
                      // The nearest cutout under the pointer takes the press.
                      event.stopPropagation();
                      onSelect(object.id);
                    },
                  })}
            />
          </Suspense>
        </CutoutBoundary>
      ))}
    </>
  );
}
