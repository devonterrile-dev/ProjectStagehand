/**
 * The browser mic as a speaking source (F3.9, governance §13, D-57), for a table in a normal
 * tab. The mic's level is read here, in the browser, and turned into talking or not; only that
 * true or false ever leaves (through the live room). No sound is recorded or sent.
 *
 * - The level is the loudness of the last few milliseconds, in dBFS (0 is as loud as the mic
 *   goes). Talking starts as soon as it passes the threshold and stops once it has stayed
 *   under for `GATE.holdMs`, so the gaps between words don't flicker the puppet.
 * - The threshold comes from a sensitivity the player sets (0 to 100): more sensitive hears
 *   quieter speech, and more of the room.
 * - Muting lets go of the mic (the browser's mic light goes off); unmuting opens it again.
 * - The level is read on a timer, not each animation frame, which stops in a hidden tab.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { SpeakingSource } from './speaking';

export const GATE = {
  /** The threshold at the most sensitive setting (100). */
  quietestDb: -65,
  /** The threshold at the least sensitive setting (0). */
  loudestDb: -25,
  /** How long the level must stay under the threshold before talking stops. */
  holdMs: 350,
  /** How often the level is read. */
  readEveryMs: 50,
  /** The quietest level reported; silence is this. */
  floorDb: -100,
} as const;

export interface MicSettings {
  /** The mic is not listened to at all. */
  muted: boolean;
  /** 0 (only loud speech) to 100 (the quietest); see `thresholdDb`. */
  sensitivity: number;
}

export const DEFAULT_MIC_SETTINGS: MicSettings = { muted: false, sensitivity: 50 };

/** Where a browser keeps its mic settings, so the next session starts the same way. */
export const MIC_SETTINGS_KEY = 'stagehand.mic';

/** The level, in dBFS, that counts as talking at a sensitivity. */
export function thresholdDb(sensitivity: number): number {
  const clamped = Math.min(100, Math.max(0, sensitivity));
  return GATE.loudestDb + ((GATE.quietestDb - GATE.loudestDb) * clamped) / 100;
}

/** How loud some samples are (-1 to 1), as dBFS: their root mean square, never below the floor. */
export function levelDb(samples: Float32Array | readonly number[]): number {
  if (samples.length === 0) return GATE.floorDb;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  return rms === 0 ? GATE.floorDb : Math.max(GATE.floorDb, 20 * Math.log10(rms));
}

export interface GateState {
  talking: boolean;
  /** When the level was last over the threshold. */
  loudAt: number;
}

export const QUIET: GateState = { talking: false, loudAt: Number.NEGATIVE_INFINITY };

/** One reading through the gate: talking at once when loud, quiet after `GATE.holdMs` under. */
export function gate(state: GateState, level: number, threshold: number, now: number): GateState {
  if (level >= threshold) return { talking: true, loudAt: now };
  if (state.talking && now - state.loudAt >= GATE.holdMs) return { ...state, talking: false };
  return state;
}

/** The settings this browser kept, or the defaults; never throws (storage may be off). */
export function loadMicSettings(storage: () => Storage = () => window.localStorage): MicSettings {
  try {
    const kept = JSON.parse(storage().getItem(MIC_SETTINGS_KEY) ?? 'null') as unknown;
    if (typeof kept !== 'object' || kept === null) return DEFAULT_MIC_SETTINGS;
    const { muted, sensitivity } = kept as Partial<Record<keyof MicSettings, unknown>>;
    return {
      muted: typeof muted === 'boolean' ? muted : DEFAULT_MIC_SETTINGS.muted,
      sensitivity:
        typeof sensitivity === 'number' && sensitivity >= 0 && sensitivity <= 100
          ? sensitivity
          : DEFAULT_MIC_SETTINGS.sensitivity,
    };
  } catch {
    return DEFAULT_MIC_SETTINGS;
  }
}

