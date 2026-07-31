import { storageClient } from '@/utils/storageClient';
import { debounce } from '@/utils/debounce';

// ponytail: This module owns the single-writer debounced persist + the store
// slice registry. It deliberately imports NOTHING from any store — stores
// register their slices via registerPersistSlice(). This breaks the cycle
// (store → settingsPersistence → store) that a top-level import would create:
// each store imports schedulePersist (a hoisted function binding) at module
// load, and settingsPersistence learns each store's getState via registration
// at that store's module init. navStore is never registered (runtime-only).

export interface PersistSlice {
  /** Filename stem under ~/.quill/storage/. Must be filename-safe
   *  (storageClient sanitizes anyway, but slices use clean stems like
   *  'prefs', 'editorPrefs', 'pet'). */
  name: string;
  keys: readonly string[];
  getState: () => Record<string, unknown>;
  /** Optional: hydrate this store's slice from its persisted data. Stores
   *  that own migration logic (petStore, prefsStore, appearanceStore,
   *  scheduleStore.boardColumns) implement this; the loader calls it. */
  hydrate?: (blob: Record<string, unknown>) => void;
}

const SLICES: PersistSlice[] = [];

/** Register a store's persisted slice. Called at module init by each
 *  persisted store. Order is irrelevant for correctness (each slice only
 *  reads its own keys), but a stable registration order keeps the on-disk
 *  file set deterministic. */
export function registerPersistSlice(slice: PersistSlice): void {
  if (!SLICES.includes(slice)) SLICES.push(slice);
}

/** Pick a slice's persisted keys from its current state. */
function pickSliceData(slice: PersistSlice): Record<string, unknown> {
  const state = slice.getState();
  const out: Record<string, unknown> = {};
  for (const key of slice.keys) {
    if (key in state) out[key] = state[key as keyof typeof state];
  }
  return out;
}

/** Merge every registered slice's keys into a single blob. Used only to
 *  assemble the `pet://settings-updated` payload — on disk, each slice
 *  writes its own file. Secondary Tauri windows (pet-corner, pet-bubble,
 *  pet-panel) lack fs-plugin ACL perms to re-read ~/.quill/storage/ files
 *  themselves, so they hydrate from the broadcast blob instead. */
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

/** Debounced persist — single writer, 300ms trailing edge. Writes each
 *  slice to its own file via storageClient.set(slice.name, sliceData), then
 *  emits `pet://settings-updated` with the whole merged blob so secondary
 *  Tauri windows (which hold their own store instances and don't see the
 *  main window's in-memory set() calls, and which lack fs-plugin ACL perms
 *  to re-read the storage files themselves) can hydrate directly from the
 *  payload. */
const debouncedPersist = debounce(() => {
  for (const slice of SLICES) {
    const data = pickSliceData(slice);
    void storageClient.set(slice.name, data);
  }
  const blob = collectPersistedBlob();
  void (async () => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://settings-updated', blob);
    } catch {
      // Non-tauri (tests) or emit failed — non-fatal.
    }
  })();
}, 300);

/** Called by every persisted store's setter to schedule a debounced write. */
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

/** On startup, read each slice's file and dispatch to its own `hydrate`,
 *  then assemble the merged blob for the secondary-window broadcast.
 *  Provider config lives in ~/.quill/providers/ — load from disk AFTER the
 *  per-slice hydrate so chatProvider is already set when we read the
 *  matching slot into the flat mirrors. Lazy import breaks the store→
 *  settingsPersistence→store cycle (aiConfigStore imports schedulePersist
 *  at module load; this module importing aiConfigStore at top would
 *  create the cycle). Returns the merged blob (or null) so callers can
 *  inspect it.
 *
 *  ponytail: the `await import('./aiConfigStore')` MUST come BEFORE the
 *  slice-hydration loop. `settingsLoadDone` at the bottom of this file is
 *  started eagerly at module init — which runs DURING settingsPersistence's
 *  own evaluation, before any store has called registerPersistSlice (SLICES
 *  is still []). The `await import` yields long enough for the App's import
 *  graph to resolve and all slices to register; without it, the for-loop
 *  runs 0 iterations and nothing gets hydrated (regression observed when
 *  this loop was placed before the await — user-hidden folders reappeared
 *  on restart because excludePatterns never loaded). */
export async function loadSettings(): Promise<Record<string, unknown> | null> {
  try {
    const { useAiConfigStore } = await import('./aiConfigStore');
    await useAiConfigStore.getState().loadFromDisk();
  } catch (err) {
    console.warn('[settingsPersistence] Provider config load failed:', err);
  }

  const blob: Record<string, unknown> = {};
  let any = false;
  for (const slice of SLICES) {
    const data = await storageClient.get<Record<string, unknown>>(slice.name);
    if (data) {
      any = true;
      slice.hydrate?.(data);
      for (const k of Object.keys(data)) blob[k] = data[k];
    }
  }
  if (!any) return null;
  // Broadcast to secondary Tauri windows (pet-bubble / pet-corner /
  // pet-panel) which hold their own store instances but lack fs-plugin ACL
  // perms to re-read ~/.quill/storage/ files themselves. Without this, the
  // bubble window's petStore stays at defaults (petSize='100') on startup —
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
