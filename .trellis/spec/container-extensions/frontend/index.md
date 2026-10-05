# Frontend Development Guidelines

> Guidelines for the @folyn/container-extensions package.

---

## Overview

`@folyn/container-extensions` ships the built-in Markdown container directives (`:::callout`, `:::tabs`, `:::mermaid`, etc.). Components render in the preview pane and appear in the editor's `/` slash command menu.

The container contracts (`ContainerExtension`, `ContainerProps`, `ContainerCategory`) live in `folyn-extension-sdk` and are re-exported by this package. The package root `index.ts` is the public API: contract re-exports, the built-in extensions, and `registerBuiltinExtensions()` which registers all 13 built-ins on the `ContainerRegistry` singleton.

External extensions register into the same singleton after the extension host activates them — built-in and external containers are the same kind of thing (see repo-root `extension-system.SPEC.md`).

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | One file per extension, contracts re-export, registry | Filled |
| [Extension Guidelines](./extension-guidelines.md) | ContainerExtension pattern, styling, categories, VaultContext | Filled |
| [Type Safety](./type-safety.md) | ContainerProps, ContainerCategory, registry types, ownership | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Required patterns, forbidden imports, testing, checklist | Filled |

Hook/state guidelines are N/A — see [Extension Guidelines](./extension-guidelines.md) (stateless renderers, local `useState` only) and [Quality Guidelines](./quality-guidelines.md) (no hooks beyond React built-ins, no stores).

---

## Quick Reference

- **Tech**: TypeScript, React 18, remark-directive; mermaid / @viz-js/viz / CodeMirror StreamLanguage as peers
- **Pattern**: `ContainerExtension` object (types from `folyn-extension-sdk`) → singleton `ContainerRegistry` → consumed by slash menu + preview renderer
- **Styling**: Inline styles + CSS variables (no Tailwind in preview pane)
- **CSS prefix**: `docmd-<name>`
- **Registration**: `registerBuiltinExtensions()` called once in `apps/desktop/src/App.tsx` (line 47)

---

**Language**: All documentation is written in **English**.
