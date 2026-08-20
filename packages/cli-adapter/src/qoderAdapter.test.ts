import { describe, it, expect } from 'vitest';
import {
  translateQoderEvent,
  buildQoderArgs,
  buildQoderShellCommand,
  QoderAdapter,
  type QoderAdapterOptions,
} from './qoderAdapter';
import { quoteShellArg } from './claudeAdapter';
import type { CliStreamEvent } from './types';

const INTL_OPTS: QoderAdapterOptions = {
  id: 'qoder',
  displayName: 'Qoder',
  description: 'Qoder CLI（qodercli -p --output-format stream-json）',
  sidecarName: 'qoder-cli',
  cliPathDefault: 'qodercli',
};

const CN_OPTS: QoderAdapterOptions = {
  id: 'qoder-cn',
  displayName: 'Qoder (China)',
  description: 'Qoder CLI 中国版（qoderclicn -p --output-format stream-json）',
  sidecarName: 'qoder-cli-cn',
  cliPathDefault: 'qoderclicn',
};

describe('translateQoderEvent (qoder JSONL → CliStreamEvent)', () => {
  it('system → session_id (persist for resume)', () => {
    const ev = {
      type: 'system',
      subtype: 'init',
      session_id: '0400f1e3-ced9-4410-ace3-0a3417aea735',
      qodercli_version: '1.1.26',
    };
    expect(translateQoderEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'session_id', sessionId: '0400f1e3-ced9-4410-ace3-0a3417aea735' },
    ]);
  });

  it('system without session_id → [] (defensive)', () => {
    expect(translateQoderEvent({ type: 'system' })).toEqual([]);
  });

  it('assistant text block → text event', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'hello world' }],
      },
      session_id: 'sid',
    };
    expect(translateQoderEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'text', content: 'hello world' },
    ]);
  });

  it('assistant tool_use block → tool_start', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'read_file',
            input: { path: '/tmp/x' },
          },
        ],
      },
    };
    expect(translateQoderEvent(ev)).toEqual<CliStreamEvent[]>([
      {
        type: 'tool_start',
        toolName: 'read_file',
        toolId: 'tu_1',
        toolInput: { path: '/tmp/x' },
      },
    ]);
  });

  it('assistant mixed content (text + tool_use) → both events in order', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'thinking about it' },
          { type: 'tool_use', id: 'tu_2', name: 'bash', input: { cmd: 'ls' } },
        ],
      },
    };
    expect(translateQoderEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'text', content: 'thinking about it' },
      { type: 'tool_start', toolName: 'bash', toolId: 'tu_2', toolInput: { cmd: 'ls' } },
    ]);
  });

  it('assistant tool_use without id → skipped (defensive)', () => {
    const ev = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'bash' }] },
    };
    expect(translateQoderEvent(ev)).toEqual([]);
  });

  it('assistant tool_use without name → tool_start with generic name', () => {
    const ev = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tu_3' }] },
    };
    expect(translateQoderEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'tool_start', toolName: 'tool_use', toolId: 'tu_3', toolInput: {} },
    ]);
  });

  it('assistant text without text field → skipped', () => {
    const ev = { type: 'assistant', message: { content: [{ type: 'text' }] } };
    expect(translateQoderEvent(ev)).toEqual([]);
  });

  it('result success → done', () => {
    const ev = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 100,
      session_id: 'sid',
    };
    expect(translateQoderEvent(ev)).toEqual<CliStreamEvent[]>([{ type: 'done' }]);
  });

  it('result error with string result → error + done', () => {
    const ev = {
      type: 'result',
      subtype: 'failure',
      is_error: true,
      result: 'authentication_failed',
    };
    expect(translateQoderEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'error', content: 'authentication_failed' },
      { type: 'done' },
    ]);
  });

  it('result error without result field → generic error msg + done', () => {
    const ev = { type: 'result', is_error: true };
    expect(translateQoderEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'error', content: 'qoder run failed' },
      { type: 'done' },
    ]);
  });

  it('result without is_error → done (default success)', () => {
    expect(translateQoderEvent({ type: 'result' })).toEqual<CliStreamEvent[]>([{ type: 'done' }]);
  });

  it('unknown event.type → []', () => {
    expect(translateQoderEvent({ type: 'something_unexpected' })).toEqual([]);
  });

  it('non-object input → []', () => {
    expect(translateQoderEvent(null)).toEqual([]);
    expect(translateQoderEvent('not an object')).toEqual([]);
    expect(translateQoderEvent(42)).toEqual([]);
  });
});

