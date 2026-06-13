# State Management

> State management in the vault-provider package.

---

## Overview

**Not applicable at the library level.** `VaultManager` holds internal state (active provider, current config) as class fields, not React state.

The desktop app's `vaultStore` (Zustand) wraps `VaultManager` and exposes reactive state:
- `apps/desktop/src/store/vaultStore.ts` — file tree, loading state, error state, pin/unpin
- `apps/desktop/src/store/editorStore.ts` — open tabs backed by vault file reads

State flow:
1. `vaultStore.initVault()` → creates `VaultManager` → connects provider
2. `vaultStore.refreshFileTree()` → calls `manager.listFiles()` → updates store state
3. Components subscribe to `vaultStore` via Zustand selectors
