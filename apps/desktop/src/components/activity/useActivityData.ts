/**
 * Data-fetching hooks for the activity page. No React Query (per
 * hook-guidelines.md) — `useEffect` + `useState` with cancellation, keyed on
 * explicit deps so a new period/vault refetches.
 */

import { useEffect, useMemo, useState } from 'react';
import { useVaultStore } from '@/store/vaultStore';
import { resolveVaultRoot } from '@/services/activity/api';
import { useCollectorRegistryStore } from '@/services/activity/registry';
import { getCollectorSettings, useActivityCollectorStore } from '@/store/activityCollectorStore';

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

/** Collector ids whose events stay visible: registered collectors the user
 *  hasn't disabled. Feeds the read paths' `sources` include-list — disabling a
 *  collector hides its already-collected events, metrics, digest and graph
 *  edges. Sources missing from the registry (uninstalled collectors) are
 *  hidden as well; empty array = show nothing from any collector. */
export function useEnabledSources(): string[] {
  const registered = useCollectorRegistryStore((s) => s.collectors);
  const settings = useActivityCollectorStore((s) => s.collectors);
  return useMemo(
    () =>
      registered
        .filter((c) => getCollectorSettings({ collectors: settings }, c.collectorId).enabled)
        .map((c) => c.collectorId),
    [registered, settings],
  );
}
