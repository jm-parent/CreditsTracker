import { useCallback, useEffect, useRef, useState } from 'react';

export interface CreditDatum {
  key: string;
  value: number;
}

export interface CreditChange {
  delta: number;
  animationKey: number;
}

const NO_CHANGES: ReadonlyMap<string, CreditChange> = new Map();

function toValueMap(values: readonly CreditDatum[]): ReadonlyMap<string, number> {
  return new Map(values.map(({ key, value }) => [key, value] as const));
}

/**
 * Tracks keyed numeric changes between successful snapshots.
 *
 * `snapshot` must be the identity of the successful response that produced
 * `values`, or `null` while no successful response has been rendered yet in
 * the current context.
 */
export function useCreditChanges(
  snapshot: object | null,
  values: readonly CreditDatum[],
  resetKey: string,
  durationMs: number,
): ReadonlyMap<string, CreditChange> {
  const previousValuesRef = useRef<ReadonlyMap<string, number> | null>(null);
  const previousSnapshotRef = useRef<object | null>(null);
  const resetKeyRef = useRef(resetKey);
  const awaitingFreshSnapshotRef = useRef(false);
  const animationKeyRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [changes, setChanges] = useState<ReadonlyMap<string, CreditChange>>(NO_CHANGES);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Only unmounting cancels a pending expiration. The comparison effect below
  // deliberately returns no cleanup: a snapshot that arrives while a marker is
  // displayed must not silently cancel the timer that removes it.
  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    const nextValues = toValueMap(values);

    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      clearTimer();
      setChanges(NO_CHANGES);

      if (snapshot !== null && previousSnapshotRef.current === snapshot) {
        // The rendered snapshot still belongs to the previous context, so wait
        // for the first successful response of the new one before comparing.
        awaitingFreshSnapshotRef.current = true;
        previousValuesRef.current = null;
        return;
      }

      // A different response arrived with the new context: baseline it without
      // animating.
      previousSnapshotRef.current = snapshot;
      previousValuesRef.current = snapshot === null ? null : nextValues;
      awaitingFreshSnapshotRef.current = false;
      return;
    }

    if (snapshot === null) {
      // Nothing has loaded successfully yet, so there is no baseline to keep.
      return;
    }

    if (previousSnapshotRef.current === null) {
      previousSnapshotRef.current = snapshot;
      previousValuesRef.current = nextValues;
      awaitingFreshSnapshotRef.current = false;
      return;
    }

    if (previousSnapshotRef.current === snapshot) {
      // The same successful response re-rendered; keep any pending expiration.
      return;
    }

    if (awaitingFreshSnapshotRef.current) {
      previousSnapshotRef.current = snapshot;
      previousValuesRef.current = nextValues;
      awaitingFreshSnapshotRef.current = false;
      clearTimer();
      setChanges(NO_CHANGES);
      return;
    }

    const previousValues = previousValuesRef.current;
    previousSnapshotRef.current = snapshot;
    previousValuesRef.current = nextValues;

    if (previousValues === null) {
      return;
    }

    const nextAnimationKey = animationKeyRef.current + 1;
    const nextChanges = new Map<string, CreditChange>();

    for (const { key, value } of values) {
      const previousValue = previousValues.get(key);
      if (previousValue === undefined || Object.is(previousValue, value)) {
        continue;
      }

      const delta = value - previousValue;
      if (!Number.isFinite(delta) || delta === 0) {
        continue;
      }

      nextChanges.set(key, {
        delta,
        animationKey: nextAnimationKey,
      });
    }

    if (nextChanges.size === 0) {
      // An unchanged refresh is not an update: leave the currently displayed
      // markers and their pending expiration untouched.
      return;
    }

    animationKeyRef.current = nextAnimationKey;
    clearTimer();
    setChanges(nextChanges);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setChanges(NO_CHANGES);
    }, durationMs);
  }, [snapshot, resetKey, durationMs, clearTimer]);

  return changes;
}
