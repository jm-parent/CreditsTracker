import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCreditChanges } from './useCreditChanges';

describe('useCreditChanges', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('tracks transient credit deltas and clears them after the duration', () => {
    vi.useFakeTimers();

    const initial = { rows: [{ key: 'a', value: 10 }] };
    const { result, rerender } = renderHook(
      ({ snapshot, values, resetKey }) => useCreditChanges(snapshot, values, resetKey, 1_500),
      {
        initialProps: {
          snapshot: initial,
          values: initial.rows,
          resetKey: 'all-projects',
        },
      },
    );

    expect(result.current.size).toBe(0);

    const increased = { rows: [{ key: 'a', value: 12.5 }] };
    rerender({
      snapshot: increased,
      values: increased.rows,
      resetKey: 'all-projects',
    });
    expect(result.current.get('a')?.delta).toBe(2.5);

    act(() => vi.advanceTimersByTime(1_500));
    expect(result.current.size).toBe(0);

    const corrected = { rows: [{ key: 'a', value: 11 }] };
    rerender({
      snapshot: corrected,
      values: corrected.rows,
      resetKey: 'all-projects',
    });
    expect(result.current.get('a')?.delta).toBe(-1.5);
  });

  it('waits for a fresh snapshot after the reset key changes', () => {
    vi.useFakeTimers();

    const initial = { rows: [{ key: 'a', value: 10 }] };
    const { result, rerender } = renderHook(
      ({ snapshot, values, resetKey }) => useCreditChanges(snapshot, values, resetKey, 1_500),
      {
        initialProps: {
          snapshot: initial,
          values: initial.rows,
          resetKey: 'all-projects',
        },
      },
    );

    const increased = { rows: [{ key: 'a', value: 12 }] };
    rerender({
      snapshot: increased,
      values: increased.rows,
      resetKey: 'all-projects',
    });
    expect(result.current.get('a')?.delta).toBe(2);

    const staleResetSnapshot = increased;
    rerender({
      snapshot: staleResetSnapshot,
      values: staleResetSnapshot.rows,
      resetKey: 'workspace',
    });
    expect(result.current.size).toBe(0);

    const freshBaseline = { rows: [{ key: 'a', value: 13 }] };
    rerender({
      snapshot: freshBaseline,
      values: freshBaseline.rows,
      resetKey: 'workspace',
    });
    expect(result.current.size).toBe(0);

    const freshIncrease = { rows: [{ key: 'a', value: 14 }] };
    rerender({
      snapshot: freshIncrease,
      values: freshIncrease.rows,
      resetKey: 'workspace',
    });
    expect(result.current.get('a')?.delta).toBe(1);
  });

  it('keeps the pending expiration running when an unchanged snapshot arrives', () => {
    vi.useFakeTimers();

    const initial = { rows: [{ key: 'a', value: 10 }] };
    const { result, rerender } = renderHook(
      ({ snapshot, values, resetKey }) => useCreditChanges(snapshot, values, resetKey, 1_500),
      {
        initialProps: {
          snapshot: initial,
          values: initial.rows,
          resetKey: 'all-projects',
        },
      },
    );

    const increased = { rows: [{ key: 'a', value: 12 }] };
    rerender({
      snapshot: increased,
      values: increased.rows,
      resetKey: 'all-projects',
    });
    expect(result.current.get('a')?.delta).toBe(2);

    act(() => vi.advanceTimersByTime(1_000));

    // A poll that returns the same value must neither restart nor cancel the
    // running expiration.
    const unchangedRefresh = { rows: [{ key: 'a', value: 12 }] };
    rerender({
      snapshot: unchangedRefresh,
      values: unchangedRefresh.rows,
      resetKey: 'all-projects',
    });
    expect(result.current.get('a')?.delta).toBe(2);

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.size).toBe(0);
  });

  it('replaces the displayed delta on successive updates and increments animationKey', () => {
    vi.useFakeTimers();

    const initial = { rows: [{ key: 'a', value: 10 }] };
    const { result, rerender } = renderHook(
      ({ snapshot, values, resetKey }) => useCreditChanges(snapshot, values, resetKey, 1_500),
      {
        initialProps: {
          snapshot: initial,
          values: initial.rows,
          resetKey: 'all-projects',
        },
      },
    );

    const firstUpdate = { rows: [{ key: 'a', value: 12 }] };
    rerender({
      snapshot: firstUpdate,
      values: firstUpdate.rows,
      resetKey: 'all-projects',
    });
    const firstAnimationKey = result.current.get('a')?.animationKey;
    expect(result.current.get('a')?.delta).toBe(2);

    const secondUpdate = { rows: [{ key: 'a', value: 13 }] };
    rerender({
      snapshot: secondUpdate,
      values: secondUpdate.rows,
      resetKey: 'all-projects',
    });

    expect(result.current.get('a')?.delta).toBe(1);
    expect(result.current.get('a')?.animationKey).toBe((firstAnimationKey ?? 0) + 1);
  });

  it('clears the pending timer when unmounted', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const initial = { rows: [{ key: 'a', value: 10 }] };
    const { rerender, unmount } = renderHook(
      ({ snapshot, values, resetKey }) => useCreditChanges(snapshot, values, resetKey, 1_500),
      {
        initialProps: {
          snapshot: initial,
          values: initial.rows,
          resetKey: 'all-projects',
        },
      },
    );

    const increased = { rows: [{ key: 'a', value: 12 }] };
    rerender({
      snapshot: increased,
      values: increased.rows,
      resetKey: 'all-projects',
    });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
