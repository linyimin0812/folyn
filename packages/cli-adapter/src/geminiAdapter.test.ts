import { describe, it, expect } from 'vitest';
import {
  translateGeminiEvent,
  buildGeminiArgs,
  buildGeminiShellCommand,
  resolveGeminiCliPath,
  isGeminiStderrNoise,
  GeminiAdapter,
} from './geminiAdapter';
import { quoteShellArg } from './claudeAdapter';
import type { CliStreamEvent } from './types';

describe('translateGeminiEvent (gemini NDJSON → CliStreamEvent)', () => {
  it('init → session_id (persist for resume)', () => {
    const ev = {
      type: 'init',
      timestamp: '2026-08-20T05:51:13.362Z',
      session_id: 'fcd131a3-3f47-4901-90a0-26d6e35ffabe',
      model: 'auto',
    };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'session_id', sessionId: 'fcd131a3-3f47-4901-90a0-26d6e35ffabe' },
    ]);
  });

  it('init without session_id → [] (defensive)', () => {
    expect(translateGeminiEvent({ type: 'init' })).toEqual([]);
  });

  it('message role=assistant → text event (each delta emitted independently)', () => {
    const ev = {
      type: 'message',
      timestamp: '2026-08-20T05:51:13.500Z',
      role: 'assistant',
      content: 'Hello',
      delta: true,
    };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'text', content: 'Hello' },
    ]);
  });

  it('message role=user (prompt echo) → [] (no UI value)', () => {
    const ev = {
      type: 'message',
      timestamp: '2026-08-20T05:51:13.363Z',
      role: 'user',
      content: 'say hi in one word',
    };
    expect(translateGeminiEvent(ev)).toEqual([]);
  });

  it('message without role/content → []', () => {
    expect(translateGeminiEvent({ type: 'message' })).toEqual([]);
  });

  it('tool_use → tool_start (result comes as separate tool_result event)', () => {
    const ev = {
      type: 'tool_use',
      timestamp: '2026-08-20T05:51:14.000Z',
      tool_name: 'write_file',
      tool_id: 'call_001',
      parameters: { path: '/tmp/hello.txt', content: 'hi' },
    };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      {
        type: 'tool_start',
        toolName: 'write_file',
        toolId: 'call_001',
        toolInput: { path: '/tmp/hello.txt', content: 'hi' },
      },
    ]);
  });

  it('tool_use without tool_name → tool_start with generic name', () => {
    const ev = {
      type: 'tool_use',
      tool_id: 'call_002',
      parameters: { command: 'ls' },
    };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      {
        type: 'tool_start',
        toolName: 'tool_use',
        toolId: 'call_002',
        toolInput: { command: 'ls' },
      },
    ]);
  });

  it('tool_use without tool_id → [] (defensive)', () => {
    expect(translateGeminiEvent({ type: 'tool_use', tool_name: 'read_file' })).toEqual([]);
  });

  it('tool_use without parameters → tool_start with empty input', () => {
    const ev = { type: 'tool_use', tool_id: 'call_003', tool_name: 'list_directory' };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      {
        type: 'tool_start',
        toolName: 'list_directory',
        toolId: 'call_003',
        toolInput: {},
      },
    ]);
  });

  it('tool_result success → tool_end', () => {
    const ev = {
      type: 'tool_result',
      timestamp: '2026-08-20T05:51:14.500Z',
      tool_id: 'call_001',
      status: 'success',
      output: 'Wrote /tmp/hello.txt',
    };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'tool_end', toolId: 'call_001', toolOutput: 'Wrote /tmp/hello.txt' },
    ]);
  });

  it('tool_result error → tool_end + error (error.message)', () => {
    const ev = {
      type: 'tool_result',
      tool_id: 'call_004',
      status: 'error',
      error: { type: 'FileNotFound', message: 'path does not exist' },
    };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'tool_end', toolId: 'call_004', toolOutput: '' },
      { type: 'error', content: 'path does not exist' },
    ]);
  });

  it('tool_result error without error.message → generic error message', () => {
    const ev = {
      type: 'tool_result',
      tool_id: 'call_005',
      status: 'error',
    };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'tool_end', toolId: 'call_005', toolOutput: '' },
      { type: 'error', content: 'gemini tool failed' },
    ]);
  });

  it('tool_result without tool_id → [] (defensive)', () => {
    expect(translateGeminiEvent({ type: 'tool_result', status: 'success' })).toEqual([]);
  });

  it('error severity=error → error event (fatal)', () => {
    const ev = {
      type: 'error',
      timestamp: '2026-08-20T05:51:15.000Z',
      severity: 'error',
      message: 'MaxSessionTurns exceeded',
    };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'error', content: 'MaxSessionTurns exceeded' },
    ]);
  });

  it('error severity=warning → [] (run continues, not terminal)', () => {
    const ev = {
      type: 'error',
      severity: 'warning',
      message: 'LoopDetected',
    };
    expect(translateGeminiEvent(ev)).toEqual([]);
  });

  it('error without severity → [] (defensive — treat as non-fatal)', () => {
    expect(translateGeminiEvent({ type: 'error', message: 'something' })).toEqual([]);
  });

  it('result status=success → done (terminal)', () => {
    const ev = {
      type: 'result',
      timestamp: '2026-08-20T05:51:16.000Z',
      status: 'success',
      stats: { total_tokens: 42, duration_ms: 1500, tool_calls: 1 },
    };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([{ type: 'done' }]);
  });

  it('result status=error → error + done (terminal)', () => {
    const ev = {
      type: 'result',
      status: 'error',
      error: { type: 'InvalidStream', message: 'stream corrupted' },
      stats: {},
    };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'error', content: 'stream corrupted' },
      { type: 'done' },
    ]);
  });

  it('result status=error without error.message → generic error + done', () => {
    const ev = { type: 'result', status: 'error' };
    expect(translateGeminiEvent(ev)).toEqual<CliStreamEvent[]>([
      { type: 'error', content: 'gemini run failed' },
      { type: 'done' },
    ]);
  });

  it('result without status → done (defensive — treat as terminal success)', () => {
    expect(translateGeminiEvent({ type: 'result' })).toEqual<CliStreamEvent[]>([{ type: 'done' }]);
  });

  it('unknown event.type → []', () => {
    expect(translateGeminiEvent({ type: 'something_unexpected' })).toEqual([]);
  });

  it('non-object input → []', () => {
    expect(translateGeminiEvent(null)).toEqual([]);
    expect(translateGeminiEvent('not an object')).toEqual([]);
    expect(translateGeminiEvent(42)).toEqual([]);
  });
});

