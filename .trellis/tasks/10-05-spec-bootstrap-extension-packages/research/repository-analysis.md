# Repository Analysis — Extension Packages Spec Bootstrap

Date: 2025-10-05. All paths verified against the working tree.

## Package inventory (actual)

| Package name | Path | Size | Spec status |
|---|---|---|---|
| `@folyn/container-extensions` | `packages/container-extensions` | 25 ts files, ~2000 lines | MISSING (old `container-plugins` spec is stale) |
| `folyn-extension-sdk` | `packages/extension-sdk` | 10 files, ~1800 lines | MISSING |
| `@folyn/extension-host` | `packages/extension-host` | 6 files, ~1000 lines | MISSING |
| `create-folyn-extension` | `packages/create-folyn-extension` | 1 file + template | MISSING |
| `folyn-extension-dev-skill` | `packages/extension-dev-skill` | docs only (SKILL.md + references) | MISSING |

Note the inconsistent npm scopes: SDK is `folyn-extension-sdk` (unscoped), host is `@folyn/extension-host`, containers `@folyn/container-extensions`. Specs must use each package's real import name.

Dead registry entries in `.trellis/config.yaml`:
- `api: apps/api` — directory does not exist. Backend reality: `apps/desktop/src-tauri/src/` (already described by `.trellis/spec/api/backend/*`).
- `container-plugins: packages/container-plugins` — replaced by `container-extensions`.
- `default_package: api` — points at dead path.

## Architecture (from extension-system.SPEC.md + source)

```
extension-sdk   (pure contracts, no runtime deps — publishable)
   ▲
extension-host  (lifecycle state machine, Tauri-free, React-free)
   ▲  (host calls setHooks({createApi, createContext}) to receive capability)
desktop app     (loaders, capability impl, contribution adapters, UI)
container-extensions  (built-in ::: containers, shares registry singletons)
   │
Rust backend    (install, validate, file serve, URI scheme, events)
```

Dependency direction: SDK ← host ← app. One way only.

Two-tier model: `sandbox` (iframe, no allow-same-origin, per-RPC-call permission checks) vs `trusted` (blob-URL import() in host realm, TOFU gate + SHA-256 integrity, full ExtensionApi, no per-call gate).

## Key patterns per package (source-backed)

### extension-sdk (`packages/extension-sdk/src/`)
- `defineExtension.ts` — `validateManifest()` (kebab-case id regex, tier check, sandbox requires html, permissions.ai shape) + `defineExtension()` type-guard. Doc comment: "Runtime-free — safe to ship in the publishable SDK. The host's `ExtensionHost.validateManifest` delegates here so extension and host share one source of truth."
- `contracts.ts` — `ContainerProps`, `ContainerCategory` ('layout'|'media'|'ai'|'data'|'custom'), `ContainerExtension` interface (name/icon/label/category/component/template/description/hidesInactiveChildren). React appears as **peer type only** — type-only imports erased at build, no runtime dependency.
- `presentation.ts` — file presentation model: FileTypeProvider, PresentationModeRegistration, PresentationModeId/Kind, SplitComposition, FilePresentationContext, IconRef, EditorProps, PreviewProps, ViewMode.
- Other files: `extension.ts` (ExtensionApi, ExtensionContext), `registry.ts` (OwnedRegistry), `runtime.ts`, `toolbar.ts`, `types.ts` (ExtensionManifest), `Disposable.ts`, `export-service.ts`.

### extension-host (`packages/extension-host/src/`)
- `ExtensionHost.ts` — lifecycle state machine: `discovered → validated → disabled → waiting → loading → activating → active → deactivating → failed`. Guarantees: per-activation AbortSignal; transactional activation (failed activate rolls back staged disposables); error isolation (activate throw → runtime disposed → state='failed', never crashes caller). Host stays **Tauri-free and unit-testable with fakes** — capability wiring injected via `createApi`/`createContext` hooks (`ExtensionApiHandle`).
- Imports contracts from `folyn-extension-sdk` (validateManifest delegated).
- `ExtensionRuntime.ts` (consoleLogger + runtime), `capabilityRegistry.ts`, `contributionAdapterRegistry.ts` + two `.test.ts` files — tests with fakes are the established pattern.
- File headers reference design doc sections (§37, §38, §42, §60) in `Folyn-Extension-System-Refactor-Technical-Design.md` (repo root, 3296 lines, Chinese).

