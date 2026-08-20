import { describe, it, expect } from 'vitest';
import { translateCodexEvent, buildCodexArgs, buildCodexShellCommand, CodexAdapter } from './codexAdapter';
import { quoteShellArg } from './claudeAdapter';
import type { CliStreamEvent } from './types';

describe('translateCodexEvent (codex JSONL → CliStreamEvent)', () => {
  it('thread.started → session_id (persist for resume)', () => {
    const ev = { type: 'thread.started', thread_id: '01a01c9d-d8e1-7643-a52e-53addc1e25ba' };
    expect(translateCodexEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'session_id', sessionId: '01a01c9d-d8e1-7643-a52e-53addc1e25ba' },
    ]);
  });

  it('turn.started → [] (no payload, skip)', () => {
    expect(translateCodexEvent({ type: 'turn.started' })).toEqual([]);
  });

  it('item.started command_execution → tool_start with command input', () => {
    const ev = {
      type: 'item.started',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: "/bin/zsh -lc 'cat file.txt'",
        aggregated_output: '',
        exit_code: null,
        status: 'in_progress',
      },
    };
    expect(translateCodexEvent(ev)).toEqual<CliStreamEvent[]>([
      {
        type: 'tool_start',
        toolName: 'command_execution',
        toolId: 'item_0',
        toolInput: { command: "/bin/zsh -lc 'cat file.txt'" },
      },
    ]);
  });

  it('item.started agent_message → [] (no useful start payload; text arrives at completed)', () => {
    const ev = { type: 'item.started', item: { id: 'item_1', type: 'agent_message' } };
    expect(translateCodexEvent(ev)).toEqual([]);
  });

  it('item.started apply_patch → tool_start generic (no command field → empty input)', () => {
    const ev = { type: 'item.started', item: { id: 'item_2', type: 'apply_patch' } };
    expect(translateCodexEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'tool_start', toolName: 'apply_patch', toolId: 'item_2', toolInput: {} },
    ]);
  });

  it('item.completed agent_message → text (whole message, NOT a delta)', () => {
    const ev = {
      type: 'item.completed',
      item: { id: 'item_1', type: 'agent_message', text: 'The file contains "test content".' },
    };
    expect(translateCodexEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'text', content: 'The file contains "test content".' },
    ]);
  });

  it('item.completed command_execution → tool_end with aggregated_output', () => {
    const ev = {
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: "/bin/zsh -lc 'cat file.txt'",
        aggregated_output: 'test content here\n',
        exit_code: 0,
        status: 'completed',
      },
    };
    expect(translateCodexEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'tool_end', toolId: 'item_0', toolOutput: 'test content here\n' },
    ]);
  });

  it('item.completed unknown item.type → tool_end with empty output (generic fallback)', () => {
    const ev = { type: 'item.completed', item: { id: 'item_9', type: 'mcp_call' } };
    expect(translateCodexEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'tool_end', toolId: 'item_9', toolOutput: '' },
    ]);
  });

  it('turn.completed → done', () => {
    const ev = {
      type: 'turn.completed',
      usage: { input_tokens: 10747, output_tokens: 16, reasoning_output_tokens: 14 },
    };
    expect(translateCodexEvent(ev)).toEqual<CliStreamEvent[]>([{ type: 'done' }]);
  });

  it('unknown event.type → []', () => {
    expect(translateCodexEvent({ type: 'something_unexpected' })).toEqual([]);
  });

  it('non-object input → []', () => {
    expect(translateCodexEvent(null)).toEqual([]);
    expect(translateCodexEvent('not an object')).toEqual([]);
    expect(translateCodexEvent(42)).toEqual([]);
  });

  it('thread.started without thread_id → [] (defensive against malformed wire data)', () => {
    expect(translateCodexEvent({ type: 'thread.started' })).toEqual([]);
  });

  it('item.completed without item.id → [] (defensive)', () => {
    expect(translateCodexEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'hi' } })).toEqual([]);
  });
});

