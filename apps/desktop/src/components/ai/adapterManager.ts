import { createAdapter, type CliAdapter } from '@folyn/cli-adapter';
import { useAiConfigStore, getFeatureAdapter } from '@/store/aiConfigStore';

export const sessionAdapters = new Map<string, CliAdapter>();

/** Resolve the adapter for a session. When `feature` is provided (e.g.
 *  `'wiki'`), the per-feature override `featureCliAdapter[feature]` takes
 *  precedence over the global `cliAdapter` — see getFeatureAdapter. The
 *  cached adapter in `sessionAdapters` is keyed by sessionId alone; a
 *  mismatching adapter id invalidates the cache and re-creates the adapter
 *  so a runtime switch of the feature's adapter takes effect on the next
 *  call. */
export function getAdapterForSession(sessionId: string, feature?: string): CliAdapter {
  const adapterId = feature
    ? getFeatureAdapter(feature)
    : useAiConfigStore.getState().cliAdapter;
  const existing = sessionAdapters.get(sessionId);
  if (existing && existing.id === adapterId) return existing;
  const adapter = createAdapter(adapterId);
  sessionAdapters.set(sessionId, adapter);
  return adapter;
}
