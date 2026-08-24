import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Tauri shell + fs so we don't actually spawn or write files.
const mockSpawn = vi.fn();
const mockKill = vi.fn();
const mockOnClose = vi.fn();
const stdoutOn = vi.fn();
const stderrOn = vi.fn();
// ponytail: capture Command.create(name, args, options) so a runScript test
// can assert the runtime's console-codepage encoding reaches the shell plugin.
const commandCalls: Array<{ name: string; args: string[]; options: unknown }> = [];

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: Object.assign(
    function Command(name: string, args: string[], options?: unknown) {
      commandCalls.push({ name, args, options });
      return {
        stdout: { on: stdoutOn },
        stderr: { on: stderrOn },
        on: mockOnClose,
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
  homeDir: vi.fn().mockResolvedValue('/mock/home'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

import {
  DEFAULT_SCRIPT_RUNTIMES,
  mapLanguageToRuntime,
  buildRunArgs,
  runScript,
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

  // Regression: ```powershell fences must map to the shell runtime on Windows
  // so the preview Run button shows. DEFAULT_SCRIPT_RUNTIMES is frozen at
  // module-load time on the test-runner's real platform, so we can't rely on
  // its shell runtime carrying the Windows-only `powershell` alias. Build an
  // inline config mirroring the Windows shell runtime and assert the alias
  // match — this is what the preview's CodeBlockWrapper relies on.
  it('matches powershell/ps1/pwsh to the shell runtime (Windows aliases)', () => {
    const winShell: typeof configs[number] = {
      id: 'shell',
      label: 'Shell',
      binaryPath: '',
      defaultBinaryPath: 'powershell.exe',
      languageAliases: ['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'pwsh'],
      fileExt: 'ps1',
      detectCommand: 'where powershell.exe',
      versionArgs: ['-NoLogo', '-Command', '$PSVersionTable.PSVersion'],
      encoding: 'gbk',
    };
    expect(mapLanguageToRuntime('powershell', [winShell])?.id).toBe('shell');
    expect(mapLanguageToRuntime('ps1', [winShell])?.id).toBe('shell');
    expect(mapLanguageToRuntime('pwsh', [winShell])?.id).toBe('shell');
    // case-insensitive, matching the bash/sh/zsh aliases above
    expect(mapLanguageToRuntime('PowerShell', [winShell])?.id).toBe('shell');
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
    // Both the binary and the path are shell-escaped (safer for a binary path
    // with spaces); a bare word like `node` is unaffected by single-quoting.
    expect(args[2]).toBe("'node' '/tmp/x.js'");
  });

  it('shell-escapes paths with spaces', () => {
    const [_name, args] = buildRunArgs(DEFAULT_SCRIPT_RUNTIMES[0], '/tmp/my file.sh');
    expect(args[2]).toBe("'/bin/sh' '/tmp/my file.sh'");
  });

  it('shell-escapes paths with single quotes', () => {
    const [_name, args] = buildRunArgs(DEFAULT_SCRIPT_RUNTIMES[1], "/tmp/a'b.js");
    // Single quote inside is escaped as '\''.
    expect(args[2]).toBe("'node' '/tmp/a'\\''b.js'");
  });
});

// Regression: on Windows, the temp path must be passed as a separate `cmd /c`
// arg, NOT pre-wrapped in quotes inside a single command string. The old code
// built `node "C:\path\file.js"` as one arg; Rust backslash-escaped the inner
// `"` as `\"`, cmd.exe (no backslash escaping) passed the literal `"` through
// to node, and node received a path with embedded quote characters — failing
// with `Cannot find module '...\"C:\Users\...js"'` (MODULE_NOT_FOUND).
describe('buildRunArgs (Windows)', () => {
  const originalPlatform = navigator.platform;

  beforeEach(() => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
  });

  it('uses the win-detect sidecar with /c and a separate path arg (no embedded quotes)', () => {
    const tmpPath = 'C:\\Users\\linyimin\\.mochi\\scripts-tmp\\mochi-run-abc.js';
    const [name, args] = buildRunArgs(DEFAULT_SCRIPT_RUNTIMES[1], tmpPath);
    expect(name).toBe('win-detect');
    expect(args).toEqual(['/c', 'node', tmpPath]);
    // The path arg must reach node verbatim — no surrounding quotes that would
    // be backslash-escaped by Rust and then mishandled by cmd.exe.
    expect(args.join(' ')).toBe(`/c node ${tmpPath}`);
  });

  it('keeps a path with spaces as a single separate arg (no manual quoting)', () => {
    // Use the node runtime: its defaultBinaryPath ('node') is platform-
    // independent, so it is stable regardless of the platform DEFAULT_SCRIPT_
    // RUNTIMES was frozen at during module load (the shell runtime's default
    // flips powershell.exe↔/bin/sh, which would couple this test to the
    // module-load platform).
    const tmpPath = 'C:\\Users\\My Name\\.mochi\\scripts-tmp\\mochi-run-def.js';
    const [name, args] = buildRunArgs(DEFAULT_SCRIPT_RUNTIMES[1], tmpPath);
    expect(name).toBe('win-detect');
    // Three elements: /c, the binary, and the path. We pass the path raw —
    // Rust's CreateProcess quoting wraps it in quotes only when it has spaces,
    // with no internal `"` to backslash-escape, so cmd.exe handles it cleanly.
    expect(args).toEqual(['/c', 'node', tmpPath]);
  });

  // Regression: a ```powershell block writes a .ps1 temp file and runs it via
  // `cmd /c powershell.exe <tmp.ps1>`. PowerShell silently no-ops a .sh temp
  // file, so the .ps1 extension is required for the code to actually execute.
  it('runs a powershell block as cmd /c powershell.exe <tmp.ps1>', () => {
    // Inline the Windows shell runtime: DEFAULT_SCRIPT_RUNTIMES is frozen at
    // module-load time on the runner's real platform, so the shell runtime's
    // defaultBinaryPath/fileExt can't be read off it portably.
    const winShell = {
      id: 'shell',
      label: 'Shell',
      binaryPath: '',
      defaultBinaryPath: 'powershell.exe',
      languageAliases: ['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'pwsh'],
      fileExt: 'ps1',
      detectCommand: 'where powershell.exe',
      versionArgs: ['-NoLogo', '-Command', '$PSVersionTable.PSVersion'],
      encoding: 'gbk',
    };
    const tmpPath = 'C:\\Users\\linyimin\\.mochi\\scripts-tmp\\mochi-run-abc.ps1';
    const [name, args] = buildRunArgs(winShell, tmpPath);
    expect(name).toBe('win-detect');
    expect(args).toEqual(['/c', 'powershell.exe', tmpPath]);
  });
});

// Regression: runScript must pass the runtime's `encoding` (e.g. 'gbk' for
// PowerShell on Chinese Windows) to Command.create, else non-ASCII output is
// mis-decoded as UTF-8 → mojibake (dir's "目录:" became "Ŀ¼:"). node has no
// encoding field → undefined (UTF-8 default, correct for node).
describe('runScript encoding', () => {
  const noop = { onStdout: () => {}, onStderr: () => {}, onClose: () => {} };

  beforeEach(() => {
    commandCalls.length = 0;
    mockSpawn.mockResolvedValue({ kill: vi.fn() } as never);
  });

  it('passes the shell runtime GBK encoding to Command.create', async () => {
    const winShell = {
      id: 'shell',
      label: 'Shell',
      binaryPath: '',
      defaultBinaryPath: 'powershell.exe',
      languageAliases: ['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'pwsh'],
      fileExt: 'ps1',
      detectCommand: 'where powershell.exe',
      versionArgs: ['-NoLogo', '-Command', '$PSVersionTable.PSVersion'],
      encoding: 'gbk',
    };
    await runScript(winShell as never, 'Write-Output hi', noop);
    expect(commandCalls).toHaveLength(1);
    expect(commandCalls[0].options).toEqual({ encoding: 'gbk' });
  });

  it('passes undefined encoding for the node runtime (UTF-8 default)', async () => {
    // node emits UTF-8 regardless of Windows codepage; no encoding field.
    const nodeRuntime = {
      id: 'node',
      label: 'Node.js',
      binaryPath: '',
      defaultBinaryPath: 'node',
      languageAliases: ['js', 'javascript', 'node'],
      fileExt: 'js',
      detectCommand: 'where node',
      versionArgs: ['--version'],
    };
    await runScript(nodeRuntime as never, 'console.log("hi")', noop);
    expect(commandCalls).toHaveLength(1);
    expect(commandCalls[0].options).toBeUndefined();
  });
});

describe('formatResultBlock', () => {
  it('wraps stdout + exit 0 in a marker + blockquote', () => {
    const block = formatResultBlock('hello\nworld', '', 0, false);
    expect(block).toBe('<!-- Result -->\n> hello\n> world\n> [exit 0]');
  });

  it('includes stderr when present', () => {
    const block = formatResultBlock('out', 'err line', 1, false);
    expect(block).toBe('<!-- Result -->\n> out\n> err line\n> [exit 1]');
  });

  it('marks stopped over exit code', () => {
    const block = formatResultBlock('partial', '', null, true);
    expect(block).toBe('<!-- Result -->\n> partial\n> [stopped]');
  });

  it('omits exit marker when null and not stopped', () => {
    const block = formatResultBlock('out', '', null, false);
    expect(block).toBe('<!-- Result -->\n> out');
  });

  it('handles empty output', () => {
    const block = formatResultBlock('', '', 0, false);
    expect(block).toBe('<!-- Result -->\n> [exit 0]');
  });

  // Regression: the shell plugin emits Windows \r\n split across two payloads
  // (row\r then \n), so the run buffer carries raw \r. Without normalization
  // each `> ` line would trail a stray CR; this asserts CRLF/CR → LF collapse.
  it('normalizes CRLF and bare CR to LF in the blockquote', () => {
    const block = formatResultBlock('row1\r\nrow2\r\n', 'err\r\n', 0, false);
    expect(block).toBe('<!-- Result -->\n> row1\n> row2\n> err\n> [exit 0]');
    // no stray CR survives into any line
    expect(block).not.toContain('\r');
  });
});

describe('replaceOrAppendResultBlock', () => {
  const fence = '```bash\necho hello\n```';

  it('appends a new block when none exists', () => {
    const content = `${fence}\n\nsome text after.`;
    const result = '<!-- Result -->\n> hello\n> [exit 0]';
    const next = replaceOrAppendResultBlock(content, 1, result);
    // New block sits between the closing fence and the existing text.
    expect(next).toBe(`${fence}\n\n${result}\n\nsome text after.`);
  });

  it('replaces an existing Result block', () => {
    const original = `${fence}\n\n<!-- Result -->\n> old\n> [exit 0]\n\nother text`;
    const result = '<!-- Result -->\n> new\n> [exit 0]';
    const next = replaceOrAppendResultBlock(original, 1, result);
    expect(next).toBe(`${fence}\n\n${result}\n\nother text`);
  });

  it('replaces a multi-line Result block', () => {
    const original = `${fence}\n\n<!-- Result -->\n> line1\n> line2\n> line3\n> [exit 0]\n\ntext`;
    const result = '<!-- Result -->\n> replaced\n> [exit 0]';
    const next = replaceOrAppendResultBlock(original, 1, result);
    expect(next).toBe(`${fence}\n\n${result}\n\ntext`);
  });

  it('tolerates a single blank line between fence and Result', () => {
    const original = `${fence}\n<!-- Result -->\n> old\n> [exit 0]\n`;
    const result = '<!-- Result -->\n> new\n> [exit 0]';
    const next = replaceOrAppendResultBlock(original, 1, result);
    // Original ends with a single trailing newline; the replacement
    // preserves that one \n (not doubled).
    expect(next).toBe(`${fence}\n\n${result}\n`);
  });

  it('leaves content unchanged when start line is out of range', () => {
    const content = fence;
    const next = replaceOrAppendResultBlock(content, 99, '<!-- Result -->\n> x');
    expect(next).toBe(content);
  });

  it('leaves content unchanged when no closing fence found', () => {
    const content = '```bash\necho hello\n'; // no closer
    const next = replaceOrAppendResultBlock(content, 1, '<!-- Result -->\n> x');
    expect(next).toBe(content);
  });

  it('does not touch an unrelated HTML comment that does not equal the Result marker', () => {
    const original = `${fence}\n\n<!-- some other comment -->\n`;
    const result = '<!-- Result -->\n> new\n> [exit 0]';
    const next = replaceOrAppendResultBlock(original, 1, result);
    // Existing unrelated comment is left alone; new Result block inserted
    // after the fence, before the unrelated comment.
    expect(next).toContain('<!-- Result -->\n> new');
    expect(next).toContain('<!-- some other comment -->');
  });

  it('replaces marker line alone when no > lines follow (malformed)', () => {
    const original = `${fence}\n\n<!-- Result -->\n\ntext`;
    const result = '<!-- Result -->\n> fixed\n> [exit 0]';
    const next = replaceOrAppendResultBlock(original, 1, result);
    expect(next).toBe(`${fence}\n\n${result}\n\ntext`);
  });
});