describe('buildQoderArgs (qodercli arg vector)', () => {
  it('first send: -p + stream-json + no-persistence + bypass + trailing prompt', () => {
    const args = buildQoderArgs('say hi');
    expect(args[0]).toBe('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--no-session-persistence');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args[args.length - 1]).toBe('say hi');
  });

  it('resume: flags + -r <id> <prompt> (positional id after -r)', () => {
    const args = buildQoderArgs('next prompt', { resumeSessionId: 'sess-abc-123' });
    expect(args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--no-session-persistence',
      '--dangerously-skip-permissions',
      '-r',
      'sess-abc-123',
      'next prompt',
    ]);
  });

  it('resume takes precedence over first-send shape', () => {
    const args = buildQoderArgs('p', { resumeSessionId: 'r-1' });
    expect(args).toContain('-r');
    expect(args[args.indexOf('-r') + 1]).toBe('r-1');
  });

  it('omits -r when resumeSessionId not provided', () => {
    const args = buildQoderArgs('p');
    expect(args).not.toContain('-r');
  });
});

describe('buildQoderShellCommand (cd + exec, stdin closed)', () => {
  it('absolute cliPath + workingDir: cd <dir> && exec <cliPath> … < /dev/null', () => {
    const args = buildQoderArgs('say hi');
    const cmd = buildQoderShellCommand('qodercli', '/vault', args);
    expect(cmd.startsWith(`cd ${quoteShellArg('/vault')} && exec `)).toBe(true);
    expect(cmd).toContain(quoteShellArg('qodercli'));
    expect(cmd).toContain(quoteShellArg('say hi'));
    expect(cmd.endsWith(' < /dev/null')).toBe(true);
  });

  it('no workingDir: just exec (no cd)', () => {
    const cmd = buildQoderShellCommand('qodercli', '', buildQoderArgs('hi'));
    expect(cmd.startsWith('exec ')).toBe(true);
    expect(cmd).not.toContain('cd ');
    expect(cmd.endsWith(' < /dev/null')).toBe(true);
  });

  it('resumes still get < /dev/null (qodercli reads prompt from argv, not stdin)', () => {
    const args = buildQoderArgs('p', { resumeSessionId: 'r-1' });
    const cmd = buildQoderShellCommand('qoderclicn', '/vault', args);
    expect(cmd).toContain('-r');
    expect(cmd).toContain(quoteShellArg('r-1'));
    expect(cmd.endsWith(' < /dev/null')).toBe(true);
  });
});

describe('QoderAdapter (parameterized for intl + cn)', () => {
  it('intl: id/displayName/sidecar/cliPath set from constructor', () => {
    const a = new QoderAdapter(INTL_OPTS);
    expect(a.id).toBe('qoder');
    expect(a.displayName).toBe('Qoder');
    expect(a.description.length).toBeGreaterThan(0);
  });

  it('cn: id/displayName/sidecar/cliPath set from constructor', () => {
    const a = new QoderAdapter(CN_OPTS);
    expect(a.id).toBe('qoder-cn');
    expect(a.displayName).toBe('Qoder (China)');
  });

  it('is not running until send; start sets config without running', async () => {
    const a = new QoderAdapter(INTL_OPTS);
    expect(a.isRunning()).toBe(false);
    await a.start({ cliPath: 'qodercli', workingDir: '/tmp' });
    expect(a.isRunning()).toBe(false);
  });

  it('stop clears running flag', async () => {
    const a = new QoderAdapter(INTL_OPTS);
    await a.start({ cliPath: 'qodercli', workingDir: '/tmp' });
    await a.stop();
    expect(a.isRunning()).toBe(false);
  });

  it('send throws if not started', async () => {
    const a = new QoderAdapter(INTL_OPTS);
    await expect(a.send('hi')).rejects.toThrow(/not started/i);
  });
});

describe('QoderAdapter event bus (inherited from BaseCliAdapter)', () => {
  it('delivers events to registered handlers and removes them on offEvent', () => {
    const a = new QoderAdapter(INTL_OPTS);
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
