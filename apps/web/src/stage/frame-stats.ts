/** Frame-time arithmetic for the stage's performance test (F3.1). Pure. */

export interface FrameSummary {
  /** Frames counted. */
  frames: number;
  /** How long they took together. */
  seconds: number;
  averageFps: number;
  /** The frame rate over the slowest 1% of frames: what a stutter feels like. */
  lowFps: number;
}

/** A frame longer than this means the tab was hidden or the machine slept; it isn't counted. */
export const LONGEST_FRAME_SECONDS = 1;

/** Whether a frame time is one to count. */
export function isCountedFrame(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds > 0 && seconds <= LONGEST_FRAME_SECONDS;
}

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

/** Sums up a run of frame times, in seconds each. Null when there is nothing to count. */
export function summarizeFrames(frameSeconds: readonly number[]): FrameSummary | null {
  const frames = frameSeconds.filter(isCountedFrame);
  if (frames.length === 0) return null;
  const seconds = sum(frames);
  const slowest = [...frames]
    .sort((a, b) => b - a)
    .slice(0, Math.max(1, Math.ceil(frames.length / 100)));
  return {
    frames: frames.length,
    seconds,
    averageFps: frames.length / seconds,
    lowFps: slowest.length / sum(slowest),
  };
}
