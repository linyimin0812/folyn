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

## Forbidden Patterns

- `any` in public types — use `unknown` for untyped tool inputs: `Record<string, unknown>`
- Leaking internal adapter types through the public interface
