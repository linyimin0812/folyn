# Extension System Architecture

## Purpose

Let third parties add capabilities to Folyn — file viewers, editor languages,
markdown containers, commands, exporters — without touching core code. The
core stays shippable while capabilities live outside it, installed on demand
from a catalog.

## The core decision: two tiers

Every extension declares `tier: sandbox | trusted` in its manifest. This is
the design axis of the whole system; it picks the loader, the isolation
boundary, and how capabilities reach the extension.

**Sandbox** runs in a `<iframe sandbox="allow-scripts">` with **no
`allow-same-origin`** — an opaque origin with no host cookies or storage. The
Rust `folyn-extension://` URI scheme serves its assets and injects a
`default-src 'none'` CSP. Every capability arrives over RPC (postMessage for
the in-page iframe, fetch-over-URI-scheme for a tool window), and **each call
is checked against `manifest.permissions` before it runs**. Sandbox is the
default-trust path: install and go.

**Trusted** runs in the host webview realm via a Blob-URL `import()`. It gets
the full `ExtensionApi` object directly — no RPC, no per-call gate. The price
is a hard **TOFU gate**: before first activation the user must approve it, and
every activation re-checks the SHA-256 `integrity` of the entry module against
the manifest. This is the only boundary on trusted code; the system accepts
that trade-off explicitly (trusted code, once approved, has full host
capability).

> Unconfirmed: whether `grant_extension_capabilities` was removed by design or
> simply never wired. Either way it is currently bypassed and must stay so —
> runtime ACLs for trusted code do not exist; TOFU + integrity is the whole gate.

## Layers and their boundaries

```
extension-sdk   (pure contracts, no runtime deps — publishable)
   ▲
extension-host  (lifecycle state machine, Tauri-free, React-free)
   ▲  (host calls setHooks({createApi, createContext}) to receive capability)
desktop app     (loaders, capability impl, contribution adapters, UI)
container-extensions  (built-in ::: containers, shares the registry singletons)
   │
Rust backend    (install, validate, file serve, URI scheme, events)
```

**Dependency direction runs one way: SDK ← host ← app.** The SDK owns the
contracts (`ExtensionManifest`, `ExtensionPermissions`, `ContributionPoints`,
`ExtensionApi`, `OwnedRegistry`, `DisposableStore`) and nothing else. The host
owns the lifecycle state machine and transactional activation; it never names
Tauri or React. The desktop app injects real capability implementations through
`setHooks` — this seam is what keeps the host unit-testable.

Boundary rule: the **loaders live in the desktop app, not in packages**. The
SDK defines the `ExtensionLoader` interface; `extension-host` drives it; the
concrete `sandboxLoader` / `trustedLoader` are app code because they must wire
Tauri, DOM, and React. Do not push loaders down into a package to "share" them
— there is no second consumer.

`container-extensions` is a contributor, not a loader. It ships the built-in
`:::name` containers and the `ContainerRegistry` singleton; an external
extension that `contributes.containers` registers into the same singleton after
the host activates it. Built-in and external containers are the same kind of
thing.

## Invariants

- **No extension runs before its manifest is validated** (id kebab-case, tier
  set, sandbox tier must declare `html`). Validation is shared between Rust
  install-time and SDK `validateManifest`.
- **Sandbox never receives a raw host handle.** All its capability calls cross
  a bridge that re-checks permissions. Moving a sandbox call to a direct handle
  is a boundary violation, not an optimization.
- **Trusted never activates without TOFU approval + integrity match.** A
  changed entry module re-triggers approval.
- **All contributions are owned.** `OwnedRegistry<T>` tracks each contribution
  by its owning extension id; deactivate / reload removes them in bulk via
  `removeByOwner`. No contribution outlives its extension.
- **Install never trusts zip contents.** `extract_zip_filtered` rejects
  zip-slip, symlinks, source/lockfile/sourcemap entries, and enforces
  per-file/total/count caps before the manifest is even read.

## Lifecycle and transactional activation

State machine: `discovered → validated → loading → activating → active`, with
`failed` and `deactivating` branches. Each activation gets an
`ExtensionRuntime` owning an `AbortController` + `DisposableStore`.

Activation is **transactional**: disposables registered during activation are
staged; on success they commit, on failure they roll back LIFO. A
half-activated extension leaves no residual contributions. Deactivation aborts
the signal, calls `extension.deactivate?.(ctx)`, then reaps remaining
disposables.

## Contribution model

