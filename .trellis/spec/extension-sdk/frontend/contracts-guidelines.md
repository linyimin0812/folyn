# Contracts Guidelines

> What belongs in the SDK, what does not, and the manifest contract.

---

## Layer boundary

The SDK owns **contracts only**. The split (from `extension-system.SPEC.md`, "Layers and their boundaries"):

| Concern | Owner | File |
|---------|-------|------|
| Manifest schema, contribution point types, `ExtensionApi`/`ExtensionContext`/`ExtensionModule` shapes, ownership primitives | **SDK** | `types.ts`, `contracts.ts`, `extension.ts`, `registry.ts` |
| Lifecycle state machine, transactional activation, registries for capability providers / contribution adapters | `@folyn/extension-host` | `packages/extension-host/src/` |
| Concrete loaders (`sandboxLoader`, `trustedLoader`), capability implementations, contribution wiring, UI | desktop app | `apps/desktop/src/services/extension-host/` |

**Loaders live in the desktop app, not in packages.** The SDK defines the `ExtensionLoader` interface (`extension.ts:31`); the host drives it; the concrete loaders must wire Tauri, DOM, and React, so they are app code. Do not push a loader down into a package to "share" it — there is no second consumer.

**Entry references stay strings through the SDK layer.** Manifest `contributes.*[].handler` / `component` / `run` / `entry` values are entry-ref strings; the SDK is React-free, and concrete React/CodeMirror adapters in the desktop app resolve them at activation (`types.ts` header comment).

## Manifest validation — one source of truth

`validateManifest()` in `src/defineExtension.ts` throws on invalid manifests; `defineExtension()` runs the same validation as an authoring type-guard. The host's `ExtensionHost.validateManifest` **delegates here**, and Rust install-time validation mirrors the same rules — extension, host, and installer share one source of truth. Change a rule here, and both enforcement points follow.

Rules (in `validateManifest`, in order):

- `manifest.id` must be kebab-case: `^[a-z0-9]+(-[a-z0-9]+)+$`
- `manifest.version` and `manifest.main` are required
- `manifest.tier` must be `'sandbox' | 'trusted'`
- sandbox tier must declare `manifest.html`
- `manifest.permissions.ai` (when present): `chat`/`edit` booleans, `agents` a `string[]` of non-empty feature names

Keep validation **strict-but-minimal** — mirror the host install checks, nothing speculative. If a rule has no enforcement point, it does not belong in `validateManifest`.

## Adding a contract

When a new contribution point or capability type is needed:

1. Add the type where its siblings live (contribution shapes in `contracts.ts`/`types.ts`; `ExtensionApi` slots in `extension.ts`).
2. Entry-refs are strings resolved by app adapters — never a `ComponentType` import in a manifest-reachable type.
3. Check the docs ship with the package (`docs/extension-development.md` — the ExtensionModule export contract section) and the host's contribution-adapter story, so the contract is documented end to end.

Reference example: `MarkdownCodeRendererProps` in `contracts.ts` — a props bundle type with JSDoc, no runtime code.
