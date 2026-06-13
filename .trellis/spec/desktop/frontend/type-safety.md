# Type Safety

> TypeScript patterns and conventions in the desktop app.

---

## TypeScript Configuration

From `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

---

## Type Organization

| Scope | Location | Example |
|-------|----------|---------|
| Shared across features | `src/types/<domain>.ts` | `src/types/wiki.ts` |
| Store state | Co-located with store file | `interface EditorState` in `editorStore.ts` |
| Component props | Co-located with component | `interface TopbarProps` in `Topbar.tsx` |
| Package public API | `index.ts` barrel exports | `packages/vault-provider/src/types.ts` |

---

## Interface Naming Conventions

| Kind | Pattern | Example |
|------|---------|---------|
| Store state | `<Domain>State` | `EditorState`, `VaultState`, `SettingsState` |
| Component props | `<Component>Props` | `TopbarProps`, `SidebarProps` |
| Data shapes | Descriptive nouns | `FileTab`, `VaultEntry`, `CliMessage`, `ContainerPlugin` |
| Store hook | `use<Domain>Store` | `useEditorStore`, `useVaultStore` |

---

## String Literal Unions

Used extensively for discriminators and bounded sets:

```ts
export type ViewMode = 'split' | 'edit' | 'preview';
export type AppPage = 'editor' | 'vault' | 'settings';
export type Theme = 'light' | 'dark' | 'system';
export type ProviderType = 'tauri' | 'github' | 'webdav' | 's3' | 'custom';
export type ContainerCategory = 'layout' | 'media' | 'ai' | 'data' | 'custom';
export type CliStreamEventType =
  | 'text' | 'thinking' | 'tool_start' | 'tool_end'
  | 'file_change' | 'session_id' | 'error' | 'done';
```

---

## Brand Types

Used in vault-provider to prevent path misuse across providers:

```ts
// packages/vault-provider/src/types.ts
export type VaultPath<T extends ProviderType = ProviderType> = string & { __brand: T };
```

---

## Optional Capability Methods

Interfaces use `?` for optional methods gated by capabilities:

```ts
export interface VaultProvider {
  // Required
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;

  // Optional — declared in capabilities
  rename?(oldPath: string, newPath: string): Promise<void>;
  search?(query: string): Promise<VaultEntry[]>;
  getHistory?(path: string): Promise<VaultHistory[]>;
}
```

---

## No Runtime Validation

No Zod, Yup, or io-ts. Input validation uses:
- TypeScript type narrowing at boundaries
- Manual checks in Tauri command handlers
- Store-level validation before state updates

---

## Path Aliases

`@/` maps to `apps/desktop/src/` — configured in both `vite.config.ts` and `tsconfig.json`:

```ts
import { useEditorStore } from '@/store/editorStore';
import type { VaultEntry } from '@quill/vault-provider';
```

Package imports use workspace protocol: `@quill/cli-adapter`, `@quill/container-plugins`, `@quill/vault-provider`.

---

## Forbidden Patterns

- `any` — use `unknown` + type narrowing instead
- Bare `Object` or `{}` types — use `Record<string, unknown>` or specific interfaces
- Type assertions (`as any`) except for CSS variable injection: `style={{ '--ui-font-size': '14px' } as any}`
- Untyped event handlers — always type `React.ChangeEvent<HTMLInputElement>`, etc.
