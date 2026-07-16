# State Management

> How state is managed in the desktop app.

---

## Overview

Quill uses **Zustand 5** for all global state. There is no Redux, React Query, or SWR. All async operations go through store actions or service functions.

---

## Store Structure

Each store is a single file exporting a `use<Name>Store` hook created with `create<StateInterface>()`:

```ts
// apps/desktop/src/store/editorStore.ts
import { create } from 'zustand';

export type ViewMode = 'split' | 'edit' | 'preview';

export interface FileTab {
  id: string;
  name: string;
  path: string;
  content: string;
  isDirty: boolean;
  fileType: FileType;
  cursorLine?: number;
  cursorCol?: number;
}

interface EditorState {
  // ── State fields ──
  viewMode: ViewMode;
  tabs: FileTab[];
  activeTabId: string | null;
  cursorLine: number;
  cursorCol: number;

  // ── Actions ──
  setViewMode: (mode: ViewMode) => void;
  addTab: (tab: FileTab) => void;
  closeTab: (tabId: string) => void;
  openFile: (path: string, name: string) => Promise<void>;
  saveFile: (tabId: string) => Promise<void>;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  viewMode: 'split',
  tabs: [],
  activeTabId: null,
  // ...
}));
```

Reference: `apps/desktop/src/store/editorStore.ts`

