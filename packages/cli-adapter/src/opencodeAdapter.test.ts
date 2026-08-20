import { describe, it, expect } from 'vitest';
import {
  translateOpencodeEvent,
  buildOpencodeArgs,
  buildOpencodeShellCommand,
  resolveOpencodeCliPath,
  OpencodeAdapter,
} from './opencodeAdapter';
import { quoteShellArg } from './claudeAdapter';
import type { CliStreamEvent } from './types';

describe('translateOpencodeEvent (opencode NDJSON → CliStreamEvent)', () => {
  it('step_start → session_id (persist for resume)', () => {
    const ev = {
      type: 'step_start',
      timestamp: 1787201906425,
      sessionID: 'ses_fe2771f9fffek0fYnCyPJEvBqU',
      part: {
        id: 'prt_01d88e6f6001K1c1v6kC04WObi',
        messageID: 'msg_01d88e1d1001lvRfAs5i4gIvSP',
        sessionID: 'ses_fe2771f9fffek0fYnCyPJEvBqU',
        type: 'step-start',
      },
    };
    expect(translateOpencodeEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'session_id', sessionId: 'ses_fe2771f9fffek0fYnCyPJEvBqU' },
    ]);
  });

  it('step_start without sessionID → [] (defensive)', () => {
    expect(translateOpencodeEvent({ type: 'step_start' })).toEqual([]);
  });

  it('text → text event', () => {
    const ev = {
      type: 'text',
      timestamp: 1787201907266,
      sessionID: 'ses_x',
      part: { type: 'text', text: 'Hi!' },
    };
    expect(translateOpencodeEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'text', content: 'Hi!' },
    ]);
  });

  it('text without part.text → skipped', () => {
    expect(translateOpencodeEvent({ type: 'text', part: { type: 'text' } })).toEqual([]);
  });

  it('tool_use completed → tool_start + tool_end (fused event)', () => {
    const ev = {
      type: 'tool_use',
      timestamp: 1787201913861,
      sessionID: 'ses_y',
      part: {
        type: 'tool',
        tool: 'write',
        callID: 'call_00_U8OlS51kSIMFHsQWj7lf3455',
        state: {
          status: 'completed',
          input: { filePath: '/tmp/hello.txt', content: 'hi' },
          output: 'Wrote file successfully.',
          metadata: { filepath: '/tmp/hello.txt' },
          title: '/tmp/hello.txt',
        },
      },
    };
    expect(translateOpencodeEvent(ev)).toEqual<CliStreamEvent[]>([
      {
        type: 'tool_start',
        toolName: 'write',
        toolId: 'call_00_U8OlS51kSIMFHsQWj7lf3455',
        toolInput: { filePath: '/tmp/hello.txt', content: 'hi' },
      },
      {
        type: 'tool_end',
        toolId: 'call_00_U8OlS51kSIMFHsQWj7lf3455',
        toolOutput: 'Wrote file successfully.',
      },
    ]);
  });

  it('tool_use running → tool_start only (long-running tool first event)', () => {
    const ev = {
      type: 'tool_use',
      sessionID: 'ses_y',
      part: {
        type: 'tool',
        tool: 'bash',
        callID: 'call_01',
        state: { status: 'running', input: { command: 'ls' } },
      },
    };
    expect(translateOpencodeEvent(ev)).toEqual<CliStreamEvent[]>([
      {
        type: 'tool_start',
        toolName: 'bash',
        toolId: 'call_01',
        toolInput: { command: 'ls' },
      },
    ]);
  });

  it('tool_use error → tool_start + error (with output as message)', () => {
    const ev = {
      type: 'tool_use',
      sessionID: 'ses_y',
      part: {
        type: 'tool',
        tool: 'bash',
        callID: 'call_02',
        state: { status: 'error', input: { command: 'bad-cmd' }, output: 'command not found' },
      },
    };
    expect(translateOpencodeEvent(ev)).toEqual<CliStreamEvent[]>([
      {
        type: 'tool_start',
        toolName: 'bash',
        toolId: 'call_02',
        toolInput: { command: 'bad-cmd' },
      },
      { type: 'error', content: 'command not found' },
    ]);
  });

  it('tool_use error without output → generic error message', () => {
    const ev = {
      type: 'tool_use',
      sessionID: 'ses_y',
      part: {
        type: 'tool',
        tool: 'bash',
        callID: 'call_03',
        state: { status: 'error', input: {} },
      },
    };
    expect(translateOpencodeEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'tool_start', toolName: 'bash', toolId: 'call_03', toolInput: {} },
      { type: 'error', content: 'opencode tool failed' },
    ]);
  });

  it('tool_use without callID → skipped (defensive)', () => {
    const ev = {
      type: 'tool_use',
      part: { type: 'tool', tool: 'write', state: { status: 'completed' } },
    };
    expect(translateOpencodeEvent(ev)).toEqual([]);
  });

  it('tool_use without tool name → tool_start with generic name', () => {
    const ev = {
      type: 'tool_use',
      sessionID: 'ses_y',
      part: {
        type: 'tool',
        callID: 'call_04',
        state: { status: 'completed', input: {}, output: 'ok' },
      },
    };
    expect(translateOpencodeEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'tool_start', toolName: 'tool_use', toolId: 'call_04', toolInput: {} },
      { type: 'tool_end', toolId: 'call_04', toolOutput: 'ok' },
    ]);
  });

  it('tool_use without state → treated as completed (defensive fused)', () => {
    const ev = {
      type: 'tool_use',
      sessionID: 'ses_y',
      part: { type: 'tool', tool: 'read', callID: 'call_05' },
    };
    expect(translateOpencodeEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'tool_start', toolName: 'read', toolId: 'call_05', toolInput: {} },
      { type: 'tool_end', toolId: 'call_05', toolOutput: '' },
    ]);
  });

  it('step_finish → [] (ignored — close is the done signal)', () => {
    const ev = {
      type: 'step_finish',
      timestamp: 1787201907266,
      sessionID: 'ses_x',
      part: {
        id: 'prt_01d88ea2f001WeJAZGx0XiK6Tx',
        reason: 'stop',
        messageID: 'msg_01d88e1d1001lvRfAs5i4gIvSP',
        sessionID: 'ses_x',
        type: 'step-finish',
        tokens: { total: 12719, input: 12705, output: 3, reasoning: 11 },
        cost: 0.00178262,
      },
    };
    expect(translateOpencodeEvent(ev)).toEqual([]);
  });

  it('unknown event.type → []', () => {
    expect(translateOpencodeEvent({ type: 'something_unexpected' })).toEqual([]);
  });

  it('non-object input → []', () => {
    expect(translateOpencodeEvent(null)).toEqual([]);
    expect(translateOpencodeEvent('not an object')).toEqual([]);
    expect(translateOpencodeEvent(42)).toEqual([]);
  });
});

