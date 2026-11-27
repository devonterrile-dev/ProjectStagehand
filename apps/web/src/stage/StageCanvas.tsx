import { Canvas } from '@react-three/fiber';
import { Component, Suspense, type ReactNode } from 'react';

import { Backdrop } from './Backdrop';
import { fitStageCamera, STAGE_FOV, type StageView } from './camera';
import { STAGE_COLORS } from './colors';
import { Curtain } from './Curtain';
import { MAX_PIXEL_RATIO } from './quality';
import { Room } from './Room';
import { StageCamera } from './StageCamera';
import { Table } from './Table';
import { TheaterBox } from './TheaterBox';
import { NO_TRAVEL, TravelContext, type TravelRef } from './travel';

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
  /**
   * What holds the camera, in place of the locked player camera: the scene builder's editing
   * camera (F3.2c). Players always get the locked one.
   */
  cameraRig?: ReactNode;
  /** Where the locked camera rests (F3.5b): the theater, or something on the table. */
  view?: StageView;
  /** The locked camera has arrived at `view` (F3.5b). */
  onCameraSettle?: (view: StageView) => void;
  /**
   * A transition scene's travel (F5.4): the backdrop scrolls, and the cutouts inside read it to
   * pass by and walk. Null or left out for a static scene.
   */
  travel?: TravelRef;
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
  cameraRig,
  view = 'stage',
  onCameraSettle,
  travel = NO_TRAVEL,
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

        {cameraRig ?? (
          <StageCamera
            view={view}
            {...(onCameraSettle === undefined ? {} : { onSettle: onCameraSettle })}
          />
        )}
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
        {/* Inside the canvas, so everything drawn in it reads the same travel (F5.4). */}
        <TravelContext value={travel}>
          {backdropUrl !== null && (
            // Its own boundary: swapping the backdrop must not blank the rest of the theater.
            <Suspense fallback={null}>
              <Backdrop url={backdropUrl} />
            </Suspense>
          )}
          <Suspense fallback={null}>{children}</Suspense>
        </TravelContext>
        <Curtain open={curtainOpen} />
      </Canvas>
    </StageErrorBoundary>
  );
}