describe('buildCodexArgs (codex exec arg vector)', () => {
  it('first send: exec + flags + trailing prompt', () => {
    const args = buildCodexArgs('say hi');
    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    // prompt is LAST (trailing positional)
    expect(args[args.length - 1]).toBe('say hi');
  });

  it('resume: exec resume <id> <prompt> <flags...> (positionals first per --help)', () => {
    const args = buildCodexArgs('next prompt', { resumeSessionId: 'thread-abc-123' });
    expect(args).toEqual([
      'exec',
      'resume',
      'thread-abc-123',
      'next prompt',
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
    ]);
  });

  it('resume takes precedence over first-send shape', () => {
    const args = buildCodexArgs('p', { resumeSessionId: 'r-1' });
    expect(args[1]).toBe('resume');
    expect(args[2]).toBe('r-1');
  });

  it('omits resumeSessionId when not provided (no `resume` token)', () => {
    const args = buildCodexArgs('p');
    expect(args).not.toContain('resume');
  });
});

describe('buildCodexShellCommand (cd + exec, stdin closed)', () => {
  it('absolute cliPath + workingDir: cd <dir> && exec <cliPath> … < /dev/null', () => {
    const args = buildCodexArgs('say hi');
    const cmd = buildCodexShellCommand('codex', '/vault', args);
    expect(cmd.startsWith(`cd ${quoteShellArg('/vault')} && exec `)).toBe(true);
    expect(cmd).toContain(quoteShellArg('codex'));
    expect(cmd).toContain(quoteShellArg('say hi'));
    expect(cmd.endsWith(' < /dev/null')).toBe(true);
  });

  it('no workingDir: just exec (no cd)', () => {
    const cmd = buildCodexShellCommand('codex', '', buildCodexArgs('hi'));
    expect(cmd.startsWith('exec ')).toBe(true);
    expect(cmd).not.toContain('cd ');
    expect(cmd.endsWith(' < /dev/null')).toBe(true);
  });

  it('resumes still get < /dev/null (Codex reads prompt from argv, not stdin)', () => {
    const args = buildCodexArgs('p', { resumeSessionId: 'r-1' });
    const cmd = buildCodexShellCommand('codex', '/vault', args);
    expect(cmd).toContain('resume');
    expect(cmd).toContain(quoteShellArg('r-1'));
    expect(cmd.endsWith(' < /dev/null')).toBe(true);
  });
});

describe('CodexAdapter lifecycle (no spawn)', () => {
  it('id/displayName/description are set', () => {
    const a = new CodexAdapter();
    expect(a.id).toBe('codex');
    expect(a.displayName).toBe('Codex');
    expect(a.description.length).toBeGreaterThan(0);
  });

  it('is not running until send; start sets config without running', async () => {
    const a = new CodexAdapter();
    expect(a.isRunning()).toBe(false);
    await a.start({ cliPath: 'codex', workingDir: '/tmp' });
    expect(a.isRunning()).toBe(false);
  });

  it('stop clears running flag', async () => {
    const a = new CodexAdapter();
    await a.start({ cliPath: 'codex', workingDir: '/tmp' });
    await a.stop();
    expect(a.isRunning()).toBe(false);
  });

  it('send throws if not started', async () => {
    const a = new CodexAdapter();
    await expect(a.send('hi')).rejects.toThrow(/not started/i);
  });
});

describe('CodexAdapter event bus', () => {
  it('delivers events to registered handlers and removes them on offEvent', () => {
    const a = new CodexAdapter();
    const received: string[] = [];
    const handler = (e: { type: string }) => received.push(e.type);
    a.onEvent(handler);
    (a as unknown as { emit: (e: { type: string }) => void }).emit({ type: 'text' });
    (a as unknown as { emit: (e: { type: string }) => void }).emit({ type: 'done' });
    expect(received).toEqual(['text', 'done']);
    a.offEvent(handler);
    (a as unknown as { emit: (e: { type: string }) => void }).emit({ type: 'error' });
    expect(received).toEqual(['text', 'done']);
  });
});