describe('buildOpencodeArgs (opencode arg vector)', () => {
  it('first send: run + --format json + --auto + trailing prompt', () => {
    const args = buildOpencodeArgs('say hi');
    expect(args[0]).toBe('run');
    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(args).toContain('--auto');
    // ponytail: opencode does NOT need --dangerously-skip-permissions —
    // --auto is its autonomy flag (research §5).
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args[args.length - 1]).toBe('say hi');
  });

  it('resume: flags + -s <id> <prompt> (positional id after -s)', () => {
    const args = buildOpencodeArgs('next prompt', { resumeSessionId: 'ses_abc123' });
    expect(args).toEqual(['run', '--format', 'json', '--auto', '-s', 'ses_abc123', 'next prompt']);
  });

  it('resume takes precedence over first-send shape', () => {
    const args = buildOpencodeArgs('p', { resumeSessionId: 'ses_r1' });
    expect(args).toContain('-s');
    expect(args[args.indexOf('-s') + 1]).toBe('ses_r1');
  });

  it('omits -s when resumeSessionId not provided', () => {
    const args = buildOpencodeArgs('p');
    expect(args).not.toContain('-s');
  });
});

describe('buildOpencodeShellCommand (cd + exec, stdin closed defensively)', () => {
  it('absolute cliPath + workingDir: cd <dir> && exec <cliPath> … < /dev/null', () => {
    const args = buildOpencodeArgs('say hi');
    const cmd = buildOpencodeShellCommand('opencode', '/vault', args);
    expect(cmd.startsWith(`cd ${quoteShellArg('/vault')} && exec `)).toBe(true);
    expect(cmd).toContain(quoteShellArg('opencode'));
    expect(cmd).toContain(quoteShellArg('say hi'));
    expect(cmd.endsWith(' < /dev/null')).toBe(true);
  });

  it('no workingDir: just exec (no cd)', () => {
    const cmd = buildOpencodeShellCommand('opencode', '', buildOpencodeArgs('hi'));
    expect(cmd.startsWith('exec ')).toBe(true);
    expect(cmd).not.toContain('cd ');
    expect(cmd.endsWith(' < /dev/null')).toBe(true);
  });

  it('resume still gets < /dev/null (opencode reads prompt from argv, not stdin)', () => {
    const args = buildOpencodeArgs('p', { resumeSessionId: 'ses_r1' });
    const cmd = buildOpencodeShellCommand('opencode', '/vault', args);
    expect(cmd).toContain('-s');
    expect(cmd).toContain(quoteShellArg('ses_r1'));
    expect(cmd.endsWith(' < /dev/null')).toBe(true);
  });
});

describe('OpencodeAdapter', () => {
  it('id/displayName/description set as static values (no parameterization needed)', () => {
    const a = new OpencodeAdapter();
    expect(a.id).toBe('opencode');
    expect(a.displayName).toBe('opencode');
    expect(a.description.length).toBeGreaterThan(0);
  });

  it('is not running until send; start sets config without running', async () => {
    const a = new OpencodeAdapter();
    expect(a.isRunning()).toBe(false);
    await a.start({ cliPath: 'opencode', workingDir: '/tmp' });
    expect(a.isRunning()).toBe(false);
  });

  it('stop clears running flag', async () => {
    const a = new OpencodeAdapter();
    await a.start({ cliPath: 'opencode', workingDir: '/tmp' });
    await a.stop();
    expect(a.isRunning()).toBe(false);
  });

  it('send throws if not started', async () => {
    const a = new OpencodeAdapter();
    await expect(a.send('hi')).rejects.toThrow(/not started/i);
  });
});

describe('resolveOpencodeCliPath (store cliPath → binary name)', () => {
  it('returns cliPathDefault when cliPath is the adapter id (store "unset" sentinel)', () => {
    expect(resolveOpencodeCliPath('opencode', 'opencode', 'opencode')).toBe('opencode');
  });

  it('returns cliPathDefault when cliPath is empty/undefined', () => {
    expect(resolveOpencodeCliPath(undefined, 'opencode', 'opencode')).toBe('opencode');
    expect(resolveOpencodeCliPath('', 'opencode', 'opencode')).toBe('opencode');
  });

  it('returns user-set absolute path unchanged (not treated as sentinel)', () => {
    expect(resolveOpencodeCliPath('/usr/local/bin/opencode', 'opencode', 'opencode')).toBe(
      '/usr/local/bin/opencode',
    );
  });
});