### container-extensions (`packages/container-extensions/`)
- Root `index.ts` — public API: re-exports contracts from SDK + built-in extensions + `registerBuiltinExtensions()` registering 13 extensions on `ContainerRegistry.getInstance()`.
- One file per extension in `src/extensions/` (Callout, Tabs+tab, Mermaid, PlantUml, Graphviz, StatusTag, Timeline, FilePreview, Steps+step, Collapsible, Card, Grid, Button).
- `src/plantuml/encode.ts` — plantuml text encoding.
- `src/editor-languages/` — CodeMirror StreamLanguage factories (mermaid, plantuml, dot), **hosted by the app** (`apps/desktop registerBuiltinCodeContributions`).
- `src/VaultContext.ts` — VaultContext + useVaultContext.
- Consumption: `apps/desktop/src/App.tsx:47` — `import { registerBuiltinExtensions } from '@folyn/container-extensions'`.

### create-folyn-extension (`packages/create-folyn-extension/src/index.ts`)
- CLI scaffold, `parseArgs` + readline prompts. `--tier <trusted|sandbox>` REQUIRED. Tiers doc: trusted = host-realm import(), inline React via window.React; sandbox = isolated iframe, postMessage RPC.
- Template in `template/`, defaults version 0.1.0, folyn '>=0.1.0'. Non-TTY piped stdin auto-enables --yes.

### extension-dev-skill (`packages/extension-dev-skill/`)
- `SKILL.md` + `references/` + `index.js` — an agent skill package, not application code. Its SKILL.md IS its documentation. A spec pointer suffices; do not duplicate.

## Stale references in desktop spec (must fix in this task)

1. `.trellis/spec/desktop/frontend/trusted-plugin-rendering.md:167` — `packages/container-plugins/src/plugins/MermaidPlugin.tsx` → now `packages/container-extensions/src/extensions/MermaidExtension.tsx` (host-bundled, not blob-loaded).
2. `.trellis/spec/desktop/frontend/state-management.md:128` — `ContainerRegistry (@folyn/container-plugins)` / `registerBuiltinPlugins()` in App.tsx → `@folyn/container-extensions` / `registerBuiltinExtensions()`.
3. `.trellis/spec/desktop/frontend/quality-guidelines.md:245` — `import { registerBuiltinPlugins } from '@folyn/container-plugins'` → registerBuiltinExtensions from '@folyn/container-extensions'.
4. `.trellis/spec/desktop/frontend/type-safety.md:114` — workspace protocol list contains `@folyn/container-plugins` → `@folyn/container-extensions`.

## Old container-plugins spec: what carries over vs what dies

Carries over (pattern unchanged, rename ContainerPlugin→ContainerExtension):
- One plugin per file in src/extensions (was src/plugins)
- Registry singleton, register once at load, no runtime add/remove → no reactivity
- Styling: inline styles + CSS variables (no Tailwind in preview pane)
- Slash-menu integration (template inserted on selection)
- Stateless renderers, local useState only

Dies or changes:
- "N/A — hook guidelines" pattern stays but interface moved to SDK (`folyn-extension-sdk` contracts re-exported)
- New to document: `hidesInactiveChildren` flag (cursor-sync contract, declared at definition site — no host-side allowlist), VaultContext, editor-languages factories, FOLYN_CORE_OWNER, tier/permission context (extensions can be sandbox/trusted)

## Authoritative docs to reference from specs

- `extension-system.SPEC.md` (repo root, 197 lines) — layering, two-tier decision, boundary rules. Best single reference.
- `Folyn-Extension-System-Refactor-Technical-Design.md` (repo root, 3296 lines) — full design; host code cites its §numbers.
- `.trellis/spec/desktop/frontend/trusted-plugin-rendering.md` — host-side React sharing contract (window.React, blob-URL constraints).

## Spec mechanics (verified)

- `.trellis/scripts/common/packages_context.py` `_scan_spec_layers`: spec layers = subdirectories of `.trellis/spec/<package-key>/` (any name except "guides"); package keys come from `.trellis/config.yaml` `packages:` mapping. Config key must equal spec dir name.
- Existing layer convention for TS packages is `frontend` (cli-adapter, vault-provider, container-plugins all use it). Keep `frontend` for the new packages for routing consistency.
- `guides/` at spec root is special (excluded from layer scan).
- `.trellis/spec/api/backend/*` content describes `apps/desktop/src-tauri/src/` — it should move to `.trellis/spec/desktop/backend/` when the dead `api` key is removed.
