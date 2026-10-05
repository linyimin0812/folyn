# Frontend Development Guidelines

> Guidelines for the folyn-extension-sdk package.

---

## Overview

`folyn-extension-sdk` (publishable to npm, `"Type-only at runtime"`) owns the **contracts** of the extension system: `ExtensionManifest` and its contribution schema, `ExtensionApi`/`ExtensionContext`, `ExtensionModule`, container contracts (`ContainerExtension`), the file-presentation model, `OwnedRegistry`/`Disposable` primitives, and the `validateManifest` / `defineExtension` dev helpers.

It sits at the bottom of a one-way dependency chain: **SDK ← host ← app** (`packages/extension-host` imports it; the desktop app and `@folyn/container-extensions` import it; it imports nothing project-internal). Architecture: repo-root `extension-system.SPEC.md`.

The SDK is **runtime-free**: it must stay publishable and dependency-clean — React appears as a peer *type* only, and there are no runtime dependencies at all.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Contracts Guidelines](./contracts-guidelines.md) | What belongs here vs host vs app; manifest validation rules | Filled |
| [Type Safety](./type-safety.md) | Peer-type-only React, manifest shape, presentation types | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Runtime-free constraint, forbidden imports, verification | Filled |

---

## Quick Reference

- **Tech**: TypeScript only; `tsc` build to `dist/`; `sideEffects: false`
- **Files**: `types.ts` (manifest), `contracts.ts` (containers/ExtensionModule), `presentation.ts`, `extension.ts` (Api/Context/Loader), `registry.ts` (OwnedRegistry, `FOLYN_CORE_OWNER`), `defineExtension.ts`, `Disposable.ts`, `export-service.ts`, `runtime.ts`, `toolbar.ts`
- **Rule**: contracts only — no loaders, no capability implementations, no Tauri, no runtime React
- **Docs shipped with the package**: `packages/extension-sdk/docs/extension-development.md` (EN) + `.zh.md` + `extension-sdk-reference.md`

---

**Language**: All documentation is written in **English**.