/** Keeps the settings for next time, if this browser lets us. */
export function saveMicSettings(
  settings: MicSettings,
  storage: () => Storage = () => window.localStorage,
): void {
  try {
    storage().setItem(MIC_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not kept: the next session starts from the defaults.
  }
}

/**
 * - `off`: not started yet.
 * - `asking`: waiting for the browser's permission prompt.
 * - `on`: listening.
 * - `muted`: the player muted it.
 * - `blocked`: the browser (or the player) refused the mic.
 * - `unavailable`: no mic, or a browser that can't give one.
 */
export type MicStatus = 'off' | 'asking' | 'on' | 'muted' | 'blocked' | 'unavailable';

export interface MicState {
  status: MicStatus;
  /** The last level read, in dBFS; the floor while not listening. */
  level: number;
  talking: boolean;
  settings: MicSettings;
}

/** The parts of the browser the mic needs; tests pass their own. */
export interface MicDeps {
  getUserMedia?: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined;
  createAudioContext?: (() => AudioContext) | undefined;
  now?: () => number;
  target?: Window;
  storage?: () => Storage;
}

export interface Mic extends SpeakingSource {
  readonly store: StoreApi<MicState>;
  setMuted(muted: boolean): void;
  setSensitivity(sensitivity: number): void;
}

function browserGetUserMedia(): MicDeps['getUserMedia'] {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  // Missing outside a secure context (http on another machine) and in old browsers.
  if (typeof devices?.getUserMedia !== 'function') return undefined;
  return (constraints) => devices.getUserMedia(constraints);
}

function browserAudioContext(): MicDeps['createAudioContext'] {
  if (typeof AudioContext === 'undefined') return undefined;
  return () => new AudioContext();
}

/** The mic, made once per table. Nothing is asked of the browser until `start`. */
export function createMic(deps: MicDeps = {}): Mic {
  const getUserMedia = 'getUserMedia' in deps ? deps.getUserMedia : browserGetUserMedia();
  const createAudioContext =
    'createAudioContext' in deps ? deps.createAudioContext : browserAudioContext();
  const now = deps.now ?? (() => performance.now());
  const target = deps.target ?? window;
  const storage = deps.storage ?? (() => window.localStorage);

  const store = createStore<MicState>(() => ({
    status: 'off',
    level: GATE.floorDb,
    talking: false,
    settings: loadMicSettings(storage),
  }));

  /** Who hears talking start and stop, while started. */
  let onChange: ((speaking: boolean) => void) | null = null;
  /** Bumped on every open and close, so a slow permission prompt can't revive a closed mic. */
  let generation = 0;
  let close: (() => void) | null = null;

  function setTalking(talking: boolean) {
    if (store.getState().talking === talking) return;
    store.setState({ talking });
    onChange?.(talking);
  }

  function stopListening() {
    generation += 1;
    close?.();
    close = null;
    setTalking(false);
    store.setState({ level: GATE.floorDb });
  }

  async function open() {
    const mine = (generation += 1);
    if (getUserMedia === undefined || createAudioContext === undefined) {
      store.setState({ status: 'unavailable' });
      return;
    }
    store.setState({ status: 'asking' });
    let stream: MediaStream;
    try {
      stream = await getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (mine !== generation) return;
      const refused =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      store.setState({ status: refused ? 'blocked' : 'unavailable' });
      return;
    }
    if (mine !== generation) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    const context = createAudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const input = context.createMediaStreamSource(stream);
    input.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    // A page that hasn't been clicked yet may start its audio suspended; the first press wakes it.
    const wake = () => {
      void context.resume().catch(() => undefined);
    };
    if (context.state === 'suspended') wake();
    target.addEventListener('pointerdown', wake);
    target.addEventListener('keydown', wake);

    let state = QUIET;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const level = levelDb(samples);
      state = gate(state, level, thresholdDb(store.getState().settings.sensitivity), now());
      store.setState({ level });
      setTalking(state.talking);
    }, GATE.readEveryMs);

    close = () => {
      clearInterval(timer);
      target.removeEventListener('pointerdown', wake);
      target.removeEventListener('keydown', wake);
      input.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => undefined);
    };
    store.setState({ status: 'on' });
  }

  function changeSettings(change: Partial<MicSettings>) {
    const settings = { ...store.getState().settings, ...change };
    store.setState({ settings });
    saveMicSettings(settings, storage);
  }

  return {
    store,
    start(listener) {
      onChange = listener;
      if (store.getState().settings.muted) store.setState({ status: 'muted' });
      else void open();
      return () => {
        stopListening();
        onChange = null;
        store.setState({ status: 'off' });
      };
    },
    setMuted(muted) {
      if (store.getState().settings.muted === muted) return;
      changeSettings({ muted });
      if (onChange === null) return;
      if (muted) {
        stopListening();
        store.setState({ status: 'muted' });
      } else {
        void open();
      }
    },
    setSensitivity(sensitivity) {
      changeSettings({ sensitivity: Math.min(100, Math.max(0, Math.round(sensitivity))) });
    },
  };
}
