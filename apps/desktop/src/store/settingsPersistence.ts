import { storageClient } from '@/utils/storageClient';
import { debounce } from '@/utils/debounce';

// ponytail: This module owns the single-writer persist + the store slice
// registry. It deliberately imports NOTHING from any store — stores
// register their slices via registerPersistSlice(), which returns a bound
// persist closure the store captures. This breaks the cycle
// (store → settingsPersistence → store) that a top-level import would
// create: each store imports registerPersistSlice at module load, and
// settingsPersistence learns each store's getState via registration at
// that store's module init. navStore is never registered (runtime-only).

export interface PersistSlice {
  /** Filename stem under ~/.mochi/storage/. Must be filename-safe
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

// ponytail: hydration gate for the per-setter persist closures. The store
// defaults are the pre-hydration state; any setter that fires in that window
// (e.g. the pet://visibility-changed sync during launch, before loadSettings
// finishes) would otherwise write the DEFAULT slice over the real persisted
// data — and loadSettings would then hydrate FROM that poisoned cache, so
// the user's saved settings (pet icon library, appearance, …) are lost on
// every restart. loadSettings() flips this on once every slice has hydrated;
// persist() / persistNow() no-op until then. See 634123f / f33ad53 / the
// pet-icon-restart PRD for the incident history.
let hydrationDone = false;

/** Called by loadSettings() once every registered slice has hydrated.
 *  Also exported so store tests can model the app lifecycle (hydration
 *  completes before user setters run). Idempotent. */
export function markSettingsHydrated(): void {
  hydrationDone = true;
}

/** Test-only: reset the hydration gate so a test can exercise the
 *  pre-hydration persist-blocking path. Mirrors
 *  `storageClient.__resetForTesting()`. */
export function __resetSettingsHydrationForTesting(): void {
  hydrationDone = false;
}

// ponytail: debounced broadcast — every per-setter persist schedules it, the
// trailing edge emits one `pet://settings-updated` carrying the merged blob.
// Mirrors storageClient's 300ms debounce (FLUSH_DELAY not exported; hardcode
// + comment names the coupling). Without this, secondary Tauri windows
// (pet-panel / pet-bubble / pet-corner) hold their own store instances and
// only see writes on quit / startup — so e.g. the Inbox tab stays empty
// after a curl notification lands in the main window's petStore.
const BROADCAST_DELAY = 300;
function broadcastSettingsImpl(): void {
  void (async () => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://settings-updated', collectPersistedBlob());
    } catch {
      // Non-tauri (tests) or emit failed — non-fatal.
    }
  })();
}
const scheduleBroadcast = debounce(broadcastSettingsImpl, BROADCAST_DELAY);

// ponytail: expected slice names — every persisted store must register. We
// don't gate loadSettings on these (the original `await import` was just a
// microtask yield that happened to let App.tsx's static imports finish
// evaluating); we only warn if a slice is missing at hydrate time so the
// next "settings disappeared on restart" bug surfaces a clear log line
// instead of silent data loss. New persisted store? Add its name here.
const EXPECTED_SLICES = [
  'prefs', 'editorPrefs', 'pet', 'appearance', 'voice',
  'vault', 'schedule', 'modelRegistry', 'aiConfig', 'csp', 'storage',
  'translation',
] as const;

/** Register a store's persisted slice. Called at module init by each
 *  persisted store. Returns a `persist` closure bound to this slice —
 *  setters call it to write ONLY this slice's file. Order is irrelevant for
 *  correctness (each slice only reads its own keys), but a stable
 *  registration order keeps the on-disk file set deterministic. */
export function registerPersistSlice(slice: PersistSlice): () => void {
  if (!SLICES.includes(slice)) SLICES.push(slice);
  return () => {
    // Pre-hydration writes are default-state noise that would clobber the
    // persisted file AND poison the storageClient cache that loadSettings
    // hydrates from — skip them entirely.
    if (!hydrationDone) return;
    void storageClient.set(slice.name, pickSliceData(slice));
    scheduleBroadcast();
  };
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
 *  pet-panel) lack fs-plugin ACL perms to re-read ~/.mochi/storage/ files
 *  themselves, so they hydrate from the broadcast blob instead. */
/** Merge every registered slice's keys into a single blob. Used to assemble
 *  the `pet://settings-updated` broadcast payload and to answer
 *  `pet://settings-request` from secondary windows. On disk, each slice
 *  writes its own file; the merged blob is only for cross-window sync. */
export function collectPersistedBlob(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const slice of SLICES) {
    const state = slice.getState();
    for (const key of slice.keys) {
      if (key in state) out[key] = state[key as keyof typeof state];
    }
  }
  return out;
}

/** Synchronous flush: cancel pending debounce + write every slice to disk
 *  now. Awaited by App.tsx onCloseRequested and petHostRouter exit-app so
 *  a quit within the 300ms debounce window does not lose the last setter's
 *  write. Also broadcasts the merged blob to secondary Tauri windows so
 *  their in-memory stores don't lose the last change either.
 *  ponytail: writes ALL slices on quit, not just dirty ones — this is the
 *  safety net path, not the hot path. Per-setter writes (via the closure
 *  returned by registerPersistSlice) already wrote each slice's own file;
 *  this re-writes everything as a belt-and-suspenders flush in case a
 *  setter's debounced write was cancelled by the quit race. Per-slice dirty
 *  tracking would shrink this to one file, but the cost is state to track +
 *  reset; storageClient's own debounce already coalesces, so we accept the
 *  redundant writes here. */
