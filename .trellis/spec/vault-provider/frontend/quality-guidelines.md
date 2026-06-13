# Quality Guidelines

> Code quality standards for the vault-provider package.

---

## Required Patterns

- All providers implement the `VaultProvider` interface
- Capabilities declared upfront in `readonly capabilities: VaultCapabilities`
- `VaultManager` used as the single entry point — never instantiate providers directly in app code
- `VaultError` thrown with typed error codes for all failure paths
- `disconnect()` always cleans up resources (watchers, connections)

---

## Forbidden Patterns

| Pattern | Why | Alternative |
|---------|-----|-------------|
| Direct filesystem access in providers | Not portable | Tauri fs plugin APIs |
| Importing from `@quill/desktop` | Circular dependency | This package is a leaf |
| Silent error swallowing | Hides failures | Throw `VaultError` |
| Bypassing `VaultManager` | Breaks lifecycle | Use `manager.readFile()` |

---

## Testing

No test suite currently exists. When adding tests:
- Mock Tauri fs plugin APIs for `TauriVaultProvider`
- Test `VaultManager` lifecycle (connect → operations → disconnect)
- Verify `VaultError` thrown for operations on disconnected manager

---

## Code Review Checklist

- [ ] Provider implements all required `VaultProvider` methods
- [ ] Capabilities accurately reflect supported operations
- [ ] Optional methods use `?` syntax in interface
- [ ] `VaultError` thrown (not generic `Error`) for all failures
- [ ] `disconnect()` cleans up watchers and connections
- [ ] No imports from `@quill/desktop`
- [ ] Types exported from `index.ts`
