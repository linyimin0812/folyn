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

Reference: `apps/desktop/src/store/editorStore.ts`, `apps/desktop/src/store/settingsStore.ts`

---

## Store Categories

| Store | Responsibility |
|-------|---------------|
| `settingsStore` | User preferences, theme, current page, shortcuts, sync config, AI CLI settings |
| `editorStore` | Open tabs, active tab, view mode, cursor position, diff review state |
| `vaultStore` | File tree, vault lifecycle, pin/unpin, file CRUD operations |
| `aiStore` | AI sessions, messages, file change actions |
| `searchStore` | Global search panel open/close state |
| `wikiStore` | Wiki graph data, ingestion, querying |
| `wikiGraphStore` | Wiki link graph visualization state |

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

Settings and editor state are persisted via `storageClient` — a thin wrapper that uses Tauri fs when available, falling back to localStorage in web context:

```ts
import { storageClient } from '@/utils/storageClient';

// Inside a store action:
const saved = await storageClient.get('settings');
await storageClient.set('settings', newState);
```

Reference: `apps/desktop/src/utils/storageClient.ts`, `apps/desktop/src/store/editorPersistence.ts`

---

## Local vs Global State Decision

| Scope | Tool | Examples |
|-------|------|----------|
| Component-local UI | `useState` | sidebar width, expanded dirs, search query, dialog open |
| Shared across 2+ components | Zustand store | open tabs, theme, file tree, AI session |
| Persisted across navigation | Zustand + storageClient | settings, open tabs, AI sessions |

---

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