describe('buildGeminiArgs (gemini arg vector)', () => {
  it('first send: -p <prompt> -o stream-json -y --skip-trust', () => {
    const args = buildGeminiArgs('say hi');
    expect(args[0]).toBe('-p');
    expect(args[1]).toBe('say hi');
    expect(args).toContain('-o');
    expect(args).toContain('stream-json');
    expect(args).toContain('-y');
    expect(args).toContain('--skip-trust');
    // ponytail: Gemini uses -y/--yolo as its autonomy flag (research §2);
    // no --dangerously-skip-permissions or --auto.
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--auto');
  });

  it('resume: flags + -r <id>', () => {
    const args = buildGeminiArgs('next prompt', { resumeSessionId: 'fcd131a3-abc' });
    expect(args).toEqual([
      '-p',
      'next prompt',
      '-o',
      'stream-json',
      '-y',
      '--skip-trust',
      '-r',
      'fcd131a3-abc',
    ]);
  });

  it('omits -r when resumeSessionId not provided', () => {
    const args = buildGeminiArgs('p');
    expect(args).not.toContain('-r');
  });
});

describe('buildGeminiShellCommand ($SHELL -lic for nvm, stdin closed for latency)', () => {
  // ponytail: the inner command (cd + exec + cli args + < /dev/null) is
  // single-quote-wrapped for the outer `$SHELL -lic` arg. Single quotes
  // inside the inner command are escaped as `'\''` by `quoteShellArg`,
  // so assertions check the escaped form (or parse the inner out).

  it('uses $SHELL -lic when shell is provided (loads nvm → correct node)', () => {
    const args = buildGeminiArgs('say hi');
    const cmd = buildGeminiShellCommand('gemini', '/vault', args, '/bin/zsh');
    // Outer: $SHELL -lic '<inner>'.
    expect(cmd.startsWith(`${quoteShellArg('/bin/zsh')} -lic `)).toBe(true);
    // Inner is single-quote-wrapped; the literal `cd '/vault' && exec ` from
    // quoteShellArg('/vault') is escaped as `cd '\''/vault'\'' && exec `
    // (each `'` becomes `'\''` inside the outer single quotes).
    expect(cmd).toContain(`cd '\\''/vault'\\'' && exec `);
    expect(cmd).toContain('< /dev/null');
    // Verify the prompt arg (`'say hi'`) survived — escaped as `'\''say hi'\''`.
    expect(cmd).toContain(`'\\''say hi'\\''`);
  });

  it('falls back to /bin/sh -lc when shell is empty (no $SHELL env)', () => {
    const cmd = buildGeminiShellCommand('gemini', '/vault', buildGeminiArgs('hi'), '');
    expect(cmd.startsWith(`${quoteShellArg('/bin/sh')} -lc `)).toBe(true);
    expect(cmd).toContain('< /dev/null');
  });

  it('no workingDir: inner starts with exec (no cd)', () => {
    const cmd = buildGeminiShellCommand('gemini', '', buildGeminiArgs('hi'), '/bin/zsh');
    // Extract the inner command (between the outer -lic's opening `'` and
    // the final closing `'`). After unescaping, it should start with exec.
    const innerMatch = cmd.match(/-lic '(.+)'$/);
    expect(innerMatch).not.toBeNull();
    const inner = innerMatch![1].replace(/'\\''/g, "'");
    expect(inner.startsWith('exec ')).toBe(true);
    expect(inner).not.toContain('cd ');
    expect(inner.endsWith(' < /dev/null')).toBe(true);
  });

  it('resume still carries -r <id> + < /dev/null in the inner command', () => {
    const args = buildGeminiArgs('p', { resumeSessionId: 'fcd131a3-r1' });
    const cmd = buildGeminiShellCommand('gemini', '/vault', args, '/bin/zsh');
    const innerMatch = cmd.match(/-lic '(.+)'$/);
    expect(innerMatch).not.toBeNull();
    const inner = innerMatch![1].replace(/'\\''/g, "'");
    expect(inner).toContain('-r');
    expect(inner).toContain(quoteShellArg('fcd131a3-r1'));
    expect(inner.endsWith(' < /dev/null')).toBe(true);
  });
});

describe('isGeminiStderrNoise (version-manager banner filter)', () => {
  it('filters sdkman java version banner', () => {
    expect(isGeminiStderrNoise('Using java version 8.0.382-zulu in this shell.')).toBe(true);
  });

  it('filters ensa/rtx "Using the" banner', () => {
    expect(isGeminiStderrNoise('Using the node version 25.9.0')).toBe(true);
  });

  it('filters zsh job-control warnings on non-TTY interactive shell', () => {
    expect(isGeminiStderrNoise('zsh: job control disabled in this shell')).toBe(true);
    expect(isGeminiStderrNoise('no tty; cannot set job control')).toBe(true);
  });

  it('filters ASCII-art banners', () => {
    expect(isGeminiStderrNoise('__________')).toBe(true);
    expect(isGeminiStderrNoise('====')).toBe(true);
  });

  it('filters empty/whitespace lines', () => {
    expect(isGeminiStderrNoise('')).toBe(true);
    expect(isGeminiStderrNoise('   \t  ')).toBe(true);
  });

  it('does NOT filter real gemini errors', () => {
    expect(isGeminiStderrNoise('Error: stream corrupted')).toBe(false);
    expect(isGeminiStderrNoise('[ERROR] MaxSessionTurns exceeded')).toBe(false);
    expect(isGeminiStderrNoise('SyntaxError: Unexpected token')).toBe(false);
    expect(isGeminiStderrNoise('TypeError: fetch failed')).toBe(false);
    expect(isGeminiStderrNoise('Attempt 1 failed. Retrying with backoff...')).toBe(false);
  });
});

describe('GeminiAdapter', () => {
  it('id/displayName/description set as static values', () => {
    const a = new GeminiAdapter();
    expect(a.id).toBe('gemini');
    expect(a.displayName).toBe('Gemini');
    expect(a.description.length).toBeGreaterThan(0);
  });

  it('is not running until send; start sets config without running', async () => {
    const a = new GeminiAdapter();
    expect(a.isRunning()).toBe(false);
    await a.start({ cliPath: 'gemini', workingDir: '/tmp' });
    expect(a.isRunning()).toBe(false);
  });

  it('stop clears running flag', async () => {
    const a = new GeminiAdapter();
    await a.start({ cliPath: 'gemini', workingDir: '/tmp' });
    await a.stop();
    expect(a.isRunning()).toBe(false);
  });

  it('send throws if not started', async () => {
    const a = new GeminiAdapter();
    await expect(a.send('hi')).rejects.toThrow(/not started/i);
  });
});

describe('resolveGeminiCliPath (store cliPath → binary name)', () => {
  it('returns cliPathDefault when cliPath is the adapter id (store "unset" sentinel)', () => {
    expect(resolveGeminiCliPath('gemini', 'gemini', 'gemini')).toBe('gemini');
  });

  it('returns cliPathDefault when cliPath is empty/undefined', () => {
    expect(resolveGeminiCliPath(undefined, 'gemini', 'gemini')).toBe('gemini');
    expect(resolveGeminiCliPath('', 'gemini', 'gemini')).toBe('gemini');
  });

  it('returns user-set absolute path unchanged (not treated as sentinel)', () => {
    expect(resolveGeminiCliPath('/usr/local/bin/gemini', 'gemini', 'gemini')).toBe(
      '/usr/local/bin/gemini',
    );
  });
});
