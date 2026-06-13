# Adapter Implementation Guidelines

> How CLI adapters are built in this package.

---

## Overview

This is a **non-UI library package** — no React components. The guidelines below cover how to implement CLI adapters that integrate with AI CLI tools.

---

## Adapter Pattern

Every adapter implements `CliAdapter` via the `BaseCliAdapter` abstract class:

**Step 1** — Interface contract (defined in `src/types.ts`):
```ts
export interface CliAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  start(config: CliAdapterConfig): Promise<void>;
  send(prompt: string, options?: CliSendOptions): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  onEvent(handler: CliEventHandler): void;
  offEvent(handler: CliEventHandler): void;
}
```

**Step 2** — Abstract base class handles event management (`src/baseAdapter.ts`):
```ts
export abstract class BaseCliAdapter implements CliAdapter {
  protected handlers: CliEventHandler[] = [];
  protected config: CliAdapterConfig | null = null;

  abstract start(config: CliAdapterConfig): Promise<void>;
  abstract send(prompt: string, options?: CliSendOptions): Promise<void>;
  abstract stop(): Promise<void>;
  abstract isRunning(): boolean;

  protected emit(event: CliStreamEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}
```

**Step 3** — Concrete adapter (`src/claudeAdapter.ts`):
```ts
export class ClaudeAdapter extends BaseCliAdapter {
  readonly id = 'claude';
  readonly displayName = 'Claude Code';
  readonly description = '...';
  // Spawns CLI via Tauri Command from @tauri-apps/plugin-shell
  // Parses NDJSON stream line by line, emits CliStreamEvents
}
```

Reference: `packages/cli-adapter/src/baseAdapter.ts`, `packages/cli-adapter/src/claudeAdapter.ts`

---

## Stream Event Model

Adapters emit typed events consumed by the AI panel UI:

| Event Type | Description |
|-----------|-------------|
| `text` | Assistant text output |
| `thinking` | Model reasoning/thinking |
| `tool_start` | Tool invocation begins |
| `tool_end` | Tool invocation complete |
| `file_change` | Proposed file edit (with diff) |
| `session_id` | Session identifier for resume |
| `error` | Error occurred |
| `done` | Stream complete |

---

## NDJSON Parsing Pattern

CLI output is parsed line by line with a buffer for partial lines:

```ts
private lineBuffer = '';
// Append chunk, split on newlines, keep incomplete last line
this.lineBuffer += chunk;
const lines = this.lineBuffer.split('\n');
this.lineBuffer = lines.pop() || '';
for (const line of lines) {
  if (line.trim()) {
    const msg = JSON.parse(line) as ClaudeStreamMessage;
    this.processMessage(msg);
  }
}
```

---

## Common Mistakes

- Spawning processes with raw `child_process` — use Tauri shell plugin `Command` API
- Forgetting to clear buffers and maps in `stop()` — causes stale data on next `send()`
- Not handling partial NDJSON lines — always maintain a line buffer
