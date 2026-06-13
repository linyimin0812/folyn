# Hook Guidelines

> Hooks related to the cli-adapter package.

---

## Overview

**Not applicable.** This package is a non-UI library — it contains no React hooks.

Hooks that consume CLI adapters live in the desktop app:
- `apps/desktop/src/components/ai/adapterManager.ts` — adapter lifecycle management
- `apps/desktop/src/store/aiStore.ts` — AI session state driven by adapter events

See the desktop frontend hook guidelines for patterns: `.trellis/spec/desktop/frontend/hook-guidelines.md`
