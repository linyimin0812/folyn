import { describe, it, expect } from 'vitest';
import { translatePiEvent, mapClaudeToolsToPi, buildPiSpawnArgs, buildPromptCommand, buildPiShellCommand, splitJsonlLines, PiAdapter, buildAdapterVersionCommand, buildAdapterDetectCommand } from './piAdapter';
import type { CliStreamEvent } from './types';

describe('translatePiEvent (pi JSONL → CliStreamEvent)', () => {
  it('message_update text_delta → text event', () => {
    const pi = {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello ', contentIndex: 0 },
    };
    expect(translatePiEvent(pi)).toEqual<CliStreamEvent[]>([
      { type: 'text', content: 'Hello ' },
    ]);
  });

  it('message_update thinking_delta → thinking event', () => {
    const pi = {
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm', contentIndex: 0 },
    };
    expect(translatePiEvent(pi)).toEqual<CliStreamEvent[]>([
      { type: 'thinking', content: 'hmm' },
    ]);
  });

  it('tool_execution_start → tool_start event', () => {
    const pi = {
      type: 'tool_execution_start',
      toolCallId: 'call_abc123',
      toolName: 'bash',
      args: { command: 'ls -la' },
    };
    expect(translatePiEvent(pi)).toEqual<CliStreamEvent[]>([
      { type: 'tool_start', toolName: 'bash', toolId: 'call_abc123', toolInput: { command: 'ls -la' } },
    ]);
  });

  it('tool_execution_end → tool_end event (joins text content blocks)', () => {
    const pi = {
      type: 'tool_execution_end',
      toolCallId: 'call_abc123',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'total 48\n' }] },
      isError: false,
    };
    expect(translatePiEvent(pi)).toEqual<CliStreamEvent[]>([
      { type: 'tool_end', toolId: 'call_abc123', toolOutput: 'total 48\n' },
    ]);
  });

  it('agent_settled → done event', () => {
    expect(translatePiEvent({ type: 'agent_settled' })).toEqual<CliStreamEvent[]>([
      { type: 'done' },
    ]);
  });

  it('agent_end → no event (run may retry/compact; settled is the real done)', () => {
    expect(translatePiEvent({ type: 'agent_end', messages: [] })).toEqual<CliStreamEvent[]>([]);
  });

  it('session header → session_id event', () => {
    const pi = { type: 'session', version: 3, id: 'abc-123', timestamp: '2024-01-01T00:00:00Z', cwd: '/p' };
    expect(translatePiEvent(pi)).toEqual<CliStreamEvent[]>([
      { type: 'session_id', sessionId: 'abc-123' },
    ]);
  });

  it('extension_error → error event', () => {
    const pi = { type: 'extension_error', extensionPath: '/x.ts', event: 'tool_call', error: 'boom' };
    expect(translatePiEvent(pi)).toEqual<CliStreamEvent[]>([
      { type: 'error', content: 'boom' },
    ]);
  });

  it('unmapped events (turn_start / queue_update / compaction_start) → no event', () => {
    expect(translatePiEvent({ type: 'turn_start' })).toEqual<CliStreamEvent[]>([]);
    expect(translatePiEvent({ type: 'queue_update', steering: [], followUp: [] })).toEqual<CliStreamEvent[]>([]);
    expect(translatePiEvent({ type: 'compaction_start', reason: 'threshold' })).toEqual<CliStreamEvent[]>([]);
  });

  it('non-object / null input → no event (defensive)', () => {
    expect(translatePiEvent(null)).toEqual<CliStreamEvent[]>([]);
    expect(translatePiEvent('not-an-object')).toEqual<CliStreamEvent[]>([]);
    expect(translatePiEvent(undefined)).toEqual<CliStreamEvent[]>([]);
  });
});

describe('mapClaudeToolsToPi (claude tool whitelist → pi tool names)', () => {
  it('maps known tools and drops unmapped ones (WebSearch/WebFetch have no pi builtin)', () => {
    expect(mapClaudeToolsToPi(['Read', 'Edit', 'Write', 'Grep', 'Glob', 'WebSearch', 'WebFetch'])).toEqual([
      'read', 'edit', 'write', 'grep', 'find',
    ]);
  });
});

