# Frontend Development Guidelines

> Guidelines for the @quill/cli-adapter package.

---

## Overview

`@quill/cli-adapter` is a non-UI library that abstracts CLI-based AI tool integrations (Claude Code, etc.) behind a common adapter interface. It is consumed by the desktop app's AI panel.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Flat src layout, types centralized | Filled |
| [Adapter Guidelines](./component-guidelines.md) | BaseCliAdapter pattern, stream events, NDJSON parsing | Filled |
| [Hook Guidelines](./hook-guidelines.md) | N/A — no hooks in this package | Filled |
| [State Management](./state-management.md) | N/A — stateless library, state in desktop aiStore | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Required patterns, cleanup, checklist | Filled |
| [Type Safety](./type-safety.md) | Stream event types, status unions, internal vs public types | Filled |

---

## Quick Reference

- **Tech**: TypeScript, Tauri shell plugin (`@tauri-apps/plugin-shell`)
- **Pattern**: Abstract base class (`BaseCliAdapter`) + concrete adapters
- **Stream**: NDJSON parsing with line buffer, typed event emission
- **Consumer**: Desktop app AI panel (`apps/desktop/src/components/ai/`)

---

**Language**: All documentation is written in **English**.
