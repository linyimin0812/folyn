# Provider Implementation Guidelines

> How vault providers are built in this package.

---

## Overview

This is a **non-UI library package** — no React components. The guidelines below cover how to implement vault storage providers.

---

## Provider Contract

Every provider implements the `VaultProvider` interface (`src/providerInterface.ts`):

```ts
export interface VaultProvider {
  readonly id: string;
  readonly type: ProviderType;          // 'tauri' | 'github' | 'webdav' | 's3' | 'custom'
  readonly displayName: string;
  readonly capabilities: VaultCapabilities;

  // ── Lifecycle ──
  connect(config: VaultConfig): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;

  // ── File Operations (required) ──
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(path: string, recursive?: boolean, showHidden?: boolean): Promise<VaultEntry[]>;

  // ── Directory Operations (required) ──
  createDir(path: string): Promise<void>;
  deleteDir(path: string): Promise<void>;

  // ── Advanced (optional, gated by capabilities) ──
  rename?(oldPath: string, newPath: string): Promise<void>;
  search?(query: string): Promise<VaultEntry[]>;
  getHistory?(path: string): Promise<VaultHistory[]>;
  watch?(callback: WatchCallback): WatchHandle;
  getMetadata?(path: string): Promise<VaultMetadata>;
}
```

Reference: `packages/vault-provider/src/providerInterface.ts`

---

## VaultManager

`VaultManager` is the single entry point for all vault operations. It proxies to the active provider:

```ts
export class VaultManager {
  private provider: VaultProvider | null = null;

  async switchVault(config: VaultConfig): Promise<void> {
    if (this.provider) await this.provider.disconnect();
    const registry = VaultProviderRegistry.getInstance();
    this.provider = registry.create(config);
    await this.provider.connect(config);
  }

  async readFile(path: string): Promise<string> {
    return this.getProvider().readFile(path);
  }
  // ... proxies all other operations
}
```

Consumers (the desktop app's `vaultStore`) use `VaultManager` — never instantiate providers directly.

Reference: `packages/vault-provider/src/vaultManager.ts`

---

## Capabilities

Providers declare what they support upfront:

```ts
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

Consumers check capabilities before calling optional methods:
```ts
if (manager.getCapabilities()?.watch) {
  manager.getCurrentProvider()?.watch(callback);
}
```

---

## Error Handling

All provider failures throw `VaultError` with typed error codes:

```ts
export class VaultError extends Error {
  constructor(public code: VaultErrorCode, message: string) {
    super(message);
  }
}

// Usage in VaultManager:
private getProvider(): VaultProvider {
  if (!this.provider) {
    throw new VaultError('NOT_FOUND', 'No vault is currently active. Call switchVault() first.');
  }
  return this.provider;
}
```

---

## Common Mistakes

- Instantiating providers directly in app code — always go through `VaultManager`
- Calling optional methods without checking `capabilities` first
- Silent failures — all provider errors must throw `VaultError`, not swallow errors
- Direct filesystem access — use Tauri fs plugin APIs in `TauriVaultProvider`
