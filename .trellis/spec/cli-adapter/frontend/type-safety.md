# Type Safety

> Type patterns in the cli-adapter package.

---

## Type Organization

All types are centralized in `packages/cli-adapter/src/types.ts` and re-exported from `index.ts`:

```ts
// Discriminated union for stream event types
export type CliStreamEventType =
  | 'text' | 'thinking' | 'tool_start' | 'tool_end'
  | 'file_change' | 'session_id' | 'error' | 'done';

// Event payload with optional fields per event type
export interface CliStreamEvent {
  type: CliStreamEventType;
  content?: string;
  toolName?: string;
  toolId?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  fileChange?: FileChange;
  sessionId?: string;
}
```

---

## String Literal Unions for Status

```ts
// File change lifecycle
status: 'pending' | 'accepted' | 'rejected';

// Tool call status
status: 'running' | 'done';

// Message roles
role: 'user' | 'assistant' | 'system';
```

---

## Message and Attachment Types

```ts
export interface CliMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  toolCalls?: ToolCallInfo[];
  attachments?: MessageAttachment[];
  timestamp: number;
}

export interface MessageAttachment {
  name: string;
  path: string;
  type: 'image' | 'file';
  previewUrl?: string;
}
```

---

## Internal CLI Message Types

`ClaudeAdapter` uses a private internal interface for raw CLI output parsing:

```ts
interface ClaudeStreamMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  tool_use_id?: string;
  content?: string;
  message?: {
    content?: { type: string; text?: string; thinking?: string; name?: string;
      id?: string; tool_use_id?: string; input?: Record<string, unknown>; content?: string }[];
  };
  result?: string;
  is_error?: boolean;
}
```

This internal type is NOT exported — it's an implementation detail of the Claude adapter's NDJSON parser.

---

## Extending CliSendOptions (Input Mode Contract)

`CliSendOptions` is the **cross-layer request contract** between the desktop
app (input modes, feature agents) and the CLI adapter. Desktop input modes
(`ask` / `agent` / future) extend it **declaratively**; the adapter's
`buildClaudeArgs` consumes the fields and turns them into CLI flags.

### Signatures

```ts
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export interface CliSendOptions {
  resumeSessionId?: string;
  agent?: string;
  agents?: Record<string, CliAgentDefinition>;
  addDir?: string[];
  bare?: boolean;
  permissionMode?: PermissionMode;   // -> --permission-mode
  systemPrompt?: string;             // -> --append-system-prompt
}
```

### Contracts & Invariants

- **Backward compatibility**: `buildClaudeArgs` MUST default
  `options?.permissionMode ?? 'bypassPermissions'` so callers that don't set it
  keep the historical full-tool behavior. New optional fields must never break
  existing callers.
- **Flag ordering** (enforced by `buildClaudeArgs`):
  base flags → `--bare` → `--append-system-prompt` → `--agent`/`--agents`/`--add-dir`
  → `--resume` → `<prompt>`. `--append-system-prompt` is placed after `--bare`
  and before `--resume` so it is never parsed as part of the prompt.
- **Falsy suppression**: empty-string / undefined `systemPrompt` MUST NOT emit
  `--append-system-prompt`.
- **Defensive merge at the desktop boundary**: `resolveSendOptions(modeId, base)`
  merges a mode's declarative fields onto `base`, then applies the optional
  `buildSendOptions` escape hatch, and MUST return `base` unchanged for an
  unknown `modeId`.

### Validation & Error Matrix

| Condition | Behavior |
|-----------|----------|
| `permissionMode` unset | emit `--permission-mode bypassPermissions` (default) |
| `permissionMode: 'plan'` | emit `--permission-mode plan`, no `bypassPermissions` |
| `systemPrompt: ''` or `undefined` | omit `--append-system-prompt` |
| `systemPrompt: 'be concise'` | emit `--append-system-prompt be concise` |
| unknown `modeId` passed to `resolveSendOptions` | return `base` unchanged, no throw |

### Tests Required

`packages/cli-adapter/src/claudeAdapter.test.ts` — `buildClaudeArgs` must
assert: default permission-mode (backward compat), `plan` override,
`--append-system-prompt` value + empty suppression, and full ordering
(`--append-system-prompt` after `--bare`, before `--agent`/`--resume`).
`apps/desktop/src/components/ai/inputModes.test.ts` — `resolveSendOptions`
must assert declarative merge, escape-hatch override, and unknown-id passthrough.

### Wrong vs Correct

#### Wrong — break the default
```ts
// buildClaudeArgs reads permissionMode with no default
'--permission-mode', options?.permissionMode,   // undefined -> invalid CLI flag value
```

#### Correct
```ts
'--permission-mode', options?.permissionMode ?? 'bypassPermissions',
```

#### Wrong — leak ordering / throw on stale id
```ts
export function resolveSendOptions(modeId: string, base: CliSendOptions) {
  const def = defsById.get(modeId)!;            // throws on stale stored id
  return { ...base, permissionMode: def.permissionMode };
}
```

#### Correct
```ts
export function resolveSendOptions(modeId: string, base: CliSendOptions) {
  const def = defsById.get(modeId);
  if (!def) return base;                         // stale id is safe
  const merged: CliSendOptions = { ...base };
  if (def.permissionMode !== undefined) merged.permissionMode = def.permissionMode;
  if (def.systemPrompt) merged.systemPrompt = def.systemPrompt;
  return def.buildSendOptions ? def.buildSendOptions(merged) : merged;
}
```

---

## Forbidden Patterns

- `any` in public types — use `unknown` for untyped tool inputs: `Record<string, unknown>`
- Leaking internal adapter types through the public interface
