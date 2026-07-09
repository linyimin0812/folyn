import type { CliAdapter, CliStreamEvent } from '@quill/cli-adapter';

/** Structured event for UI display during AI streaming */
export interface StreamEvent {
  kind: 'thinking' | 'text' | 'tool';
  content: string;
  /** Tool input summary (for kind: 'tool') */
  detail?: string;
  /** Tool output summary (for tool_end events) */
  output?: string;
}

/**
 * Defensive JSON extractor: pull the first `{ ... }` object out of an AI
 * response that may be wrapped in prose or code fences. Greedy — matches to
 * the last `}`. Returns the raw JSON string slice, or null if no object-shaped
 * substring is found. Callers `JSON.parse` the result and handle parse errors.
 */
export function extractJsonObject(aiText: string): string | null {
  const match = aiText.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

/**
 * Collect all text output from a CLI adapter stream until 'done' or 'error'.
 * Shared between wikiIngestService and clipService.
 *
 * @param adapter - The CLI adapter to listen on
 * @param onChunk - Optional callback fired for each text chunk (simple string)
 * @param onEvent - Optional callback fired for structured events (thinking, text, tool)
 */
export function collectTextFromStream(
  adapter: CliAdapter,
  onChunk?: (text: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const toolNameMap = new Map<string, string>();
    const handler = (event: CliStreamEvent) => {
      if (event.type === 'text' && event.content) {
        text += event.content;
        onChunk?.(event.content);
        onEvent?.({ kind: 'text', content: event.content });
      }
      if (event.type === 'thinking' && event.content) {
        onEvent?.({ kind: 'thinking', content: event.content });
      }
      if (event.type === 'tool_start' && event.toolName) {
        if (event.toolId) toolNameMap.set(event.toolId, event.toolName);
        const detail = formatToolInput(event.toolName, event.toolInput);
        onEvent?.({ kind: 'tool', content: event.toolName, detail });
      }
      if (event.type === 'tool_end') {
        const name = event.toolName || (event.toolId ? toolNameMap.get(event.toolId) : undefined);
        const output = event.toolOutput
          ? (event.toolOutput.length > 200 ? event.toolOutput.slice(0, 200) + '...' : event.toolOutput)
          : undefined;
        if (name) {
          onEvent?.({ kind: 'tool', content: name, output: output || 'done' });
        }
      }
      if (event.type === 'error') {
        adapter.offEvent(handler);
        reject(new Error(event.content || 'LLM error'));
      }
      if (event.type === 'done') {
        adapter.offEvent(handler);
        resolve(text.trim());
      }
    };
    adapter.onEvent(handler);
  });
}

/** Format tool input into a compact display string */
function formatToolInput(toolName: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  switch (toolName) {
    case 'Bash':
    case 'bash': {
      const cmd = input['command'];
      if (typeof cmd === 'string') {
        return cmd.length > 200 ? cmd.slice(0, 200) + '...' : cmd;
      }
      return undefined;
    }
    case 'Read':
    case 'read':
      return typeof input['file_path'] === 'string' ? input['file_path'] : undefined;
    case 'Write':
    case 'write':
      return typeof input['file_path'] === 'string' ? input['file_path'] : undefined;
    case 'Edit':
    case 'edit':
      return typeof input['file_path'] === 'string' ? input['file_path'] : undefined;
    case 'Glob':
    case 'glob':
      return typeof input['pattern'] === 'string' ? input['pattern'] : undefined;
    case 'Grep':
    case 'grep':
      return typeof input['pattern'] === 'string' ? input['pattern'] : undefined;
    case 'WebFetch':
    case 'web_fetch':
      return typeof input['url'] === 'string' ? input['url'] : undefined;
    default: {
      // Generic: show first meaningful value
      const keys = Object.keys(input);
      if (keys.length === 0) return undefined;
      const val = input[keys[0]];
      if (typeof val === 'string') {
        return val.length > 200 ? val.slice(0, 200) + '...' : val;
      }
      return undefined;
    }
  }
}
