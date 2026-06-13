# Frontend Development Guidelines

> Guidelines for the @quill/vault-provider package.

---

## Overview

`@quill/vault-provider` provides a pluggable storage abstraction for the vault system. Providers implement file operations across different backends (local filesystem via Tauri, GitHub, WebDAV, S3). The desktop app's `vaultStore` consumes this package via `VaultManager`.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Types, interface, registry, manager, providers | Filled |
| [Provider Guidelines](./component-guidelines.md) | VaultProvider contract, VaultManager proxy, capabilities | Filled |
| [Hook Guidelines](./hook-guidelines.md) | N/A — non-UI library | Filled |
| [State Management](./state-management.md) | N/A — class fields, reactive state in desktop vaultStore | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Required patterns, VaultError, checklist | Filled |
| [Type Safety](./type-safety.md) | Branded paths, capabilities, VaultError, watch types | Filled |

---

## Quick Reference

- **Tech**: TypeScript, Tauri fs plugin (`@tauri-apps/plugin-fs`)
- **Pattern**: `VaultProvider` interface → `VaultProviderRegistry` → `VaultManager` proxy
- **Error handling**: `VaultError` with typed error codes
- **Capabilities**: Declared upfront, checked before calling optional methods
- **Consumer**: Desktop app `vaultStore` (`apps/desktop/src/store/vaultStore.ts`)

---

**Language**: All documentation is written in **English**.