describe('buildPiSpawnArgs (pi --mode rpc arg vector)', () => {
  it('base: --mode rpc --no-session --approve, nothing else', () => {
    expect(buildPiSpawnArgs()).toEqual(['--mode', 'rpc', '--no-session', '--approve']);
  });

  it('general chat: systemPrompt → --append-system-prompt (v1 exercised path)', () => {
    const args = buildPiSpawnArgs({ systemPrompt: 'be concise' });
    const spIdx = args.indexOf('--append-system-prompt');
    expect(spIdx).toBeGreaterThan(-1);
    expect(args[spIdx + 1]).toBe('be concise');
    expect(args).toContain('--no-session');
    expect(args).toContain('--approve');
    expect(args).not.toContain('--tools');
  });

  it('feature agent: agents[name].prompt → --append-system-prompt, agents[name].tools → --tools', () => {
    const args = buildPiSpawnArgs({
      agent: 'study',
      agents: { study: { prompt: 'be study', tools: ['Read', 'Edit', 'WebSearch'] } },
    });
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('be study');
    expect(args[args.indexOf('--tools') + 1]).toBe('read,edit');
  });

  it('resumeSessionId → --session-id (no --no-session)', () => {
    const args = buildPiSpawnArgs({ resumeSessionId: 'rs-1' });
    expect(args).not.toContain('--no-session');
    expect(args[args.indexOf('--session-id') + 1]).toBe('rs-1');
  });
});

describe('buildPromptCommand (stdin JSONL for pi rpc prompt)', () => {
  it('builds a {type:prompt, message} object (adapter appends \\n)', () => {
    expect(buildPromptCommand('hi')).toEqual({ type: 'prompt', message: 'hi' });
  });
});

describe('buildPiShellCommand (cd + exec, stdin kept open for rpc)', () => {
  it('absolute cliPath (nvm install): invokes pi via its sibling node to bypass the #!/usr/bin/env node shebang resolving a stale node under the GUI app PATH', () => {
    // Regression: /bin/sh -l resolved `node` to a stale Node 14 (nvm not on
    // the login-shell PATH), so pi's shebang ran on Node 14 and crashed on
    // `??=`. Invoke the nvm node sitting next to the pi bin instead.
    const cmd = buildPiShellCommand('/Users/x/.nvm/versions/node/v25.9.0/bin/pi', '/vault', ['--mode', 'rpc']);
    expect(cmd.startsWith("cd '/vault' && exec ")).toBe(true);
    // sibling node is dirname(cliPath)/node
    expect(cmd).toContain("'/Users/x/.nvm/versions/node/v25.9.0/bin/node'");
    expect(cmd).toContain("'/Users/x/.nvm/versions/node/v25.9.0/bin/pi'");
    expect(cmd).toContain('--mode');
    expect(cmd).not.toContain('< /dev/null');
  });

  it('bare cliPath (no path separator, e.g. "pi"): falls back to invoking pi directly (relies on PATH/node shebang)', () => {
    const cmd = buildPiShellCommand('pi', '/vault', ['--mode', 'rpc']);
    expect(cmd.startsWith("cd '/vault' && exec ")).toBe(true);
    expect(cmd).toContain("'pi'");
    expect(cmd).not.toContain('/node');
    expect(cmd).not.toContain('< /dev/null');
  });

  it('no workingDir: just exec (sibling node for absolute cliPath)', () => {
    const cmd = buildPiShellCommand('/Users/x/bin/pi', '', ['--mode', 'rpc']);
    expect(cmd.startsWith('exec ')).toBe(true);
    expect(cmd).toContain("'/Users/x/bin/node'");
    expect(cmd).not.toContain('cd ');
    expect(cmd).not.toContain('< /dev/null');
  });
});

