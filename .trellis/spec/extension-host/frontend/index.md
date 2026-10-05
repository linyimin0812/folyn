# Frontend Development Guidelines

> Guidelines for the @folyn/extension-host package.

---

## Overview

`@folyn/extension-host` is the extension system's microkernel: the lifecycle host (`ExtensionHost.ts`) plus the per-activation `ExtensionRuntime` and two registration seams (`capabilityRegistry.ts`, `contributionAdapterRegistry.ts`). It depends on exactly one package: `folyn-extension-sdk` (contracts + `validateManifest`).

The host owns the **lifecycle state machine and transactional activation — nothing else**. Capability wiring (ai/env/http/vault/...) is injected by the host shell through `setHooks({ createApi, createContext })`, which is what keeps the host **Tauri-free, React-free, and unit-testable with fakes**. Design references: `Folyn-Extension-System-Refactor-Technical-Design.md` (repo root) §37, §38, §42, §60 — the §numbers are cited in the source file headers.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Lifecycle Guidelines](./lifecycle-guidelines.md) | State machine, transactional activation, AbortSignal, error isolation | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Forbidden imports, capability injection, testing with fakes | Filled |

Directory/type guidelines are N/A — the package is 4 small source files (`ExtensionHost.ts`, `ExtensionRuntime.ts`, `capabilityRegistry.ts`, `contributionAdapterRegistry.ts`) with co-located vitest suites; types all come from `folyn-extension-sdk`.

---

## Quick Reference

- **Tech**: TypeScript, vitest; single dependency `folyn-extension-sdk` (`workspace:*`)
- **Pattern**: kernel (`ExtensionHost`) + injected policy (loaders via `registerLoader`, capability via `setHooks`/providers, contribution wiring via adapters)
- **Consumed by**: `apps/desktop/src/services/extension-host/` (real loaders, hooks, adapters)
- **Architecture**: repo-root `extension-system.SPEC.md`

---

**Language**: All documentation is written in **English**.
