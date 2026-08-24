# Frontend Development Guidelines

> Guidelines for the @mochi/container-plugins package.

---

## Overview

`@mochi/container-plugins` provides a registry-based plugin system for Markdown container directives (`:::callout`, `:::tabs`, etc.). Plugins render in the preview pane and appear in the editor's `/` slash command menu.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | One plugin per file, types in root src | Filled |
| [Plugin Guidelines](./component-guidelines.md) | ContainerPlugin pattern, styling, categories | Filled |
| [Hook Guidelines](./hook-guidelines.md) | N/A — pure render components | Filled |
| [State Management](./state-management.md) | N/A — stateless renderers, local useState only | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Required patterns, forbidden imports, checklist | Filled |
| [Type Safety](./type-safety.md) | ContainerProps, ContainerPlugin interface, registry types | Filled |

---

## Quick Reference

- **Tech**: TypeScript, React 18, remark-directive
- **Pattern**: `ContainerPlugin` interface → singleton `ContainerRegistry` → consumed by slash menu + preview renderer
- **Styling**: Inline styles + CSS variables (no Tailwind in preview pane)
- **CSS prefix**: `docmd-<name>`
- **Registration**: `registerBuiltinPlugins()` called once in `App.tsx`

---

**Language**: All documentation is written in **English**.