describe('buildAdapterVersionCommand (settings self-test: --version via sibling node for pi)', () => {
  it('pi + absolute cliPath: --version via sibling node (same fix as spawn)', () => {
    const cmd = buildAdapterVersionCommand('pi', '/Users/x/.nvm/versions/node/v25.9.0/bin/pi');
    expect(cmd).toContain("'/Users/x/.nvm/versions/node/v25.9.0/bin/node'");
    expect(cmd).toContain("'/Users/x/.nvm/versions/node/v25.9.0/bin/pi'");
    expect(cmd).toContain('--version');
  });

  it('pi + bare cliPath "pi": --version invoking pi directly (PATH/shebang)', () => {
    expect(buildAdapterVersionCommand('pi', 'pi')).toBe("exec 'pi' '--version'");
  });

  it('claude: --version invoking cliPath directly (standalone binary, no node)', () => {
    expect(buildAdapterVersionCommand('claude', 'claude')).toBe("exec 'claude' '--version'");
  });

  it('unknown adapter: falls back to <cliPath> --version', () => {
    expect(buildAdapterVersionCommand('nope', 'x')).toBe("exec 'x' '--version'");
  });
});

describe('buildAdapterDetectCommand (settings detect: which via user default shell)', () => {
  it('darwin: resolves user shell via dscl and execs it in interactive login mode', () => {
    const cmd = buildAdapterDetectCommand('claude', 'darwin');
    expect(cmd).toContain('dscl . -read /Users/$(whoami) UserShell');
    expect(cmd).toContain("awk '{print $2}'");
    expect(cmd).toMatch(/-ilc "which claude"$/);
    expect(cmd.startsWith('exec "')).toBe(true);
  });

  it('linux: resolves user shell via getent passwd', () => {
    const cmd = buildAdapterDetectCommand('claude', 'linux');
    expect(cmd).toContain('getent passwd $(whoami)');
    expect(cmd).toContain('cut -d: -f7');
    expect(cmd).toMatch(/-ilc "which claude"$/);
  });

  it('win32: uses where (no shell concept)', () => {
    expect(buildAdapterDetectCommand('claude', 'win32')).toBe('where claude');
  });

  it('unknown platform: falls back to plain which', () => {
    expect(buildAdapterDetectCommand('claude', 'aix')).toBe('which claude');
  });

  it('passes adapterCmd through (e.g. pi)', () => {
    expect(buildAdapterDetectCommand('pi', 'win32')).toBe('where pi');
  });
});

describe('PiAdapter lifecycle (no spawn)', () => {
  it('id/displayName/description are set', () => {
    const a = new PiAdapter();
    expect(a.id).toBe('pi');
    expect(a.displayName).toBe('Pi');
    expect(a.description.length).toBeGreaterThan(0);
  });

  it('is not running until send; start sets config without running', async () => {
    const a = new PiAdapter();
    expect(a.isRunning()).toBe(false);
    await a.start({ cliPath: 'pi', workingDir: '/tmp' });
    expect(a.isRunning()).toBe(false);
  });

  it('stop clears running flag', async () => {
    const a = new PiAdapter();
    await a.start({ cliPath: 'pi', workingDir: '/tmp' });
    await a.stop();
    expect(a.isRunning()).toBe(false);
  });

  it('send throws if not started', async () => {
    const a = new PiAdapter();
    await expect(a.send('hi')).rejects.toThrow(/not started/i);
  });
});

describe('PiAdapter event bus', () => {
  it('delivers events to registered handlers and removes them on offEvent', () => {
    const a = new PiAdapter();
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

describe('splitJsonlLines (\\n-only framing, per rpc.md)', () => {
  // rpc.md: "Do not use generic line readers like Node readline, which also
  // split on Unicode separators inside JSON payloads." split('\n') is safe.
  it('splits complete lines and keeps the trailing remainder in the buffer', () => {
    const out = splitJsonlLines('', '{"a":1}\n{"b":2}\npartial');
    expect(out.lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(out.buffer).toBe('partial');
  });

  it('does NOT split on U+2028 / U+2029 inside JSON strings', () => {
    const ls = '\u2028';
    const ps = '\u2029';
    const chunk = `{"text":"a${ls}b${ps}c"}\n`;
    const out = splitJsonlLines('', chunk);
    expect(out.lines).toHaveLength(1);
    expect(out.buffer).toBe('');
    // The single line still contains the separators (they are valid in JSON).
    expect(out.lines[0]).toContain(ls);
    expect(out.lines[0]).toContain(ps);
  });

  it('handles a chunk with no newline (all remains buffered)', () => {
    const out = splitJsonlLines('', 'no-newline-here');
    expect(out.lines).toEqual([]);
    expect(out.buffer).toBe('no-newline-here');
  });
});
