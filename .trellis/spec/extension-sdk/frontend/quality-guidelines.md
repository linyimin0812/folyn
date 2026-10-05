# Quality Guidelines

> Code quality standards for the folyn-extension-sdk package.

---

## The runtime-free rule

The SDK ships to npm as types + pure functions only. `package.json`: no `dependencies`, `react` only under `peerDependencies`, `sideEffects: false`, `files: ["dist", "docs", "README.md"]`. Every change must preserve this — the moment an SDK file executes something platform-specific (Tauri call, DOM access, React hook), the package stops being publishable and the host stops being fake-testable.

## Forbidden Patterns

| Pattern | Why | Alternative |
|---------|-----|-------------|
| Any `dependencies` entry | Package must stay runtime-free | Types only; behavior belongs to host/app |
| `import { ... } from 'react'` (value import) | Runtime React dep | `import type { ... } from 'react'` |
| `@tauri-apps/*` imports | SDK never touches the platform | Contracts stay Tauri-free |
| Concrete loader / capability implementation | Loaders live in the desktop app | Define the interface here only |
| Duplicating a validation rule that exists in `validateManifest` | Two sources of truth drift | Extend `validateManifest` once |

## Verification

- `pnpm --filter folyn-extension-sdk typecheck` (the package script runs `tsc --noEmit`)
- Publishing gate: `prepublishOnly` runs `tsc`; check the emitted `dist/` has no runtime imports: `grep -rn "from 'react'" packages/extension-sdk/dist/*.d.ts` should only appear in type positions — simplest reliable check is that `src/` contains no value imports of react (`grep -rn "^import .* from 'react'" packages/extension-sdk/src/` returns nothing non-`type`)

## Docs

Contract changes update the shipped docs in the same task: `packages/extension-sdk/docs/extension-development.md` (+ `.zh.md`) and `extension-sdk-reference.md` — they document the manifest schema, the ExtensionModule export contract, and the permissions model (informational for trusted, enforced per-RPC-call for sandbox).
