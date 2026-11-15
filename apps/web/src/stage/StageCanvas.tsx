import { Canvas } from '@react-three/fiber';
import { Component, Suspense, type ReactNode } from 'react';

import { Backdrop } from './Backdrop';
import { fitStageCamera, STAGE_FOV } from './camera';
import { STAGE_COLORS } from './colors';
import { Curtain } from './Curtain';
import { MAX_PIXEL_RATIO } from './quality';
import { Room } from './Room';
import { StageCamera } from './StageCamera';
import { Table } from './Table';
import { TheaterBox } from './TheaterBox';

/** Where the camera starts before the canvas knows its own shape. */
const INITIAL_CAMERA = fitStageCamera(16 / 9);

export interface StageCanvasProps {
  /** The backdrop on the back wall; null leaves the wall bare. */
  backdropUrl: string | null;
  curtainOpen: boolean;
  /** The most device pixels per CSS pixel to draw at. */
  maxPixelRatio?: number;
  /** Extra objects in the scene: props and puppets. */
  children?: ReactNode;
  /** A press on the stage that hit nothing that listens for one (the scene builder, F3.2). */
  onPointerMissed?: () => void;
}

/** Shown instead of the stage when the browser can't start WebGL, or the scene crashes. */
class StageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center">
        <p role="alert">
          Your browser couldn&apos;t start 3D graphics, so the stage can&apos;t be shown. Try
          another browser, or turn on hardware acceleration in your browser&apos;s settings.
        </p>
      </div>
    );
  }
}

/**
 * The tabletop theater (F3.1, governance §12): the room, the table, the theater box, the
 * backdrop, the curtain and the locked camera. It fills its parent, which must have a size.
 *
 * Lighting follows the §12 budget: one directional light and an ambient one for the table and
 * the box, no shadow maps. Art (backdrops, cutouts) is unlit, so it keeps its drawn colors.
 */
export function StageCanvas({
  backdropUrl,
  curtainOpen,
  maxPixelRatio = MAX_PIXEL_RATIO,
  children,
  onPointerMissed,
}: StageCanvasProps) {
  return (
    <StageErrorBoundary>
      <Canvas
        flat
        dpr={[1, Math.max(1, maxPixelRatio)]}
        camera={{
          fov: STAGE_FOV,
          near: 0.1,
          far: 80,
          position: [...INITIAL_CAMERA.position],
        }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        {...(onPointerMissed === undefined ? {} : { onPointerMissed })}
      >
        <color attach="background" args={[STAGE_COLORS.room]} />
        <ambientLight intensity={1.9} />
        <directionalLight position={[1.5, 3, 4]} intensity={1.6} />

        <StageCamera />
        {/* Each textured piece waits for its own image, so none holds the others back. */}
        <Suspense fallback={null}>
          <Room />
        </Suspense>
        <Suspense fallback={null}>
          <Table />
        </Suspense>
        <Suspense fallback={null}>
          <TheaterBox />
        </Suspense>
        {backdropUrl !== null && (
          // Its own boundary: swapping the backdrop must not blank the rest of the theater.
          <Suspense fallback={null}>
            <Backdrop url={backdropUrl} />
          </Suspense>
        )}
        <Suspense fallback={null}>{children}</Suspense>
        <Curtain open={curtainOpen} />
      </Canvas>
    </StageErrorBoundary>
  );
}
