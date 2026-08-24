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
import type { VaultEntry } from '@mochi/vault-provider';
```

Package imports use workspace protocol: `@mochi/cli-adapter`, `@mochi/container-plugins`, `@mochi/vault-provider`.

---

## Forbidden Patterns

- `any` — use `unknown` + type narrowing instead
- Bare `Object` or `{}` types — use `Record<string, unknown>` or specific interfaces
- Type assertions (`as any`) except for CSS variable injection: `style={{ '--ui-font-size': '14px' } as any}`
- Untyped event handlers — always type `React.ChangeEvent<HTMLInputElement>`, etc.

---

## Cross-package type boundaries

A package must not depend on a downstream consumer's catalog types. When both
sides of a package boundary need the same shape, type it as the broader
primitive (`string`) on the lower side and narrow at the consumer.

**Example**: `packages/cli-adapter/src/types.ts` cannot import
`ChatProvider` from `apps/desktop/src/services/providers/catalog` (that would
make the shared package depend on the app). `CliMessage.provider` is typed as
`string`; the desktop consumer narrows to `ChatProvider` at the read site.

```ts
// packages/cli-adapter/src/types.ts — primitive type, no catalog dep
export interface CliMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  provider?: string;  // ← string, not ChatProvider
  model?: string;
  // ...
}
```

```ts
// apps/desktop/src/store/aiStore.ts — narrows on read
const provider = msg.provider as ChatProvider | undefined;
```

**Don't**: Widen the catalog type (`ChatProvider` → `string`) just to share
across packages. That loses type safety in the app where it matters most.
Keep the narrow type in the consumer, use the primitive in the shared package.

---

## Optional fields for persisted schema additions

When adding new fields to a schema that's already persisted to disk (zustand
persist, storage.json blobs, etc.), default to **optional** fields unless you
ship a migration step. Legacy blobs on disk don't have the field; a required
type would lie about their shape.

```ts
// AiSession gains provider + model — optional, not required
export interface AiSession {
  // ... existing fields
  provider?: ChatProvider;  // ← optional; legacy sessions hydrate without it
  model?: string;
}
```

Pair with a type guard in the hydrate path:

```ts
function isProviderModelPair(v: unknown): v is { provider: string; model: string } {
  return typeof v === 'object' && v !== null
    && typeof (v as Record<string, unknown>).provider === 'string'
    && typeof (v as Record<string, unknown>).model === 'string';
}
```

Hydrate falls through to `null` / `undefined` for absent or malformed values.
Render-time fallback to a global default handles the "no value yet" case.

**Don't**: Mark the field required and `as` cast at the read site. The cast
hides the legacy-data gap and will crash on the first user who upgrades.
