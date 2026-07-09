/** Trailing-edge debounce: each call resets the timer; fn fires ms after the
 *  last call. Returns the debounced fn (callable) plus a `.cancel()` that
 *  clears the pending timer. The closure holds the only timer reference. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = ((...args: A): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as ((...args: A) => void) & { cancel: () => void };
  debounced.cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

/** Per-key trailing-edge debounce. `schedule(key, fn)` fires fn ms after the
 *  last call for that key (trailing edge); each key tracks its own timer.
 *  `clearAll()` cancels every pending timer and returns the keys that were
 *  pending (caller runs their own fn over the keys, e.g. flush-on-unmount). */
export function debounceByKey<K>(
  ms: number,
): {
  schedule: (key: K, fn: () => void) => void;
  clearAll: () => K[];
} {
  const timers = new Map<K, ReturnType<typeof setTimeout>>();
  return {
    schedule(key: K, fn: () => void): void {
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          fn();
        }, ms),
      );
    },
    clearAll(): K[] {
      const keys = [...timers.keys()];
      for (const [, timer] of timers) clearTimeout(timer);
      timers.clear();
      return keys;
    },
  };
}
