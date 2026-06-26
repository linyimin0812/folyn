import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseCliAdapter } from './baseAdapter';
import { ClaudeAdapter } from './claudeAdapter';
import type { CliAdapterConfig, CliStreamEvent } from './types';
import { writeTextFile } from '@tauri-apps/plugin-fs';

/** A minimal concrete subclass so the abstract BaseCliAdapter can be exercised directly. */
class TestAdapter extends BaseCliAdapter {
  readonly id = 'test';
  readonly displayName = 'Test Adapter';
  readonly description = 'A test adapter';
  private running = false;

  async start(config: CliAdapterConfig): Promise<void> {
    this.config = config;
    this.running = false;
  }

  async send(_prompt: string): Promise<void> {
    if (!this.config) throw new Error('Adapter not started');
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Exposes the protected config for assertions. */
  getConfig(): CliAdapterConfig | null {
    return this.config;
  }
}

/** Surface for reaching protected/private members of ClaudeAdapter in tests. */
type ClaudeInternals = {
  emit: (event: CliStreamEvent) => void;
  handleStdoutLine: (data: string) => void;
  processEvent: (event: unknown) => void;
};

function internals(adapter: ClaudeAdapter): ClaudeInternals {
  return adapter as unknown as ClaudeInternals;
}

function line(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

// ---------------------------------------------------------------------------
// BaseCliAdapter contract (event bus)
// ---------------------------------------------------------------------------

describe('BaseCliAdapter event bus', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
  });

  it('delivers emitted events to a registered handler', () => {
    const received: string[] = [];
    adapter.onEvent((e) => received.push(e.type));
    internals(adapter as unknown as ClaudeAdapter).emit({ type: 'text', content: 'hi' });
    expect(received).toEqual(['text']);
  });

  it('delivers to multiple handlers in registration order', () => {
    const order: string[] = [];
    adapter.onEvent((e) => order.push(`a:${e.type}`));
    adapter.onEvent((e) => order.push(`b:${e.type}`));
    const i = internals(adapter as unknown as ClaudeAdapter);
    i.emit({ type: 'text' });
    i.emit({ type: 'done' });
    expect(order).toEqual(['a:text', 'b:text', 'a:done', 'b:done']);
  });

  it('offEvent removes only the targeted handler', () => {
    const a: string[] = [];
    const b: string[] = [];
    const handlerA = (e: CliStreamEvent) => a.push(e.type);
    const handlerB = (e: CliStreamEvent) => b.push(e.type);
    adapter.onEvent(handlerA);
    adapter.onEvent(handlerB);
    const i = internals(adapter as unknown as ClaudeAdapter);
    i.emit({ type: 'text' });
    adapter.offEvent(handlerA);
    i.emit({ type: 'done' });
    expect(a).toEqual(['text']);
    expect(b).toEqual(['text', 'done']);
  });

  it('offEvent is a no-op for a handler that was never registered', () => {
    const received: string[] = [];
    adapter.onEvent((e) => received.push(e.type));
    const i = internals(adapter as unknown as ClaudeAdapter);
    // Removing an unregistered handler must not throw or affect delivery.
    expect(() => adapter.offEvent(() => undefined)).not.toThrow();
    i.emit({ type: 'text' });
    expect(received).toEqual(['text']);
  });
});

