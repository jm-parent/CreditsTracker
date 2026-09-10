import { useEffect, useRef, useState } from 'react';

export interface CreditDatum {
  key: string;
  value: number;
}

export interface CreditChange {
  delta: number;
  animationKey: number;
}

function toValueMap(values: readonly CreditDatum[]): ReadonlyMap<string, number> {
  return new Map(values.map(({ key, value }) => [key, value] as const));
}

export function useCreditChanges(
  snapshot: object,
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
  const [changes, setChanges] = useState<ReadonlyMap<string, CreditChange>>(new Map());

  useEffect(() => {
    const clearTimer = (): void => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const nextValues = toValueMap(values);

    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      awaitingFreshSnapshotRef.current = true;
      previousSnapshotRef.current = snapshot;
      previousValuesRef.current = null;
      clearTimer();
      setChanges(new Map());
      return clearTimer;
    }

    if (previousSnapshotRef.current === null) {
      previousSnapshotRef.current = snapshot;
      previousValuesRef.current = nextValues;
      awaitingFreshSnapshotRef.current = false;
      return clearTimer;
    }

    if (awaitingFreshSnapshotRef.current) {
      if (previousSnapshotRef.current === snapshot) {
        return clearTimer;
      }

      previousSnapshotRef.current = snapshot;
      previousValuesRef.current = nextValues;
      awaitingFreshSnapshotRef.current = false;
      clearTimer();
      setChanges(new Map());
      return clearTimer;
    }

    const previousValues = previousValuesRef.current;
    previousSnapshotRef.current = snapshot;
    previousValuesRef.current = nextValues;

    if (previousValues === null) {
      return clearTimer;
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
      return clearTimer;
    }

    animationKeyRef.current = nextAnimationKey;
    clearTimer();
    setChanges(nextChanges);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setChanges(new Map());
    }, durationMs);

    return clearTimer;
  }, [snapshot, resetKey, durationMs]);

  return changes;
}