export async function persistNow(): Promise<void> {
  if (!hydrationDone) return;
  scheduleBroadcast.cancel();
  for (const slice of SLICES) {
    await storageClient.set(slice.name, pickSliceData(slice));
  }
  await storageClient.flushNow();
  const blob = collectPersistedBlob();
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://settings-updated', blob);
  } catch {
    // Non-tauri (tests) or emit failed — non-fatal.
  }
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
 *  Provider config lives in ~/.mochi/providers/ — load from disk AFTER the
 *  per-slice hydrate so chatProvider is already set when we read the
 *  matching slot into the flat mirrors. Lazy import breaks the store→
 *  settingsPersistence→store cycle (aiConfigStore imports
 *  registerPersistSlice at module load; this module importing aiConfigStore
 *  at top would create the cycle). Returns the merged blob (or null) so
 *  callers can inspect it. */
export async function loadSettings(): Promise<Record<string, unknown> | null> {
  // Yield one microtask so App.tsx's static imports finish evaluating and
  // every persisted store has called registerPersistSlice. This is a safety
  // net for DIRECT callers (tests, persistNow, etc.) — the canonical
  // settingsLoadDone promise is now a deferred promise resolved by App.tsx
  // from a useEffect, so the module-graph race is handled at the call site,
  // not here.
  await Promise.resolve();
  const missing = EXPECTED_SLICES.filter(
    (n) => !SLICES.some((s) => s.name === n),
  );
  if (missing.length > 0) {
    console.warn(
      '[settingsPersistence] hydrate loop starting with unregistered slices:',
      missing,
      '— their persisted state will be skipped this launch.',
    );
  }

  // ponytail: hydrate per-slice blobs FIRST so chatProvider / etc. are
  // restored from the aiConfig blob before loadFromDisk reads
  // get().chatProvider. Without this, loadFromDisk runs against the
  // default chatProvider='anthropic', seeds anthropic's base URL into
  // chatBaseUrl, and never re-derives the flat mirrors after hydrate
  // sets chatProvider='deepseek' — so the settings UI shows
  // https://api.anthropic.com + empty apiKey even though the deepseek
  // slot on disk has the right values.
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
  // Hydration of the registered slices is done — unblock persist(). Placed
  // BEFORE the aiConfig/loadFromDisk step below so that step's own setters
  // persist exactly as they did before the gate existed.
  markSettingsHydrated();

  try {
    const { useAiConfigStore } = await import('./aiConfigStore');
    await useAiConfigStore.getState().loadFromDisk();
  } catch (err) {
    console.warn('[settingsPersistence] Provider config load failed:', err);
  }

  // ponytail: storage provider creds live in ~/.mochi/image-hosts/ — load
  // after the regular slices hydrate so activeProvider is restored before
  // configs are read into the in-memory cache. Lazy import breaks the
  // store→settingsPersistence→store cycle.
  try {
    const { useStorageConfigStore } = await import('@/services/storage/storageConfigStore');
    await useStorageConfigStore.getState().loadFromDisk();
  } catch (err) {
    console.warn('[settingsPersistence] Storage config load failed:', err);
  }

  if (!any) return null;
  // Broadcast to secondary Tauri windows (pet-bubble / pet-corner /
  // pet-panel) which hold their own store instances but lack fs-plugin ACL
  // perms to re-read ~/.mochi/storage/ files themselves. Without this, the
  // bubble window's petStore stays at defaults (petSize='100') on startup —
  // `computeBubblePosition` then sizes the gap against the wrong pet
  // footprint, and larger pets ('125' / '150') get the bubble window's top
  // inside the pet window → pet occludes the bubble on `bottom` placement.
  // The same `pet://settings-updated` channel is also emitted by
  // `persistNow` on every setter, so subsequent changes propagate.
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
// library reconcile in usePetHostBridge) MUST await this before touching the store
// — otherwise they read default state and clobber the persisted value.
//
// Deferred promise — NOT resolved at module evaluation time. The eager
// loadSettings() call at module init runs before sibling modules (petStore,
// prefsStore, …) have had their own module code evaluated, so SLICES is
// still [] when the hydration loop starts. Instead, the caller (App.tsx)
// calls loadSettings() from a useEffect once the component mounts — by
// which time all modules are evaluated and SLICES is fully populated —
// and then calls resolveSettingsLoadDone() to unblock awaiters.
// See PRD fix-pet-icon-restart.

let _resolveSettingsLoadDone: ((value: void | PromiseLike<void>) => void) | null = null;

export const settingsLoadDone: Promise<void> = new Promise((resolve) => {
  _resolveSettingsLoadDone = resolve;
});

/** Resolve the settingsLoadDone promise. Called by App.tsx after
 *  loadSettings() completes. Idempotent — subsequent calls are no-ops. */
export function resolveSettingsLoadDone(): void {
  _resolveSettingsLoadDone?.();
  _resolveSettingsLoadDone = null;
}
