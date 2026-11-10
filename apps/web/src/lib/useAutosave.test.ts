import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergePatch, useAutosave } from './useAutosave';

describe('mergePatch', () => {
  it('replaces top-level keys and merges fields, keeping nulls', () => {
    expect(
      mergePatch(
        { name: 'A', fields: { status: 'alive', appearance: null } },
        { tags: ['x'], fields: { status: 'dead' } },
      ),
    ).toEqual({ name: 'A', tags: ['x'], fields: { status: 'dead', appearance: null } });
  });

  it('never adds a fields key when neither side has one', () => {
    expect(mergePatch({ name: 'A' }, { tags: [] })).toEqual({ name: 'A', tags: [] });
  });
});

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const tick = (ms = 0) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('sends the merged patch after the pause', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(send, 100));

    act(() => {
      result.current.save({ name: 'A' });
      result.current.save({ fields: { status: 'dead' } });
    });
    expect(result.current.status).toBe('saving');
    expect(send).not.toHaveBeenCalled();

    await tick(100);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      { name: 'A', fields: { status: 'dead' } },
      { keepalive: false },
    );
    expect(result.current.status).toBe('saved');
  });

  it('sends one request at a time, in order', async () => {
    let finishFirst: () => void = () => undefined;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(send, 100));

    act(() => {
      result.current.save({ name: 'A' });
      result.current.flush();
    });
    act(() => {
      result.current.save({ name: 'B' });
      result.current.flush();
    });
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saving');

    finishFirst();
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual({ name: 'B' });
    expect(result.current.status).toBe('saved');
  });

  it('keeps a failed patch under newer edits and retries it', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(send, 100));

    act(() => {
      result.current.save({ fields: { appearance: 'Tall' } });
      result.current.flush();
    });
    await tick();
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('boom');

    act(() => {
      result.current.save({ fields: { status: 'dead' } });
    });
    expect(result.current.status).toBe('error');
    act(() => {
      result.current.flush();
    });
    await tick();
    expect(send).toHaveBeenLastCalledWith(
      { fields: { appearance: 'Tall', status: 'dead' } },
      { keepalive: false },
    );
    expect(result.current.status).toBe('saved');
  });

  it('flushes on unmount and drops what was discarded', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const first = renderHook(() => useAutosave(send, 100));
    act(() => {
      first.result.current.save({ name: 'A' });
    });
    first.unmount();
    await tick();
    expect(send).toHaveBeenCalledWith({ name: 'A' }, { keepalive: false });

    const second = renderHook(() => useAutosave(send, 100));
    act(() => {
      second.result.current.save({ name: 'B' });
      second.result.current.discard();
    });
    expect(second.result.current.isDirty()).toBe(false);
    await tick(100);
    second.unmount();
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
