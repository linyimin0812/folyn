# folyn-extension-sdk

Folyn Extension SDK — the public type surface extension authors program against.
Publishable to npm; no runtime.

## What's in here

- **Manifest schema** — `ExtensionManifest`, `ExtensionPermissions`, `ExtensionTier`.
- **Contribution points** — `CommandContribution`, `FileTypeContribution`,
  `ContainerContribution`, `FeatureContribution`, `ToolContribution`,
  `ExporterContribution`, `FileTemplateContribution`, `KeybindingContribution`,
  `ExportEnhancerContribution`.
- **Extension module contract** — `ExtensionModule` (the export shape of a trusted
  extension's ESM bundle).
- **Lifecycle context** — `ExtensionContext` with `addDisposable`, optional `ai`
  capability, optional `env` capability (host theme + locale).
- **Dev helpers** — `defineExtension`, `validateManifest`, `disposable`.

The SDK is **type-only at runtime** — React appears as a peer type, erased at
build. So this package has no production runtime dependency; the published
tarball is just `.d.ts` + a tiny ESM barrel.

## Install

Published on npm as [`folyn-extension-sdk`](https://www.npmjs.com/package/folyn-extension-sdk).

```bash
npm install folyn-extension-sdk
# or
pnpm add folyn-extension-sdk
# or
yarn add folyn-extension-sdk
```

`react` is a peer dependency (`^18.0.0`) — install it yourself if your extension
uses React types.

## Quick start

```ts
import type { ExtensionManifest } from 'folyn-extension-sdk';
import { defineExtension, validateManifest } from 'folyn-extension-sdk';

const manifest: ExtensionManifest = {
  id: 'my-extension',
  name: 'My Extension',
  version: '0.1.0',
  tier: 'trusted',
  main: 'index.js',
};

validateManifest(manifest);
```

For the full extension authoring guide (manifest schema, contribution points,
permissions, two execution tiers, sandbox RPC protocol, host environment
capability), see **[docs/extension-development.md](./docs/extension-development.md)**
(bundled in this package, also in the source repo).

## Two execution tiers

- **`sandbox`** — untrusted extension in a sandboxed iframe (`folyn-extension://`
  origin), talks to the host via a vetted postMessage RPC. No raw Tauri APIs.
- **`trusted`** — TOFU-pinned extension `import()`-ed into the host realm; may
  contribute inline React/CodeMirror components and receive scoped Tauri
  capability grants.

See `ExtensionTier` in `types.ts` and the "Two execution tiers" section of the
extension development guide for the trade-offs.

## License

Same as the Folyn project (see the source repo).
