# Directory Structure

> How the vault-provider package is organized.

---

## Directory Layout

```
packages/vault-provider/
├── index.ts                       # Barrel exports
├── package.json                   # @mochi/vault-provider
├── tsconfig.json
└── src/
    ├── types.ts                   # ProviderType, VaultPath, VaultCapabilities,
    │                              #   VaultEntry, VaultMetadata, VaultHistory,
    │                              #   WatchEvent, WatchHandle, VaultConfig, VaultError
    ├── providerInterface.ts       # VaultProvider interface (lifecycle + file + dir + advanced ops)
    ├── registry.ts                # VaultProviderRegistry singleton
    ├── vaultManager.ts            # VaultManager — high-level proxy for vault operations
    └── providers/
        └── tauriProvider.ts       # TauriVaultProvider — local filesystem via Tauri fs plugin
```

---

## Module Organization

- **Types in `types.ts`** — all shared type definitions plus `VaultError` class
- **Interface in `providerInterface.ts`** — the contract all providers implement
- **Registry in `registry.ts`** — maps `ProviderType` to provider factory functions
- **Manager in `vaultManager.ts`** — high-level API consumed by the desktop app's `vaultStore`
- **Providers in `providers/`** — one file per concrete provider implementation

---

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Provider class | `<Backend>Provider` | `TauriVaultProvider` |
| Manager | `<Domain>Manager` | `VaultManager` |
| Registry | `<Domain>Registry` | `VaultProviderRegistry` |
| Error class | `<Domain>Error` | `VaultError` |
| Type identifiers | PascalCase | `ProviderType`, `VaultEntry`, `VaultCapabilities` |

---

## Adding a New Provider

1. Create `src/providers/<name>Provider.ts` implementing `VaultProvider`
2. Declare supported `VaultCapabilities`
3. Register in `VaultProviderRegistry` with a factory function
4. Export from `index.ts`

Reference: `packages/vault-provider/src/providers/tauriProvider.ts`
