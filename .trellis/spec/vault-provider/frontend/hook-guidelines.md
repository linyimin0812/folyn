# Hook Guidelines

> Hooks in the vault-provider package.

---

## Overview

**Not applicable.** This package is a non-UI library — it contains no React hooks.

Hooks that consume vault providers live in the desktop app:
- `apps/desktop/src/store/vaultStore.ts` — Zustand store wrapping `VaultManager`
- `apps/desktop/src/utils/fileWatcher.ts` — filesystem watcher integration
