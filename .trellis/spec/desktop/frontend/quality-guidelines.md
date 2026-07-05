# Quality Guidelines

> Code quality standards for desktop frontend development.

---

## Required Patterns

**Store access** — always use granular selectors, never the whole store:
```ts
// ✅ Correct
const viewMode = useEditorStore((state) => state.viewMode);

// ❌ Wrong — subscribes to everything
const store = useEditorStore();
```

**Out-of-React store access** — use `getState()`:
```ts
// ✅ In event handlers, init sequences
const { activeTabId, saveFile } = useEditorStore.getState();

// ❌ Never call hooks outside components
const viewMode = useEditorStore((state) => state.viewMode); // in a setTimeout
```

**Tauri integration** — invoke commands via `@tauri-apps/api/core`:
```ts
import { invoke } from '@tauri-apps/api/core';
await invoke('open_file', { path: filePath });
```

**Platform guards** — check before Tauri-only APIs:
```ts
import { isTauri } from '@/utils/platform';
if (isTauri()) {
  import('@tauri-apps/api/core').then(({ invoke }) => {
    invoke('hide_all_webviews').catch(() => {});
  });
}
```

**useEffect cleanup** — all event listeners and watchers must be cleaned up:
```ts
useEffect(() => {
  const handler = () => { /* ... */ };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, []);
```

---

## Pluggable Registry Pattern

When a UI affordance (input mode, editor view mode, toolbar plugin, …) is driven
by a store value and must be extensible without touching the host component,
use a **module-scope registry + declarative descriptor + escape hatch**.

**What**: a feature exposes `register*` / `list*` / `get*` / `resolve*` over a
`Map<id, Def>`. Built-ins are registered at module load. The host component
renders from `list*()` so a newly registered entry appears with no code change.

**Why**: keeps the host component (ChatInput, toolbar, etc.) open for extension
but closed for modification, and keeps the store value a plain `string` id
rather than a closed union that would defeat extensibility.

**Example** (see `apps/desktop/src/components/ai/inputModes.ts`):

```ts
export interface AiInputModeDef {
  id: string; label: string; description?: string;
  permissionMode?: PermissionMode;          // declarative fields
  bare?: boolean; systemPrompt?: string;
  buildSendOptions?: (base: CliSendOptions) => CliSendOptions; // escape hatch
}

const defsById = new Map<string, AiInputModeDef>();
const order: string[] = [];

export function registerInputMode(def: AiInputModeDef): void { /* … */ }
export function listInputModes(): AiInputModeDef[] { /* … */ }

/** Unknown id returns base unchanged — a stale stored id must never break sending. */
export function resolveSendOptions(modeId: string, base: CliSendOptions): CliSendOptions { /* … */ }
```

**Rules**:
- Store the active id as a plain `string` in the zustand store (e.g.
  `aiStore.inputMode`), **not** a closed union — the whole point is open
  extension.
- `resolve*` must apply declarative fields first, then the `buildSendOptions`
  escape hatch, and must return `base` **unchanged** for an unknown id
  (defensive boundary; never throw on a stale id).
- The host component renders the toggle/list from `list*()` and only knows
  `id`/`label`/`description`; cross-layer option construction stays in
  `resolve*`, never in the component.

---

## Forbidden Patterns

| Pattern | Why | Alternative |
|---------|-----|-------------|
| `any` type | Defeats TypeScript | Use `unknown` + narrowing |
| `useStore()` no selector | Full re-renders | `useStore((s) => s.field)` |
| Business logic in components | Untestable, tightly coupled | Store actions or services |
| Direct DOM manipulation | Breaks React model | Refs or state |
| `useEffect` without deps array | Stale closures | Always specify deps |
| Side effects in selectors | Unpredictable behavior | Compute in actions |
| Raw `fetch` for Tauri ops | Bypasses Tauri IPC | `invoke()` |

---

## Error Handling

**Store actions** — try/catch with logging + user-facing error state:
```ts
try {
  await manager.switchVault(config);
} catch (err) {
  console.error('[VaultStore] switch failed:', err);
  set({ error: String(err) });
}
```

**Tauri commands** — `.catch(() => {})` for non-critical failures:
```ts
invoke('hide_all_webviews').catch(() => {});
```

**Init failures** — logged but not fatal:
```ts
useWikiStore.getState().initWiki().catch((err) => {
  console.warn('[App] Wiki init failed:', err);
});
```

---

## Import Order

Observed convention (enforced by reading order, not tooling):

1. React imports (`import { useEffect, useState } from 'react'`)
2. Store imports (`import { useEditorStore } from '@/store/editorStore'`)
3. Hook imports (`import { useTheme } from '@/hooks/useTheme'`)
4. Component imports (`import { Topbar } from '@/components/shell/Topbar'`)
5. Utility imports (`import { isTauri } from '@/utils/platform'`)
6. Package imports (`import { registerBuiltinPlugins } from '@quill/container-plugins'`)
7. Type-only imports (`import type { VaultEntry } from '@quill/vault-provider'`)

---

## File Size Guidelines

- **Stores**: keep under ~400 lines; split into helper files (`editorAutoSave.ts`, `editorPersistence.ts`)
- **Components**: split into subcomponents when JSX exceeds ~200 lines
- **Services**: one responsibility per file

---

## Code Review Checklist

- [ ] Store selectors are granular (no bare `useStore()`)
- [ ] `useEffect` has correct dependency array and cleanup
- [ ] Tauri-only APIs guarded with `isTauri()`
- [ ] No `any` types introduced
- [ ] Business logic lives in stores/services, not components
- [ ] New files follow naming conventions (PascalCase components, camelCase stores)
- [ ] No circular imports between store files
