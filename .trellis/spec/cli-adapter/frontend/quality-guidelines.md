# Quality Guidelines

> Code quality standards for the cli-adapter package.

---

## Required Patterns

- All adapters **extend `BaseCliAdapter`** — do not implement `CliAdapter` directly
- Event handler management (`onEvent`/`offEvent`/`emit`) lives in the base class — do not duplicate
- CLI process cleanup in `stop()` — kill child process, clear all buffers and maps, null out references
- NDJSON parsing uses a **line buffer** for partial lines — never assume complete lines
- Session resume supported via `CliSendOptions.resumeSessionId`

---

## Forbidden Patterns

| Pattern | Why | Alternative |
|---------|-----|-------------|
| Raw `child_process.spawn` | Not available in Tauri webview | Tauri shell plugin `Command` API |
| Synchronous stream processing | Blocks event loop | Async event handling |
| Leaking child process handles | Prevents cleanup | Null references in `stop()` |
| Direct state mutation from event handlers | Bypasses store | Emit events, let consumer update state |

---

## Testing

No test suite currently exists for this package. When adding tests:
- Mock the Tauri shell plugin `Command` API
- Test NDJSON parsing with fixture streams
- Verify event emission order and content

---

## Code Review Checklist

- [ ] Adapter extends `BaseCliAdapter`
- [ ] `stop()` cleans up all resources (process, buffers, maps)
- [ ] NDJSON parser handles partial lines via buffer
- [ ] Session ID tracked for resume capability
- [ ] No `any` types in public interfaces
- [ ] Internal parsing types not exported from `index.ts`
