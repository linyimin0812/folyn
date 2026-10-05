# Quality Guidelines

> Code quality standards for the extension-host package.

---

## Forbidden imports

| Pattern | Why | Alternative |
|---------|-----|-------------|
| `@tauri-apps/*` / any Tauri API | Host must stay platform-free | Capability comes in via `setHooks` / providers |
| `react` / any UI library | Host is not a rendering layer | Components live in the desktop app |
| Anything from `apps/desktop` or `@folyn/container-extensions` | Dependency direction is **SDK ← host ← app**, one way | Contracts from `folyn-extension-sdk` |

The only allowed project dependency is `folyn-extension-sdk` (`package.json` `dependencies`).

## Capability injection

The host never constructs an `ExtensionApi` itself. The shell wires `ExtensionHostHooks` (`ExtensionHost.ts`):

- `createApi(record)` returns the `ExtensionApi` (or an `ExtensionApiHandle` with optional `dispose` for host-side teardown, reaped by the runtime) — in the desktop app this calls `buildExtensionApi(manifest)` from `capabilityRegistry.ts`; it stays available as the whole-Api override escape hatch for tests/alternate shells
- `createContext(record)` supplies base context fields (vault/ui/path); the runtime layers `signal` + `addDisposable` on top

All hooks are optional so the host runs with none set in tests — that is the seam that makes fakes possible. Do not add a "real" default implementation of a hook.

## Testing with fakes

The established pattern — **no Tauri, no React, no real loaders**:

- `src/ExtensionHost.test.ts` — manifest validation cases (kebab id, sandbox html, tier, `permissions.ai` shapes), lifecycle transitions, transactional rollback, error isolation; fake loaders + fake `Extension` objects; `vi` for mocks
- `src/registries.test.ts` — capabilityRegistry folds providers into an Api and collects `dispose` hooks in registration order; slot replacement is last-write; contributionAdapterRegistry returns adapters in order

When touching `ExtensionHost.ts` or either registry, extend the matching suite in the same change: lifecycle edge → `ExtensionHost.test.ts`; seam behavior → `registries.test.ts`.

## Code Review Checklist

- [ ] No new dependency beyond `folyn-extension-sdk`
- [ ] New capability reached extensions through a `CapabilityProvider` (slot + build), not a hardcoded Api field
- [ ] New contribution point wired through a `ContributionAdapter` + one registration line
- [ ] Disposables staged transactionally (via `ctx.addDisposable`), never leaked past a failed activation
- [ ] State transitions match the `ExtensionState` machine; `deactivate` still never rejects
- [ ] Tests with fakes cover the new branch