describe('BaseCliAdapter concrete subclass lifecycle', () => {
  it('start stores the config and is not running until send', async () => {
    const adapter = new TestAdapter();
    expect(adapter.isRunning()).toBe(false);
    expect(adapter.getConfig()).toBeNull();
    await adapter.start({ cliPath: 'claude', workingDir: '/proj' });
    expect(adapter.getConfig()).toEqual({ cliPath: 'claude', workingDir: '/proj' });
    expect(adapter.isRunning()).toBe(false);
  });

  it('send throws if the adapter was never started', async () => {
    const adapter = new TestAdapter();
    await expect(adapter.send('hi')).rejects.toThrow(/not started/i);
  });

  it('send flips the running flag on; stop clears it', async () => {
    const adapter = new TestAdapter();
    await adapter.start({ cliPath: 'claude', workingDir: '/proj' });
    await adapter.send('hi');
    expect(adapter.isRunning()).toBe(true);
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ClaudeAdapter stream parsing (driven via the private stdout handler)
// ---------------------------------------------------------------------------

describe('ClaudeAdapter NDJSON stream parsing', () => {
  let adapter: ClaudeAdapter;
  let events: CliStreamEvent[];

  beforeEach(() => {
    adapter = new ClaudeAdapter();
    events = [];
    adapter.onEvent((e) => events.push(e));
    // start stores config — required before any send/parsing path that reads workingDir.
    return adapter.start({ cliPath: 'claude', workingDir: '/proj' });
  });

  it('emits session_id on a system init message', () => {
    internals(adapter).handleStdoutLine(
      line({ type: 'system', subtype: 'init', session_id: 'sess-123' }),
    );
    expect(events.find((e) => e.type === 'session_id')?.sessionId).toBe('sess-123');
  });

  it('buffers a partial line and only emits once the newline arrives', () => {
    const i = internals(adapter);
    i.handleStdoutLine('{"type":"system","subtype":"init","session_id":"');
    expect(events).toHaveLength(0);
    i.handleStdoutLine('abc"}\n');
    expect(events.find((e) => e.type === 'session_id')?.sessionId).toBe('abc');
  });

  it('emits a text event for assistant text blocks', () => {
    internals(adapter).handleStdoutLine(
      line({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello world' }] },
      }),
    );
    expect(events.find((e) => e.type === 'text')?.content).toBe('hello world');
  });

  it('emits a thinking event for assistant thinking blocks', () => {
    internals(adapter).handleStdoutLine(
      line({
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'pondering' }] },
      }),
    );
    expect(events.find((e) => e.type === 'thinking')?.content).toBe('pondering');
  });

  it('emits tool_start for a non-write tool_use block', () => {
    internals(adapter).handleStdoutLine(
      line({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'grep', id: 'tool-1', input: { q: 'x' } }],
        },
      }),
    );
    const start = events.find((e) => e.type === 'tool_start');
    expect(start?.toolName).toBe('grep');
    expect(start?.toolId).toBe('tool-1');
    expect(start?.toolInput).toEqual({ q: 'x' });
  });

  it('emits tool_end when a tool_result arrives in a user message', () => {
    const i = internals(adapter);
    i.handleStdoutLine(
      line({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'grep', id: 'tool-1', input: {} }],
        },
      }),
    );
    events.length = 0;
    i.handleStdoutLine(
      line({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'done' }],
        },
      }),
    );
    const end = events.find((e) => e.type === 'tool_end');
    expect(end?.toolId).toBe('tool-1');
    expect(end?.toolOutput).toBe('done');
  });

  it('emits an error event for an is_error result', () => {
    internals(adapter).handleStdoutLine(
      line({ type: 'result', is_error: true, result: 'boom' }),
    );
    expect(events.find((e) => e.type === 'error')?.content).toBe('boom');
  });

  it('completes still-running tools when a final result arrives', () => {
    const i = internals(adapter);
    // Start a non-write tool — it stays in runningToolIds.
    i.handleStdoutLine(
      line({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'grep', id: 'running-1', input: {} }],
        },
      }),
    );
    events.length = 0;
    i.handleStdoutLine(line({ type: 'result' }));
    expect(events.find((e) => e.type === 'tool_end')?.toolId).toBe('running-1');
  });

  it('ignores non-JSON lines without throwing', () => {
    expect(() => internals(adapter).handleStdoutLine('this is not json\n')).not.toThrow();
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ClaudeAdapter write-tool / pending-file tracking
// ---------------------------------------------------------------------------

describe('ClaudeAdapter write-tool file_change tracking', () => {
  let adapter: ClaudeAdapter;
  let events: CliStreamEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    adapter = new ClaudeAdapter();
    events = [];
    adapter.onEvent((e) => events.push(e));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
  }

  it('emits a file_change when a write tool modifies an existing file', async () => {
    await adapter.start({ cliPath: 'claude', workingDir: '/proj' });
    const absPath = '/proj/src/a.md';
    await writeTextFile(absPath, 'old');

    const i = internals(adapter);
    i.handleStdoutLine(
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'write', id: 'w-1', input: { file_path: absPath } },
          ],
        },
      }),
    );
    // Let snapshotBeforeWrite finish (reads old content + schedules the check timer).
    await flushMicrotasks();
    // Simulate the write tool mutating the file on disk.
    await writeTextFile(absPath, 'new content');

    await vi.advanceTimersByTimeAsync(500);

    const change = events.find((e) => e.type === 'file_change');
    expect(change).toBeDefined();
    expect(change?.fileChange?.path).toBe('src/a.md');
    expect(change?.fileChange?.oldContent).toBe('old');
    expect(change?.fileChange?.newContent).toBe('new content');
    expect(change?.fileChange?.status).toBe('pending');
  });

  it('does not emit a file_change when the file content is unchanged', async () => {
    await adapter.start({ cliPath: 'claude', workingDir: '/proj' });
    const absPath = '/proj/src/unchanged.md';
    await writeTextFile(absPath, 'same');

    const i = internals(adapter);
    i.handleStdoutLine(
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'write', id: 'w-2', input: { file_path: absPath } },
          ],
        },
      }),
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(500);

    expect(events.find((e) => e.type === 'file_change')).toBeUndefined();
  });

  it('ignores tool_use blocks for non-write tools (no snapshot scheduled)', async () => {
    await adapter.start({ cliPath: 'claude', workingDir: '/proj' });
    const i = internals(adapter);
    i.handleStdoutLine(
      line({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'grep', id: 'g-1', input: { q: 'x' } }],
        },
      }),
    );
    await flushMicrotasks();
    // No timer should be scheduled; advancing time must not produce a file_change.
    await vi.advanceTimersByTimeAsync(1000);
    expect(events.find((e) => e.type === 'file_change')).toBeUndefined();
    // The tool_start event is still emitted.
    expect(events.find((e) => e.type === 'tool_start')?.toolName).toBe('grep');
  });
});
