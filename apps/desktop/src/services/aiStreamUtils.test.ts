import { describe, it, expect, vi } from 'vitest';
import type { CliAdapter, CliStreamEvent } from '@mochi/cli-adapter';
import { collectTextFromStream } from './aiStreamUtils';
import type { StreamEvent } from './aiStreamUtils';

function makeAdapter(): CliAdapter & { emit: (e: CliStreamEvent) => void; handlers: Array<(e: CliStreamEvent) => void> } {
  const handlers: Array<(e: CliStreamEvent) => void> = [];
  return {
    id: 'fake',
    displayName: 'fake',
    async start() {},
    async stop() {},
    onEvent(handler) {
      handlers.push(handler);
    },
    offEvent(handler) {
      const i = handlers.indexOf(handler);
      if (i >= 0) handlers.splice(i, 1);
    },
    handlers,
    emit(e) {
      for (const h of handlers) h(e);
    },
  } as unknown as CliAdapter & { emit: (e: CliStreamEvent) => void; handlers: Array<(e: CliStreamEvent) => void> };
}

describe('collectTextFromStream', () => {
  it('accumulates text chunks until done and resolves with the trimmed text', async () => {
    const adapter = makeAdapter();
    const promise = collectTextFromStream(adapter);
    adapter.emit({ type: 'text', content: 'Hello ' });
    adapter.emit({ type: 'text', content: 'world' });
    adapter.emit({ type: 'done' });
    expect(await promise).toBe('Hello world');
  });

  it('fires onChunk for each text chunk', async () => {
    const adapter = makeAdapter();
    const onChunk = vi.fn();
    const promise = collectTextFromStream(adapter, onChunk);
    adapter.emit({ type: 'text', content: 'a' });
    adapter.emit({ type: 'text', content: 'b' });
    adapter.emit({ type: 'done' });
    await promise;
    expect(onChunk).toHaveBeenNthCalledWith(1, 'a');
    expect(onChunk).toHaveBeenNthCalledWith(2, 'b');
  });

  it('fires onEvent with structured events for text, thinking, and tool', async () => {
    const adapter = makeAdapter();
    const events: StreamEvent[] = [];
    const promise = collectTextFromStream(adapter, undefined, (e) => events.push(e));
    adapter.emit({ type: 'thinking', content: 'pondering' });
    adapter.emit({ type: 'text', content: 'hi' });
    adapter.emit({ type: 'tool_start', toolId: 't1', toolName: 'Bash', toolInput: { command: 'ls' } });
    adapter.emit({ type: 'tool_end', toolId: 't1', toolOutput: 'done' });
    adapter.emit({ type: 'done' });
    await promise;

    expect(events).toEqual([
      { kind: 'thinking', content: 'pondering' },
      { kind: 'text', content: 'hi' },
      { kind: 'tool', content: 'Bash', detail: 'ls' },
      { kind: 'tool', content: 'Bash', output: 'done' },
    ]);
  });

  it('truncates long tool outputs to 200 chars with an ellipsis', async () => {
    const adapter = makeAdapter();
    const events: StreamEvent[] = [];
    const promise = collectTextFromStream(adapter, undefined, (e) => events.push(e));
    const longOutput = 'x'.repeat(250);
    adapter.emit({ type: 'tool_start', toolId: 't1', toolName: 'Bash' });
    adapter.emit({ type: 'tool_end', toolId: 't1', toolOutput: longOutput });
    adapter.emit({ type: 'done' });
    await promise;

    const toolEnd = events.find((e) => e.output !== undefined)!;
    expect(toolEnd.output!.endsWith('...')).toBe(true);
    expect(toolEnd.output!.length).toBe(203);
  });

  it('resolves tool name from toolNameMap when tool_end only carries toolId', async () => {
    const adapter = makeAdapter();
    const events: StreamEvent[] = [];
    const promise = collectTextFromStream(adapter, undefined, (e) => events.push(e));
    adapter.emit({ type: 'tool_start', toolId: 't1', toolName: 'Read', toolInput: { file_path: '/a/b.md' } });
    adapter.emit({ type: 'tool_end', toolId: 't1' });
    adapter.emit({ type: 'done' });
    await promise;
    const end = events[events.length - 1];
    expect(end).toMatchObject({ kind: 'tool', content: 'Read', output: 'done' });
  });

  it('rejects on an error event', async () => {
    const adapter = makeAdapter();
    const promise = collectTextFromStream(adapter);
    adapter.emit({ type: 'error', content: 'boom' });
    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects with a default message when error has no content', async () => {
    const adapter = makeAdapter();
    const promise = collectTextFromStream(adapter);
    adapter.emit({ type: 'error' });
    await expect(promise).rejects.toThrow('LLM error');
  });

  it('detaches the handler after done', async () => {
    const adapter = makeAdapter();
    const promise = collectTextFromStream(adapter);
    adapter.emit({ type: 'done' });
    await promise;
    expect(adapter.handlers.length).toBe(0);
  });

  it('formats Bash, Read, Write, Edit, Glob, Grep, WebFetch tool inputs', async () => {
    const adapter = makeAdapter();
    const events: StreamEvent[] = [];
    const promise = collectTextFromStream(adapter, undefined, (e) => events.push(e));
    adapter.emit({ type: 'tool_start', toolName: 'Bash', toolInput: { command: 'echo hi' } });
    adapter.emit({ type: 'tool_start', toolName: 'Read', toolInput: { file_path: '/a.md' } });
    adapter.emit({ type: 'tool_start', toolName: 'Write', toolInput: { file_path: '/b.md' } });
    adapter.emit({ type: 'tool_start', toolName: 'Edit', toolInput: { file_path: '/c.md' } });
    adapter.emit({ type: 'tool_start', toolName: 'Glob', toolInput: { pattern: '**/*.ts' } });
    adapter.emit({ type: 'tool_start', toolName: 'Grep', toolInput: { pattern: 'TODO' } });
    adapter.emit({ type: 'tool_start', toolName: 'WebFetch', toolInput: { url: 'https://x' } });
    adapter.emit({ type: 'done' });
    await promise;
    const details = events.map((e) => e.detail);
    expect(details).toEqual([
      'echo hi',
      '/a.md',
      '/b.md',
      '/c.md',
      '**/*.ts',
      'TODO',
      'https://x',
    ]);
  });

  it('truncates Bash commands longer than 200 chars', async () => {
    const adapter = makeAdapter();
    const events: StreamEvent[] = [];
    const promise = collectTextFromStream(adapter, undefined, (e) => events.push(e));
    const longCmd = 'y'.repeat(250);
    adapter.emit({ type: 'tool_start', toolName: 'Bash', toolInput: { command: longCmd } });
    adapter.emit({ type: 'done' });
    await promise;
    const detail = events[0].detail!;
    expect(detail.length).toBe(203);
    expect(detail.endsWith('...')).toBe(true);
  });

  it('falls back to the first string value for unknown tool names', async () => {
    const adapter = makeAdapter();
    const events: StreamEvent[] = [];
    const promise = collectTextFromStream(adapter, undefined, (e) => events.push(e));
    adapter.emit({ type: 'tool_start', toolName: 'MysteryTool', toolInput: { whatever: 'first-value', other: 'x' } });
    adapter.emit({ type: 'done' });
    await promise;
    expect(events[0].detail).toBe('first-value');
  });

  it('returns undefined detail when tool input has no string values', async () => {
    const adapter = makeAdapter();
    const events: StreamEvent[] = [];
    const promise = collectTextFromStream(adapter, undefined, (e) => events.push(e));
    adapter.emit({ type: 'tool_start', toolName: 'MysteryTool', toolInput: { count: 3, flag: true } });
    adapter.emit({ type: 'done' });
    await promise;
    expect(events[0].detail).toBeUndefined();
  });
});
