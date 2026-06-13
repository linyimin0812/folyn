# Type Safety

> Type patterns in the vault-provider package.

---

## Branded Types

Path safety via branded string types:

```ts
export type VaultPath<T extends ProviderType = ProviderType> = string & { __brand: T };
```

Prevents accidentally mixing paths from different provider backends.

---

## Provider Type Identifiers

```ts
export type ProviderType = 'tauri' | 'github' | 'webdav' | 's3' | 'custom';
```

---

## Data Shape Types

```ts
export interface VaultEntry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size?: number;
  lastModified?: Date;
  etag?: string;
  children?: VaultEntry[];  // nested for recursive listing
}

export interface VaultCapabilities {
  writable: boolean;
  watch: boolean;
  search: boolean;
  history: boolean;
  sharing: boolean;
  streaming: boolean;
  offline: boolean;
}
```

---

## Custom Error Class

```ts
export class VaultError extends Error {
  constructor(public code: VaultErrorCode, message: string) {
    super(message);
  }
}
```

Error codes are string literals (e.g., `'NOT_FOUND'`, `'PERMISSION_DENIED'`).

---

## Watch Types

```ts
export interface WatchEvent {
  type: 'create' | 'update' | 'delete';
  path: string;
  timestamp: Date;
}

export interface WatchHandle {
  dispose: () => void;
}

export type WatchCallback = (events: WatchEvent[]) => void;
```

---

## Type Organization

- All types centralized in `src/types.ts`
- `VaultProvider` interface in `src/providerInterface.ts`
- All public types re-exported from `index.ts`

---

## Forbidden Patterns

- `any` in public interfaces
- Untyped error codes — use the `VaultErrorCode` string literal union
- Leaking provider-specific types through the public `VaultProvider` interface