Stores own one concern each. A store that grows to hold several unrelated
concerns becomes a god-store (the legacy `settingsStore` was split into 8
cohesive stores — see "Store Categories" below and the "No `update(partial)`
escape hatch" convention). When a store exceeds ~400 lines, prefer splitting
by concern over extracting helper files.

---

## Store Categories

| Store | Responsibility |
|-------|---------------|
| `navStore` | Runtime navigation — `currentPage`, `settingsTab` (NOT persisted) |
| `appearanceStore` | Theme, font/lineHeight, panel toggles, excludePatterns, linkOpenMode, vaultName |
| `editorPrefsStore` | Editor font/size, tab size, wrap, line numbers, syntax, autoSave, spellCheck |
| `vaultConfigStore` | Vault path/imagePath/docExtension/watchFileChanges/trashOnDelete |
| `syncStore` | Sync method/endpoint/credentials/bucket/autoSync/e2eEncrypt |
| `aiConfigStore` | CLI adapter/path + chat provider/model/key/baseUrl |
| `prefsStore` | Daily notes dir/format, file templates, shortcuts |
| `petStore` | Pet mode/position/panel geometry/icon/size/notificationForm |
| `editorStore` | Open tabs, active tab, view mode, cursor position, diff review state |
| `vaultStore` | File tree, vault lifecycle, pin/unpin, file CRUD operations |
| `aiStore` | AI sessions, messages, file change actions |
| `scheduleStore` | Schedule tasks + `boardColumns` (kanban columns) |
| `searchStore` | Global search panel open/close state |
| `wikiStore` | Wiki graph data, ingestion, querying |
| `wikiGraphStore` | Wiki link graph visualization state |

> The legacy `settingsStore` god-store was split into the 8 cohesive stores
> above (`navStore`…`petStore`) + `boardColumns` folded into `scheduleStore`.
> Do **not** re-merge concerns into one store; open a new store instead.

---

## Selector Pattern

Always select specific fields — never subscribe to the whole store:

```tsx
// ✅ Good — granular selector, only re-renders when viewMode changes
const viewMode = useEditorStore((state) => state.viewMode);

// ❌ Bad — subscribes to everything
const store = useEditorStore();
```

For derived values, compute inline in the selector:

```tsx
const activeTab = useEditorStore((state) => {
  return state.tabs.find((t) => t.id === state.activeTabId);
});
```

### Selector return values MUST be referentially stable

Zustand 5 selects via React 18's `useSyncExternalStore`. On every render, React
calls the selector and compares the result with `Object.is`. If the selector
returns a **new** reference each call (an inline `[]` / `{}` / `.map(...)` /
`.filter(...)` result), React treats it as a store change → re-render → calls
the selector again → another new reference → **infinite loop**, throwing
`Maximum update depth exceeded` and unmounting the component subtree (the panel
goes blank, with no error boundary to catch it).

The `find(...)` example above is safe: it returns either the found object
(stable ref) or `undefined` (a stable primitive). The danger is only with
**freshly-constructed** return values on a path that fires every render.

```tsx
// ❌ Bad — `?? []` mints a new array on every call when the session is absent
const messages = usePetChatStore(
  (s) => s.sessions.find((sess) => sess.id === s.activeSessionId)?.messages ?? [],
);

// ✅ Good — return a module-level constant on the not-found path
const EMPTY_MESSAGES: PetChatMessage[] = [];
const messages = usePetChatStore(
  (s) => s.sessions.find((sess) => sess.id === s.activeSessionId)?.messages ?? EMPTY_MESSAGES,
);
```

Rules:
- A selector may return a freshly-derived array/object **only if** the
  not-found / empty path returns a stable constant (or `undefined`/`null`).
- For `.map`/`.filter`/`.sort` results, prefer `useShallow` (zustand's
  shallow-equality selector) or compute outside the selector by selecting the
  stable source array first:
  ```tsx
  const sessions = usePetChatStore((s) => s.sessions);        // stable ref
  const active = sessions.find((s) => s.id === activeId);     // derive in render body
  ```
- This bites hardest on the **initial empty state** (e.g. before an async
  `rehydrate()` resolves, `sessions: []`) — a path tests often miss because
  they seed the store before rendering. Add a test that renders the initial
  empty state directly.

---

## Out-of-React Access

Use `getState()` for imperative code (event handlers, init sequences, Tauri command handlers):

```ts
// In App.tsx useEffect (imperative init)
await useVaultStore.getState().initVault();
await useEditorStore.getState().restoreOpenTabs();

// In keyboard shortcut handler (useEffect in App.tsx)
const handleKeyDown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    const { activeTabId, saveFile } = useEditorStore.getState();
    if (activeTabId) saveFile(activeTabId);
  }
};
```

Never call hooks (`useXStore`) outside React components — always use `useXStore.getState()` in imperative contexts.

---

## Persistence

Two persistence shapes coexist:

### Per-store persistence (editor tabs, AI sessions, chat sessions)

A store action calls `storageClient` directly, one key per concern:

```ts
import { storageClient } from '@/utils/storageClient';

// Inside a store action:
await storageClient.set('editor:tabs', newState);
```

Reference: `apps/desktop/src/utils/storageClient.ts`, `apps/desktop/src/store/editorPersistence.ts`

### Fan-out persistence (all user settings — the canonical multi-store pattern)

The 8 settings stores are persisted as a **single** `settings:all` blob via a
fan-out loader (`settingsPersistence.ts`), NOT one file per store. Rationale:
zero migration when splitting/merging stores; one debounced writer avoids
write storms on high-frequency setters (e.g. pet drag → `setPetPosition`).

Contract — each persisted store MUST:

1. Declare a `PERSIST_KEYS_X` array of its own field names (the slice it owns).
2. Implement `hydrate(blob: Record<string, unknown>)` — pick ONLY its own keys
   from the blob via `set`; missing keys fall through to defaults. Run any
   backfill / migration here (`backfillDefaultShortcuts`, `backfillBuiltinExcludePatterns`,
   `dailyNotesDir` `'daily'→'__daily__'`, `petPosVersion`/`petSizeVersion`).
3. Register on module load: `registerPersistSlice({ getSlice, keys })` where
   `getSlice` returns `{ [k]: state[k] }` for the store's PERSIST keys.

The loader (`settingsPersistence.ts`) owns the only read and the only write:

```ts
// Read (startup, eager on module import):
//   loadSettings() → storageClient.get('settings:all') → each registered
//   slice's hydrate(blob). One read total.

// Write (debounced 300ms):
//   schedulePersist() → collect every registered slice's getSlice() → merge
//   into one blob → storageClient.set('settings:all', blob). One writer total.
```

Rules:
- Runtime-only stores (`navStore`: `currentPage`/`settingsTab`) MUST NOT
  register a persist slice.
- A store setter that changes a persisted field MUST call `schedulePersist()`
  after `set(...)`. Forgetting it = silent data loss on that field (the
  `toggleTheme` bug from the god-store split is the cautionary tale).
- Adding a new persisted field = add to the store's `PERSIST_KEYS_X` + its
  `hydrate` + `getSlice`. Do NOT touch the loader.
- Adding a new settings store = create the store, register its slice. The
  loader fan-out needs no change.

Reference: `apps/desktop/src/store/settingsPersistence.ts`, and any of
`navStore.ts` / `appearanceStore.ts` / `petStore.ts` for the slice-registration shape.

Test contract: a pre-split blob (old field names + typical old values, invalid
enums, pre-migration values) loaded via `loadSettings()` must hydrate every
store correctly and fire every migration. This guards "old user restart =
zero-perception" — see `settingsPersistence.test.ts > applies every migration
to a pre-split blob`.

---

## Local vs Global State Decision

| Scope | Tool | Examples |
|-------|------|----------|
| Component-local UI | `useState` | sidebar width, expanded dirs, search query, dialog open |
| Shared across 2+ components | Zustand store | open tabs, theme, file tree, AI session |
| Persisted across navigation | Zustand + storageClient | settings, open tabs, AI sessions |

---

## No `update(partial)` escape hatch

Settings stores expose **dedicated `setX(v)` setters only** — never an
`update(partial: Partial<State>)` / `setMany(partial)` generic setter.

```ts
// ✅ Good — one dedicated setter per field; a consumer can only write what
//    the store explicitly names.
setFontSize: (size: number) => { set({ fontSize: size }); schedulePersist(); },

// ❌ Bad — generic Partial escape hatch lets any consumer write any field of
//    the store, which is exactly the cross-concern leak the god-store split
//    removed (legacy `settingsStore.updateSettings(Partial<SettingsState>)`).
update: (partial: Partial<SettingsState>) => { set(partial); schedulePersist(); },
```

Why: a `Partial<State>` setter re-introduces the god-store coupling the split
was for — one typed call can touch fields across concerns. Dedicated setters
keep the boundary enforceable at the type level. The only acceptable `set(partial)`
is **internal** (inside a private `hydrate`); it must not be exported.

## Store File Splitting

When a store exceeds ~400 lines, extract derived logic into sibling helper files:

- `editorStore.ts` → `editorAutoSave.ts` + `editorPersistence.ts`
- `aiStore.ts` → `aiFileChangeActions.ts` + `aiSessionPersistence.ts`

Helper files import from the store but are not stores themselves.

---

## Common Mistakes

- Default store subscriptions (`useStore()` with no selector) — causes full re-renders on every state change
- Selectors returning a freshly-constructed `[]`/`{}`/`.map()`/`.filter()` on the empty path — `useSyncExternalStore` infinite loop, panel goes blank (see "Selector return values MUST be referentially stable" above)
- Calling hooks in `useEffect` callbacks — use `getState()` instead
- Mixing async business logic directly in components — extract to store actions or services
- Forgetting to clean up watchers/listeners when a store-driven effect unmounts
- A persisted store setter that doesn't call `schedulePersist()` after `set(...)` — the field changes in memory but is never written to disk (silent data loss; the `toggleTheme` bug is the cautionary case)
- Exposing an `update(partial: Partial<State>)` generic setter on a settings store — re-introduces the cross-concern god-store coupling (see "No `update(partial)` escape hatch")
- Stale references to the deleted `settingsStore` in comments/imports after the split — grep `settingsStore` should return only provenance narrative, zero imports
