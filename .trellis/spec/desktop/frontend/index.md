# Frontend Development Guidelines

> Best practices for frontend development in the Quill desktop app.

---

## Overview

This directory contains guidelines for the `@quill/desktop` frontend — a Tauri 2 + React 18 + TypeScript + Zustand 5 + Tailwind CSS 3 + CodeMirror 6 application.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Feature Agents](./feature-agents.md) | Per-feature Claude Code agent architecture (canonical source, vault seeding, invoke contract) | Filled |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition, styling | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | Filled |
| [State Management](./state-management.md) | Zustand stores, local vs global state, persistence | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns, review checklist | Filled |
| [Type Safety](./type-safety.md) | Type patterns, naming, validation | Filled |
| [File Type Editors](./file-type-editors.md) | Custom editors, iframe bridge, serialization hygiene | Filled |
| [Markdown Rendering](./markdown-rendering.md) | Unified pipeline, MathJax SVG sync output, editor↔renderer code-segment contract, export self-containment | Filled |
| [Trusted Plugin Rendering](./trusted-plugin-rendering.md) | Host exposes `window.React`; trusted blob-URL plugins use `createElement` (no JSX/runtime `import 'react'`) to share the host React instance | Filled |
| [Tauri Window & ACL Patterns](./tauri-window-patterns.md) | Multi-window features, transparent/click-through windows, native popup menus, close-to-tray, ACL permission contract | Filled |
| [i18n Guidelines](./i18n-guidelines.md) | i18next + react-i18next namespaces, localeStore, Rust AppError contract, tauriInvoke wrapper | Filled |

---

## Quick Reference

**Tech stack**: React 18, Vite 6, TypeScript (strict), Zustand 5, Tailwind CSS 3, CodeMirror 6, Tauri 2

**Key patterns**:
- Named function exports for all components (no default exports except `App`)
- Zustand stores with granular selectors — never bare `useStore()`
- Tailwind utility classes + CSS custom properties for theming
- `@/` path alias maps to `src/`
- Tauri commands via `invoke()` from `@tauri-apps/api/core`
- Platform guards via `isTauri()` before Tauri-only APIs

---

**Language**: All documentation is written in **English**.