An extension declares `contributes` (commands, fileTypes, containers, features,
tools, exporters, fileTemplates, keybindings, exportEnhancers,
markdownCodeRenderers, editorLanguages, highlightGrammars) in the manifest, and
its ESM module exports matching entry points keyed by the same names. The
SDK's `ExtensionModule` is that contract. Entry references stay as strings
through the SDK layer — the SDK is React-free; concrete React/CodeMirror
adapters in the desktop app resolve them at activation.

## Communication

Three channels, by tier:

- **postMessage RPC** — sandbox iframe ↔ host. `rpcBridge` verifies
  `source === iframe.contentWindow` and dispatches per-method after the
  permission check.
- **fetch-RPC** — a sandbox running in its own tool window (WebviewWindow)
  fetches `folyn-extension://localhost/<id>/rpc`; Rust emits an event, the host
  listener dispatches the same `dispatchExtensionRpc`, and responds via an
  oneshot channel (30s timeout → 504). Same permission gate as postMessage.
- **direct API** — trusted code calls the `ExtensionApi` object in-realm. Vault
  paths are still scoped (reject `..`, confine to vault root); origin scoping
  on `http.fetch` still applies.

The two sandbox transports share one dispatcher so the permission check is
written once.

## Distribution

Extensions ship as zips whose root contains `manifest.json` and a built `dist/`.
A catalog (`catalog.json` on a separate GitHub repo) lists entries pointing at
GitHub Release assets; the store tab fetches it through Rust (webview cannot
cross-origin to `raw.githubusercontent.com`). `install_extension_from_url`
downloads via reqwest (SSRF: host must be `github.com`, redirects followed)
then reuses the full zip-install path — filter, validate, integrity, registry,
`extension://installed` event — so there is one install pipeline, not three.
Local folder / zip / URL all converge on it.

## Registration seams (platform-service modularization)

The host kernel stays a thin lifecycle state machine; concrete capability
implementations and contribution wiring are injected at boot through two
registries in `@folyn/extension-host`, mirroring the existing `registerLoader`
tier seam. Both are "mechanism in kernel, policy in swappable servers" done at
registration time (single-process Tauri app — not a speculative package
extraction; no second consumer exists yet).

- **`CapabilityProvider` registry** (`capabilityRegistry.ts`) — the
  platform-service seam. Each provider fills one slot of `ExtensionApi`
  (`{ slot, build(manifest), dispose?(value) }`). `buildExtensionApi(manifest)`
  folds registered providers into the `ExtensionApi` handed to
  `module.activate(api, ctx)`, collecting each `dispose` into one `Disposable`.
  The desktop app self-registers providers at module load
  (`createExtensionApi.ts`); the `createApi` hook calls `buildExtensionApi` and
  remains the whole-`Api` override escape hatch for tests / alternate shells.
  Adding a capability = add a factory + one `registerCapability` line.
- **`ContributionAdapter` registry** (`contributionAdapterRegistry.ts`) — the
  trusted-tier contribution wiring seam. Each adapter
  (`{ moduleKey?, register(manifest, module): Disposable | Promise<Disposable> }`)
  wires one contribution point. `trustedLoader.activate` folds over registered
  adapters; `normalizeModule` pulls only the `moduleKey`s they declare. A single
  declarative manifest (`trustedContributions.ts`) registers all 12. Adding a
  contribution point = add the adapter + one line in `trustedContributions.ts` —
  `trustedLoader` and `normalizeModule` stay stable folds.

The sandbox tier is structurally different (RPC-dispatched, no module) and does
not use these seams. `OwnedRegistry` is not used here — providers/adapters are
host-owned singletons, not extension-owned.

## Open seams (to record, not to fix now)

- Name alignment: resolved. Template (`create-folyn-extension/template`), SDK
  source, host loader, SDK docs (`extension-development.md`, `.zh.md`,
  `extension-sdk-reference.md`, `README.md`), and `extensions/*/build.mjs`
  all use `ExtensionModule` + `folyn-extension-sdk` + the `Extension*`
  symbol family. The `plugin`→`extension` rename is complete across these;
  only third-party refs (`@vitejs/plugin-react`, "vite plugin") still say `plugin`.
- Signature verification (`verify_extension_signature`, ed25519) exists in Rust
  and is non-fatal (stderr warning only). Its role relative to TOFU + integrity
  is undecided — document it as opt-in publisher verification, or wire it as a
  gate, but don't leave it half-on.
