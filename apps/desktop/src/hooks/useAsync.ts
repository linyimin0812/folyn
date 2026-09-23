import { useEffect, useState } from 'react';

/**
 * Generic async load with cancellation (hook-guidelines.md: useEffect +
 * useState, no React Query). `deps` re-fire the fetch; failures log and
 * resolve to null so the caller renders its empty state.
 */
export function useAsync<T>(run: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  loading: boolean;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    run()
      .then((v) => {
        if (!cancelled) {
          setData(v);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn('[activity] query failed:', err);
        if (!cancelled) {
          setData(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps IS the contract
  }, deps);
  return { data, loading };
}
