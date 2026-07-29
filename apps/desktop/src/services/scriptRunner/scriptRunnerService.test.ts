import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri shell + fs so we don't actually spawn or write files.
const mockSpawn = vi.fn();
const mockKill = vi.fn();
const mockOnClose = vi.fn();
const stdoutOn = vi.fn();
const stderrOn = vi.fn();

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: Object.assign(
    function Command() {
      return {
        stdout: { on: stdoutOn },
        stderr: { on: stderrOn },
        spawn: mockSpawn,
      };
    },
    {},
  ),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/appdata'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

import {
  DEFAULT_SCRIPT_RUNTIMES,
  mapLanguageToRuntime,
  buildRunArgs,
  formatResultBlock,
  replaceOrAppendResultBlock,
} from './scriptRunnerService';

describe('mapLanguageToRuntime', () => {
  const configs = DEFAULT_SCRIPT_RUNTIMES;

  it('matches shell aliases', () => {
    expect(mapLanguageToRuntime('bash', configs)?.id).toBe('shell');
    expect(mapLanguageToRuntime('sh', configs)?.id).toBe('shell');
    expect(mapLanguageToRuntime('zsh', configs)?.id).toBe('shell');
  });

  it('matches node aliases case-insensitively', () => {
    expect(mapLanguageToRuntime('js', configs)?.id).toBe('node');
    expect(mapLanguageToRuntime('JavaScript', configs)?.id).toBe('node');
    expect(mapLanguageToRuntime('node', configs)?.id).toBe('node');
  });

  it('matches python aliases', () => {
    expect(mapLanguageToRuntime('py', configs)?.id).toBe('python');
    expect(mapLanguageToRuntime('python3', configs)?.id).toBe('python');
  });

  it('returns null for unknown / empty', () => {
    expect(mapLanguageToRuntime('', configs)).toBeNull();
    expect(mapLanguageToRuntime(undefined, configs)).toBeNull();
    expect(mapLanguageToRuntime('ruby', configs)).toBeNull();
    expect(mapLanguageToRuntime('mermaid', configs)).toBeNull();
  });
});

describe('buildRunArgs', () => {
  it('uses claude-cli sidecar with -l -c wrapper', () => {
    const [name, args] = buildRunArgs(DEFAULT_SCRIPT_RUNTIMES[1], '/tmp/x.js');
    expect(name).toBe('claude-cli');
    expect(args[0]).toBe('-l');
    expect(args[1]).toBe('-c');
    expect(args[2]).toBe("node '/tmp/x.js'");
  });

  it('shell-escapes paths with spaces', () => {
    const [_name, args] = buildRunArgs(DEFAULT_SCRIPT_RUNTIMES[0], '/tmp/my file.sh');
    expect(args[2]).toBe("/bin/sh '/tmp/my file.sh'");
  });

  it('shell-escapes paths with single quotes', () => {
    const [_name, args] = buildRunArgs(DEFAULT_SCRIPT_RUNTIMES[1], "/tmp/a'b.js");
    // Single quote inside is escaped as '\''.
    expect(args[2]).toBe("node '/tmp/a'\\''b.js'");
  });
});

describe('formatResultBlock', () => {
  it('prefixes every line with > and shows exit 0', () => {
    const block = formatResultBlock('hello\nworld', '', 0, false);
    expect(block).toBe('> Result:\n> hello\n> world\n> [exit 0]');
  });

  it('includes stderr when present', () => {
    const block = formatResultBlock('out', 'err line', 1, false);
    expect(block).toBe('> Result:\n> out\n> err line\n> [exit 1]');
  });

  it('marks stopped over exit code', () => {
    const block = formatResultBlock('partial', '', null, true);
    expect(block).toBe('> Result:\n> partial\n> [stopped]');
  });

  it('omits exit marker when null and not stopped', () => {
    const block = formatResultBlock('out', '', null, false);
    expect(block).toBe('> Result:\n> out');
  });

  it('handles empty output', () => {
    const block = formatResultBlock('', '', 0, false);
    expect(block).toBe('> Result:\n> [exit 0]');
  });
});

describe('replaceOrAppendResultBlock', () => {
  const fence = '```bash\necho hello\n```';

  it('appends a new block when none exists', () => {
    const content = `${fence}\n\nsome text after.`;
    const result = '> Result:\n> hello\n> [exit 0]';
    const next = replaceOrAppendResultBlock(content, 1, result);
    // New block sits between the closing fence and the existing text.
    expect(next).toBe(`${fence}\n\n${result}\n\nsome text after.`);
  });

  it('replaces an existing Result block', () => {
    const original = `${fence}\n\n> Result:\n> old\n> [exit 0]\n\nother text`;
    const result = '> Result:\n> new\n> [exit 0]';
    const next = replaceOrAppendResultBlock(original, 1, result);
    expect(next).toBe(`${fence}\n\n${result}\n\nother text`);
  });

  it('replaces a multi-line Result block', () => {
    const original = `${fence}\n\n> Result:\n> line1\n> line2\n> line3\n> [exit 0]\n\ntext`;
    const result = '> Result:\n> replaced\n> [exit 0]';
    const next = replaceOrAppendResultBlock(original, 1, result);
    expect(next).toBe(`${fence}\n\n${result}\n\ntext`);
  });

  it('tolerates a single blank line between fence and Result', () => {
    const original = `${fence}\n> Result:\n> old\n> [exit 0]\n`;
    const result = '> Result:\n> new\n> [exit 0]';
    const next = replaceOrAppendResultBlock(original, 1, result);
    // Original ends with a single trailing newline; the replacement
    // preserves that one \n (not doubled).
    expect(next).toBe(`${fence}\n\n${result}\n`);
  });

  it('leaves content unchanged when start line is out of range', () => {
    const content = fence;
    const next = replaceOrAppendResultBlock(content, 99, '> Result:\n> x');
    expect(next).toBe(content);
  });

  it('leaves content unchanged when no closing fence found', () => {
    const content = '```bash\necho hello\n'; // no closer
    const next = replaceOrAppendResultBlock(content, 1, '> Result:\n> x');
    expect(next).toBe(content);
  });

  it('does not touch an unrelated quote block that does not start with > Result:', () => {
    const original = `${fence}\n\n> some other quote\n> text\n`;
    const result = '> Result:\n> new\n> [exit 0]';
    const next = replaceOrAppendResultBlock(original, 1, result);
    // Existing unrelated blockquote is left alone; new Result block inserted
    // after the fence, before the unrelated quote (since no Result: header
    // was matched, we go to insert mode).
    expect(next).toContain('> Result:\n> new');
    expect(next).toContain('> some other quote');
  });
});
