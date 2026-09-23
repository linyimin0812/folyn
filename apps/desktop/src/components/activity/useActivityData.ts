/**
 * Data-fetching hooks for the activity page. No React Query (per
 * hook-guidelines.md) — `useEffect` + `useState` with cancellation, keyed on
 * explicit deps so a new period/vault refetches.
 */

import { useEffect, useState } from 'react';
import { useVaultStore } from '@/store/vaultStore';
import { resolveVaultRoot } from '@/services/activity/api';

export { useAsync } from '@/hooks/useAsync';

/** Resolved activity db root ('' when no vault is open). */
export function useVaultRoot(): string {
  const currentVault = useVaultStore((s) => s.currentVault);
  const [root, setRoot] = useState('');
  useEffect(() => {
    let cancelled = false;
    void resolveVaultRoot().then((r) => {
      if (!cancelled) setRoot(r);
    });
    return () => {
      cancelled = true;
    };
  }, [currentVault]);
  return root;
}
