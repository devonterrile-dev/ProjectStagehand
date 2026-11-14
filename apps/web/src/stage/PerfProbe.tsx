import { useFrame, useThree, type RootState } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { WebGLRenderer } from 'three';

import { isCountedFrame, summarizeFrames } from './frame-stats';

/** What the stage is doing right now, for the performance panel. */
export interface LiveStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  /** Textures held by the graphics card. */
  textures: number;
  /** Device pixels per CSS pixel the stage is drawn at. */
  pixelRatio: number;
  /** The stage's size on screen, in CSS pixels. */
  width: number;
  height: number;
  gpu: string;
  /** Seconds left of a running measurement, or null. */
  measuringLeft: number | null;
}

/** One measurement: a new `id` starts a new run. */
export interface MeasureRun {
  id: number;
  seconds: number;
}

export interface PerfProbeProps {
  measure: MeasureRun | null;
  onLive: (live: LiveStats) => void;
  /**
   * Called once per run, with the time each frame took in seconds and what the stage was
   * doing when the run ended.
   */
  onMeasured: (id: number, frameSeconds: number[], at: LiveStats) => void;
}

/** How often the live numbers are sent, in seconds. */
const LIVE_EVERY = 0.5;

/** The graphics card's name, as far as the browser will tell. */
function gpuName(gl: WebGLRenderer): string {
  const context = gl.getContext();
  const info = context.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = context.getParameter(
    info === null ? context.RENDERER : info.UNMASKED_RENDERER_WEBGL,
  );
  return typeof name === 'string' && name !== '' ? name : 'Unknown GPU';
}

function read(state: RootState, gpu: string, fps: number, measuringLeft: number | null): LiveStats {
  return {
    fps,
    drawCalls: state.gl.info.render.calls,
    triangles: state.gl.info.render.triangles,
    textures: state.gl.info.memory.textures,
    pixelRatio: state.viewport.dpr,
    width: state.size.width,
    height: state.size.height,
    gpu,
    measuringLeft,
  };
}

/**
 * Watches the stage's frames from inside the canvas (F3.1): sends live numbers twice a
 * second, and when asked records every frame of a measurement run. It draws nothing.
 */
export function PerfProbe({ measure, onLive, onMeasured }: PerfProbeProps) {
  const gl = useThree((state) => state.gl);
  const gpu = useMemo(() => gpuName(gl), [gl]);

  const recent = useRef<number[]>([]);
  const run = useRef<{ id: number; seconds: number; elapsed: number; frames: number[] } | null>(
    null,
  );
  const startedId = useRef<number | null>(null);

  useFrame((state, delta) => {
    if (measure === null) {
      run.current = null;
    } else if (startedId.current !== measure.id) {
      startedId.current = measure.id;
      run.current = { id: measure.id, seconds: measure.seconds, elapsed: 0, frames: [] };
    }

    // A frame after the tab was hidden says nothing about the stage.
    if (!isCountedFrame(delta)) return;
    recent.current.push(delta);
    const window = summarizeFrames(recent.current);

    const current = run.current;
    if (current !== null) {
      current.frames.push(delta);
      current.elapsed += delta;
      if (current.elapsed >= current.seconds) {
        run.current = null;
        onMeasured(current.id, current.frames, read(state, gpu, window?.averageFps ?? 0, null));
      }
    }

    if (window === null || window.seconds < LIVE_EVERY) return;
    recent.current = [];
    const left = run.current;
    onLive(
      read(
        state,
        gpu,
        window.averageFps,
        left === null ? null : Math.max(0, left.seconds - left.elapsed),
      ),
    );
  });

  return null;
}
