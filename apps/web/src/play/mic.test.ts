import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMic,
  DEFAULT_MIC_SETTINGS,
  gate,
  GATE,
  levelDb,
  loadMicSettings,
  MIC_SETTINGS_KEY,
  QUIET,
  saveMicSettings,
  thresholdDb,
  type MicDeps,
} from './mic';

/** A Storage kept in a map; `broken` makes every call throw, as a blocked one does. */
function memoryStorage(broken = false): Storage {
  const kept = new Map<string, string>();
  const check = () => {
    if (broken) throw new DOMException('denied', 'SecurityError');
  };
  return {
    get length() {
      return kept.size;
    },
    clear: () => {
      kept.clear();
    },
    key: () => null,
    getItem: (key) => {
      check();
      return kept.get(key) ?? null;
    },
    setItem: (key, value) => {
      check();
      kept.set(key, value);
    },
    removeItem: (key) => {
      kept.delete(key);
    },
  };
}

describe('the gate', () => {
  it('maps sensitivity to a threshold, the most sensitive hearing the quietest', () => {
    expect(thresholdDb(0)).toBe(GATE.loudestDb);
    expect(thresholdDb(100)).toBe(GATE.quietestDb);
    expect(thresholdDb(50)).toBe(-45);
    expect(thresholdDb(150)).toBe(GATE.quietestDb);
  });

  it('measures loudness as dBFS, silence at the floor', () => {
    expect(levelDb(new Float32Array(8))).toBe(GATE.floorDb);
    expect(levelDb([])).toBe(GATE.floorDb);
    expect(levelDb([1, -1, 1, -1])).toBeCloseTo(0);
    expect(levelDb([0.1, -0.1])).toBeCloseTo(-20);
  });

  it('talks at once when loud, and stops only after the hold-off', () => {
    let state = gate(QUIET, -30, -45, 0);
    expect(state.talking).toBe(true);
    state = gate(state, -60, -45, GATE.holdMs - 1);
    expect(state.talking).toBe(true);
    // A word in the gap keeps it going.
    state = gate(state, -40, -45, GATE.holdMs);
    state = gate(state, -60, -45, 2 * GATE.holdMs - 1);
    expect(state.talking).toBe(true);
    state = gate(state, -60, -45, 2 * GATE.holdMs);
    expect(state.talking).toBe(false);
    expect(gate(QUIET, -60, -45, 10)).toBe(QUIET);
  });
});

describe('mic settings', () => {
  it('keeps them for next time, and falls back to the defaults', () => {
    const storage = memoryStorage();
    expect(loadMicSettings(() => storage)).toEqual(DEFAULT_MIC_SETTINGS);

    saveMicSettings({ muted: true, sensitivity: 80 }, () => storage);
    expect(loadMicSettings(() => storage)).toEqual({ muted: true, sensitivity: 80 });

    storage.setItem(MIC_SETTINGS_KEY, JSON.stringify({ muted: 'yes', sensitivity: 400 }));
    expect(loadMicSettings(() => storage)).toEqual(DEFAULT_MIC_SETTINGS);
    storage.setItem(MIC_SETTINGS_KEY, '{nonsense');
    expect(loadMicSettings(() => storage)).toEqual(DEFAULT_MIC_SETTINGS);
  });

  it('never throws when the browser keeps nothing', () => {
    const storage = memoryStorage(true);
    expect(() => {
      saveMicSettings({ muted: true, sensitivity: 10 }, () => storage);
    }).not.toThrow();
    expect(loadMicSettings(() => storage)).toEqual(DEFAULT_MIC_SETTINGS);
  });
});

/** A mic and an audio graph that hear `world.amplitude` on every sample. */
function fakeBrowser() {
  const world = {
    amplitude: 0,
    asked: 0,
    stopped: 0,
    closed: 0,
    resumed: 0,
    state: 'running' as AudioContextState,
    refuse: null as DOMException | null,
  };
  const target = new EventTarget() as Window;
  const track = {
    stop: () => {
      world.stopped += 1;
    },
  };
  const deps: MicDeps = {
    getUserMedia: () => {
      world.asked += 1;
      if (world.refuse !== null) return Promise.reject(world.refuse);
      return Promise.resolve({ getTracks: () => [track] } as unknown as MediaStream);
    },
    createAudioContext: () =>
      ({
        state: world.state,
        createAnalyser: () => ({
          fftSize: 0,
          getFloatTimeDomainData: (samples: Float32Array) => {
            samples.fill(world.amplitude);
          },
        }),
        createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }),
        resume: () => {
          world.resumed += 1;
          return Promise.resolve();
        },
        close: () => {
          world.closed += 1;
          return Promise.resolve();
        },
      }) as unknown as AudioContext,
    now: () => Date.now(),
    target,
    storage: () => storage,
  };
  const storage = memoryStorage();
  return { world, deps, target, storage };
}

