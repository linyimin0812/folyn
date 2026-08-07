# @quill/plugin-sdk

Quill Plugin SDK — the public type surface plugin authors program against.
Publishable to npm; no runtime.

## What's in here

- **Manifest schema** — `PluginManifest`, `PluginPermissions`, `PluginTier`.
- **Contribution points** — `CommandContribution`, `FileTypeContribution`,
  `ContainerContribution`, `FeatureContribution`, `ToolContribution`,
  `ExporterContribution`, `FileTemplateContribution`, `KeybindingContribution`,
  `ExportEnhancerContribution`.
- **Plugin module contract** — `PluginModule` (the export shape of a trusted
  plugin's ESM bundle).
- **Lifecycle context** — `PluginContext` with `addDisposable`, optional `ai`
  capability, optional `env` capability (host theme + locale).
- **Dev helpers** — `definePlugin`, `validateManifest`, `disposable`.

The SDK is **type-only at runtime** — React appears as a peer type, erased at
build. So this package has no production runtime dependency; the published
tarball is just `.d.ts` + a tiny ESM barrel.

## Install

```bash
npm install @quill/plugin-sdk
# or
pnpm add @quill/plugin-sdk
# or
yarn add @quill/plugin-sdk
```

`react` is a peer dependency (`^18.0.0`) — install it yourself if your plugin
uses React types.

## Quick start

```ts
import type { PluginManifest } from '@quill/plugin-sdk';
import { definePlugin, validateManifest } from '@quill/plugin-sdk';

const manifest: PluginManifest = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '0.1.0',
  tier: 'trusted',
  main: 'index.js',
};

validateManifest(manifest);
```

For the full plugin authoring guide (manifest schema, contribution points,
permissions, two execution tiers, sandbox RPC protocol, host environment
capability), see **[docs/plugin-development.md](../../docs/plugin-development.md)**
in the source repo.

## Two execution tiers

- **`sandbox`** — untrusted plugin in a sandboxed iframe (`quill-plugin://`
  origin), talks to the host via a vetted postMessage RPC. No raw Tauri APIs.
- **`trusted`** — TOFU-pinned plugin `import()`-ed into the host realm; may
  contribute inline React/CodeMirror components and receive scoped Tauri
  capability grants.

See `PluginTier` in `types.ts` and the "Two execution tiers" section of the
plugin development guide for the trade-offs.

## License

Same as the Quill project (see the source repo).
