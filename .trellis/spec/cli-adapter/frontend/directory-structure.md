# Directory Structure

> How the cli-adapter package is organized.

---

## Directory Layout

```
packages/cli-adapter/
├── index.ts              # Barrel exports — all public types and classes
├── package.json          # @mochi/cli-adapter
├── tsconfig.json
└── src/
    ├── types.ts          # CliAdapter interface, CliMessage, CliStreamEvent,
    │                     #   FileChange, ToolCallInfo, CliAdapterConfig, etc.
    ├── baseAdapter.ts    # BaseCliAdapter abstract class (event handler management)
    ├── claudeAdapter.ts  # ClaudeAdapter — Claude Code CLI via Tauri shell plugin
    └── registry.ts       # CliAdapterRegistry singleton + registerBuiltinAdapters()
```

---

## Module Organization

- **Flat structure** — all source files live directly in `src/`, no subdirectories
- **Types centralized** — all shared interfaces and type definitions in `types.ts`
- **One concrete adapter per file** — `claudeAdapter.ts` contains the Claude Code implementation
- **Registry singleton** — `CliAdapterRegistry.getInstance()` pattern, `registerBuiltinAdapters()` registers all built-in adapters at once

---

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Adapter class | `<Name>Adapter` | `ClaudeAdapter` |
| Base class | `Base<Name>` | `BaseCliAdapter` |
| Registry | `<Name>Registry` | `CliAdapterRegistry` |
| Type interfaces | Descriptive nouns | `CliMessage`, `FileChange`, `ToolCallInfo` |

---

## Adding a New Adapter

1. Create `src/<name>Adapter.ts` extending `BaseCliAdapter`
2. Implement `start()`, `send()`, `stop()`, `isRunning()`
3. Add the adapter to `registerBuiltinAdapters()` in `registry.ts`
4. Export from `index.ts`

Reference: `packages/cli-adapter/src/claudeAdapter.ts`