describe('createMic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for the mic on start, and says talking while it hears speech', async () => {
    const { world, deps } = fakeBrowser();
    const mic = createMic(deps);
    const heard: boolean[] = [];
    expect(mic.store.getState().status).toBe('off');

    const stop = mic.start((speaking) => heard.push(speaking));
    expect(mic.store.getState().status).toBe('asking');
    await vi.advanceTimersByTimeAsync(0);
    expect(mic.store.getState().status).toBe('on');
    expect(world.asked).toBe(1);

    world.amplitude = 0.1; // -20 dBFS: over the default threshold
    await vi.advanceTimersByTimeAsync(GATE.readEveryMs);
    expect(heard).toEqual([true]);
    expect(mic.store.getState().level).toBeCloseTo(-20);

    world.amplitude = 0.001; // -60 dBFS
    await vi.advanceTimersByTimeAsync(GATE.holdMs + GATE.readEveryMs);
    expect(heard).toEqual([true, false]);

    world.amplitude = 0.1;
    await vi.advanceTimersByTimeAsync(GATE.readEveryMs);
    stop();
    expect(heard).toEqual([true, false, true, false]);
    expect(world.stopped).toBe(1);
    expect(world.closed).toBe(1);
    expect(mic.store.getState().status).toBe('off');
  });

  it('follows the sensitivity the player sets, and keeps it', async () => {
    const { world, deps, storage } = fakeBrowser();
    const mic = createMic(deps);
    const heard: boolean[] = [];
    mic.start((speaking) => heard.push(speaking));
    await vi.advanceTimersByTimeAsync(0);

    world.amplitude = 0.003; // about -50 dBFS: under the default -45
    await vi.advanceTimersByTimeAsync(GATE.readEveryMs);
    expect(heard).toEqual([]);

    mic.setSensitivity(80);
    await vi.advanceTimersByTimeAsync(GATE.readEveryMs);
    expect(heard).toEqual([true]);
    expect(loadMicSettings(() => storage).sensitivity).toBe(80);
  });

  it('lets go of the mic when muted, and opens it again when unmuted', async () => {
    const { world, deps, storage } = fakeBrowser();
    const mic = createMic(deps);
    const heard: boolean[] = [];
    mic.start((speaking) => heard.push(speaking));
    await vi.advanceTimersByTimeAsync(0);
    world.amplitude = 0.1;
    await vi.advanceTimersByTimeAsync(GATE.readEveryMs);

    mic.setMuted(true);
    expect(heard).toEqual([true, false]);
    expect(mic.store.getState().status).toBe('muted');
    expect(world.stopped).toBe(1);
    await vi.advanceTimersByTimeAsync(GATE.readEveryMs * 4);
    expect(heard).toEqual([true, false]);
    expect(loadMicSettings(() => storage).muted).toBe(true);

    mic.setMuted(false);
    await vi.advanceTimersByTimeAsync(GATE.readEveryMs);
    expect(world.asked).toBe(2);
    expect(mic.store.getState().status).toBe('on');
    expect(heard).toEqual([true, false, true]);
  });

  it('doesn’t ask for a mic the player left muted last time', async () => {
    const { world, deps, storage } = fakeBrowser();
    saveMicSettings({ muted: true, sensitivity: 50 }, () => storage);
    const mic = createMic(deps);

    mic.start(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(world.asked).toBe(0);
    expect(mic.store.getState().status).toBe('muted');
  });

  it('says when the browser refuses the mic, or has none', async () => {
    const refused = fakeBrowser();
    refused.world.refuse = new DOMException('Permission denied', 'NotAllowedError');
    const blocked = createMic(refused.deps);
    blocked.start(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(blocked.store.getState().status).toBe('blocked');

    const missing = fakeBrowser();
    missing.world.refuse = new DOMException('Requested device not found', 'NotFoundError');
    const none = createMic(missing.deps);
    none.start(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(none.store.getState().status).toBe('unavailable');

    const old = createMic({ ...fakeBrowser().deps, getUserMedia: undefined });
    old.start(() => undefined);
    expect(old.store.getState().status).toBe('unavailable');
  });

  it('wakes audio the browser started suspended at the first press', async () => {
    const { world, deps, target } = fakeBrowser();
    world.state = 'suspended';
    const mic = createMic(deps);
    const stop = mic.start(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(world.resumed).toBe(1);

    target.dispatchEvent(new Event('pointerdown'));
    expect(world.resumed).toBe(2);
    stop();
    target.dispatchEvent(new Event('keydown'));
    expect(world.resumed).toBe(2);
  });

  it('lets go of a mic granted after the table was left', async () => {
    const { world, deps } = fakeBrowser();
    const mic = createMic(deps);
    const stop = mic.start(() => undefined);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(world.stopped).toBe(1);
    expect(mic.store.getState().status).toBe('off');
  });
});
