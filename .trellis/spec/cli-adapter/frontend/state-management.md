# State Management

> State management in the cli-adapter package.

---

## Overview

**Not applicable at the library level.** This package is stateless from the consumer's perspective — adapter instances hold internal state (running flag, session ID, buffers) as class fields, not React state.

State management for AI sessions happens in the desktop app:
- `apps/desktop/src/store/aiStore.ts` — Zustand store for sessions, messages, file changes
- `apps/desktop/src/store/aiFileChangeActions.ts` — file change action logic
- `apps/desktop/src/store/aiSessionPersistence.ts` — session persistence

Adapter events (`CliStreamEvent`) are consumed by the desktop app's AI panel and mapped to store updates.

See the desktop frontend state management guidelines: `.trellis/spec/desktop/frontend/state-management.md`
