import { storageClient } from '@/utils/storageClient';
import { debounce } from '@/utils/debounce';

// ponytail: This module owns the single-writer debounced persist + the store
// slice registry. It deliberately imports NOTHING from any store — stores
// register their slices via registerPersistSlice(). This breaks the cycle
// (store → settingsPersistence → store) that a top-level import would create:
// each store imports schedulePersist (a hoisted function binding) at module
// load, and settingsPersistence learns each store's getState via registration
// at that store's module init. navStore is never registered (runtime-only).

const SETTINGS_STORAGE_KEY = 'settings:all';

export interface PersistSlice {
  keys: readonly string[];
  getState: () => Record<string, unknown>;
  /** Optional: hydrate this store's slice from the persisted blob. Stores
   *  that own migration logic (petStore, prefsStore, appearanceStore,
   *  scheduleStore.boardColumns) implement this; the loader calls it. */
  hydrate?: (blob: Record<string, unknown>) => void;
}

const SLICES: PersistSlice[] = [];

/** Register a store's persisted slice. Called at module init by each
 *  persisted store. Order is irrelevant for correctness (each slice only
 *  reads its own keys from the blob), but a stable registration order makes
 *  the on-disk blob deterministic. */
export function registerPersistSlice(slice: PersistSlice): void {
  if (!SLICES.includes(slice)) SLICES.push(slice);
}

/** Merge every registered slice's keys into a single blob. The union MUST
 *  equal the legacy PERSIST_KEYS allowlist (field-for-field) so a
 *  `settings:all` blob written by the old code round-trips through the new
 *  loader and vice versa. Single writer — schedulePersist is the only path
 *  that writes the blob, matching the legacy debouncedPersist contract. */
function collectPersistedBlob(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const slice of SLICES) {
    const state = slice.getState();
    for (const key of slice.keys) {
      if (key in state) out[key] = state[key as keyof typeof state];
    }
  }
  return out;
}

/** Debounced persist — single writer, 300ms trailing edge. Matches the
 *  legacy settingsStore `debouncedPersist` (same delay, same single-writer
 *  contract, same storageClient.set call shape). After the write lands,
 *  emits `pet://settings-updated` with the blob as payload so secondary
 *  Tauri windows (pet-corner, pet-bubble, pet-panel) — which hold their
 *  own store instances and don't see in-memory `set()` calls from the
 *  main window, and which lack fs-plugin ACL perms to re-read storage.json
 *  themselves — can hydrate directly from the payload. */
const debouncedPersist = debounce(() => {
  const blob = collectPersistedBlob();
  void storageClient.set(SETTINGS_STORAGE_KEY, blob);
  void (async () => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://settings-updated', blob);
    } catch {
      // Non-tauri (tests) or emit failed — non-fatal.
    }
  })();
}, 300);

/** Called by every persisted store's setter to schedule a debounced write.
 *  Tracing the legacy behavior: each old setter called
 *  `debouncedPersist(useSettingsStore.getState())` which re-picked the whole
 *  PERSIST_KEYS allowlist; here we re-collect from every registered slice
 *  instead, but the on-disk blob is identical. */
export function schedulePersist(): void {
  debouncedPersist();
}

/** Dispatch a persisted blob to every registered slice's hydrate. Exported so
 *  tests can hydrate from an in-memory blob without touching storageClient.
 *  navStore is never registered, so it is skipped (runtime-only). */
export function hydrateAllStores(blob: Record<string, unknown>): void {
  for (const slice of SLICES) {
    slice.hydrate?.(blob);
  }
}

/** On startup, read the single `settings:all` blob and dispatch each store's
 *  slice to its own `hydrate`. navStore is skipped (runtime-only). Returns
 *  the raw blob (or null) so callers can inspect it. */
export async function loadSettings(): Promise<Record<string, unknown> | null> {
  const blob = await storageClient.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY);
  if (!blob) return null;
  hydrateAllStores(blob);
  // Broadcast to secondary Tauri windows (pet-bubble / pet-corner /
  // pet-panel) which hold their own store instances but lack fs-plugin ACL
  // perms to re-read storage.json themselves. Without this, the bubble
  // window's petStore stays at defaults (petSize='100') on startup —
  // `computeBubblePosition` then sizes the gap against the wrong pet
  // footprint, and larger pets ('125' / '150') get the bubble window's top
  // inside the pet window → pet occludes the bubble on `bottom` placement.
  // The same `pet://settings-updated` channel is also emitted by
  // `debouncedPersist` on every setter, so subsequent changes propagate.
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://settings-updated', blob);
  } catch {
    // Non-tauri (tests) or emit failed — non-fatal.
  }
  return blob;
}

// ponytail: eager-load promise is the single await point for "is hydration
// done yet?". Callers that read persisted state at startup (e.g. the pet-icon
// orphan sweep in usePetHostBridge) MUST await this before touching the store
// — otherwise they read default state and clobber the persisted value.
export const settingsLoadDone: Promise<void> = loadSettings().then(() => undefined, () => undefined);

// ponytail: `settingsLoadDone` (above) is the single eager-load entry — a
// top-level const starts the promise at module import. The pre-split
// settingsStore did the same with `storageClient.get(...).then(...)` at module
// bottom. Errors are swallowed — a missing blob is the normal first-launch
// case.
