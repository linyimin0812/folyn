/**
 * Code-block script runner for Markdown preview.
 *
 * RuntimeConfig is config-driven: the store holds a list (default shell/node/
 * python); runScript() is generic over any config. Adding a runtime = add a
 * config entry, no logic change.
 *
 * Execution: write code to a temp file, then run `<bin> <tmp>` through the
 * existing shell sidecar — `/bin/sh -lc` (claude-cli) on macOS/Linux, `cmd /c`
 * (win-detect) on Windows — both ACL-granted, no new Tauri permission. Temp
 * file avoids the quoting hell of `node -e`/`python -c` for multi-line
 * scripts; passing `[bin, tmp]` as pre-split argv (see buildShellSidecar)
 * avoids the `\"` + cmd.exe mismatch that embedded quotes in a single
 * command string trigger on Windows.
 */

import type { Child } from '@tauri-apps/plugin-shell';
import { buildShellSidecar, isWindowsPlatform } from '@/utils/shellSidecar';

export interface RuntimeConfig {
  /** Stable id, e.g. 'shell' | 'node' | 'python'. */
  id: string;
  /** Human label for settings UI. */
  label: string;
  /** Binary name or absolute path to execute. Empty string means "not yet
   *  detected or set" — fall back to {@link defaultBinaryPath} at run time. */
  binaryPath: string;
  /** Platform-default binary name used when {@link binaryPath} is empty
   *  (e.g. 'node', 'python3', '/bin/sh' or 'powershell.exe'). Shown as the
   *  input placeholder in settings so the field can stay empty by default. */
  defaultBinaryPath: string;
  /** Markdown fence language aliases that map to this runtime.
   *  e.g. ['bash','sh','shell','zsh']. First entry is the canonical id. */
  languageAliases: string[];
  /** Temp file extension without the dot, e.g. 'sh' | 'js' | 'py'. */
  fileExt: string;
  /** Command to detect the binary path. macOS/Linux: `which <bin>`;
   *  Windows: `where <bin>` (resolved via buildShellSidecar). */
  detectCommand: string;
  /** Args to print version, appended to binaryPath. */
  versionArgs: string[];
}

// ponytail: Windows defaults use `powershell.exe` + `where` instead of
// `/bin/sh` + `which`. The `versionArgs` for the shell runtime differs —
// PowerShell prints its version via `$PSVersionTable` rather than `--version`.
// node/python share the same `--version` flag on both platforms.
// `binaryPath` starts empty so the settings input is blank by default;
// `defaultBinaryPath` is the run-time fallback when the user hasn't
// detected or typed a path yet.
const isWin = isWindowsPlatform();

export const DEFAULT_SCRIPT_RUNTIMES: RuntimeConfig[] = [
  {
    id: 'shell',
    label: 'Shell',
    binaryPath: '',
    defaultBinaryPath: isWin ? 'powershell.exe' : '/bin/sh',
    languageAliases: ['bash', 'sh', 'shell', 'zsh'],
    fileExt: 'sh',
    detectCommand: isWin ? 'where powershell.exe' : 'which sh',
    versionArgs: isWin ? ['-NoLogo', '-Command', '$PSVersionTable.PSVersion'] : ['--version'],
  },
  {
    id: 'node',
    label: 'Node.js',
    binaryPath: '',
    defaultBinaryPath: 'node',
    languageAliases: ['js', 'javascript', 'node'],
    fileExt: 'js',
    detectCommand: isWin ? 'where node' : 'which node',
    versionArgs: ['--version'],
  },
  {
    id: 'python',
    label: 'Python',
    binaryPath: '',
    defaultBinaryPath: 'python3',
    languageAliases: ['py', 'python', 'python3'],
    fileExt: 'py',
    detectCommand: isWin ? 'where python3' : 'which python3',
    versionArgs: ['--version'],
  },
];

export interface RunHandlers {
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onClose: (exitCode: number | null) => void;
}

export interface RunningScript {
  child: Child;
  stop: () => Promise<void>;
}

/** Match a markdown fence language string to a runtime config. */
export function mapLanguageToRuntime(
  lang: string | undefined,
  configs: RuntimeConfig[],
): RuntimeConfig | null {
  if (!lang) return null;
  const lower = lang.toLowerCase();
  for (const c of configs) {
    if (c.languageAliases.some((a) => a.toLowerCase() === lower)) return c;
  }
  return null;
}

/** Build sidecar name + args for the runtime + temp file path.
 *  Exported so tests can verify arg shape without spawning. */
export function buildRunArgs(config: RuntimeConfig, tmpPath: string): [sidecar: string, args: string[]] {
  // ponytail: sidecar + args picked by buildShellSidecar based on platform —
  // Unix: claude-cli `/bin/sh -lc '<bin> '<tmp>''` (login shell resolves PATH
  // for nvm/pyenv-installed runtimes); Windows: win-detect `cmd /c <bin> <tmp>`.
  // Pass `[bin, tmpPath]` as a pre-split argv: on Windows this becomes
  // separate `cmd /c` args so Rust quotes the path per-arg (a clean quoted
  // path, no `\"` for cmd.exe to mishandle); on Unix it is shell-escaped and
  // joined into the single `sh -lc` string. Pre-wrapping the path in quotes
  // and passing `node "path"` as one string breaks Windows — see
  // buildShellSidecar for the full `\"` + cmd.exe mismatch explanation.
  // Fall back to defaultBinaryPath when binaryPath is empty so scripts still
  // run for users who haven't clicked Detect.
  const bin = config.binaryPath || config.defaultBinaryPath;
  return buildShellSidecar([bin, tmpPath]);
}

let tmpCounter = 0;
async function makeTmpPath(fileExt: string): Promise<string> {
  // ponytail: use ~/.quill/scripts-tmp (fs:scope-home-recursive) instead
  // of tempDir. tempDir() returns /var/folders/... on macOS, which is
  // outside the fs scope and rejected with "forbidden path". ~/.quill is
  // covered by ACL.
  const { homeDir, join } = await import('@tauri-apps/api/path');
  const { mkdir } = await import('@tauri-apps/plugin-fs');
  const home = await homeDir();
  const tmpDir = await join(home, '.quill', 'scripts-tmp');
  await mkdir(tmpDir, { recursive: true }).catch(() => {});
  const rand = `${Date.now().toString(36)}-${(tmpCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return join(tmpDir, `quill-run-${rand}.${fileExt}`);
}

/** Write code to a temp file, spawn the runtime, return a controller. */
export async function runScript(
  config: RuntimeConfig,
  code: string,
  handlers: RunHandlers,
): Promise<RunningScript> {
  const { Command } = await import('@tauri-apps/plugin-shell');
  const { writeTextFile, remove } = await import('@tauri-apps/plugin-fs');
  const tmpPath = await makeTmpPath(config.fileExt);
  await writeTextFile(tmpPath, code);

  const [sidecar, args] = buildRunArgs(config, tmpPath);
  const cmd = Command.create(sidecar, args);
  let stdoutBuf = '';
  let stderrBuf = '';
  cmd.stdout.on('data', (line) => {
    stdoutBuf += line + '\n';
    handlers.onStdout(line);
  });
  cmd.stderr.on('data', (line) => {
    stderrBuf += line + '\n';
    handlers.onStderr(line);
  });
  cmd.on('close', (info) => {
    // Best-effort cleanup; ignore errors if file was already removed.
    void remove(tmpPath).catch(() => {});
    handlers.onClose(info.code ?? null);
  });
  const child = await cmd.spawn();
  const stop = async () => {
    try { await child.kill(); } catch {}
  };
  return { child, stop };
}

/** Format the run output as a marker line + blockquote:
 *  <!-- Result -->
 *  > <stdout/stderr lines>
 *  > [exit N] | [stopped]
 */
export function formatResultBlock(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  stopped: boolean,
): string {
  const lines: string[] = ['<!-- Result -->'];
  const pushChunk = (text: string) => {
    const trimmed = text.replace(/\n+$/, '');
    if (!trimmed) return;
    for (const ln of trimmed.split('\n')) {
      lines.push(`> ${ln}`);
    }
  };
  pushChunk(stdout);
  pushChunk(stderr);
  if (stopped) {
    lines.push('> [stopped]');
  } else if (exitCode !== null) {
    lines.push(`> [exit ${exitCode}]`);
  }
  return lines.join('\n');
}

/**
 * Splice a `<!-- Result -->` marker + `>` blockquote into the source content so
 * it follows the code fence that starts at `codeStartLine` (1-based, from
 * rehypeSourceLine).
 *
 * - If a `<!-- Result -->` marker line immediately follows the closing fence
 *   (after ≤1 blank line), the block extends from the marker through all
 *   consecutive `>`-prefixed lines that follow it. Replace that whole span
 *   with the new block. Malformed marker with no `>` lines after it: replace
 *   just the marker line.
 * - Otherwise, insert `\n\n<block>\n` after the closing fence, preserving
 *   exactly one blank line on each side.
 *
 * Returns the new content. If the fence can't be located, returns the
 * original content unchanged (write-back is best-effort).
 */
export function replaceOrAppendResultBlock(
  content: string,
  codeStartLine: number,
  resultBlock: string,
): string {
  const lines = content.split('\n');
  const startIdx = codeStartLine - 1;
  if (startIdx < 0 || startIdx >= lines.length) return content;

  // Find closing fence: a line that starts with ``` (optionally indented).
  const fenceRe = /^[ \t]*```/;
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (fenceRe.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return content; // malformed — bail

  const MARKER = '<!-- Result -->';

  // Scan forward from the line after the closing fence. Skip at most one
  // blank line. If we hit the marker, the existing block spans the marker
  // + every consecutive `>` line after it.
  let blkStart = -1;
  let blkEnd = -1;
  for (let i = endIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '') continue; // tolerate ≤1 blank line
    if (t === MARKER) {
      blkStart = i;
      blkEnd = i; // malformed case: marker with no `>` lines after it
      for (let j = i + 1; j < lines.length; j++) {
        if (/^>/.test(lines[j])) {
          blkEnd = j;
        } else {
          break;
        }
      }
    }
    break;
  }

  const before = lines.slice(0, endIdx + 1); // through closing fence
  const after = blkStart !== -1 ? lines.slice(blkEnd + 1) : lines.slice(endIdx + 1);
  // Strip one leading blank line from `after` so we don't double up the
  // fence→block separator. Trailing blanks after the block are preserved.
  const afterTrimmed = after.length > 0 && after[0] === '' ? after.slice(1) : after;
  const next = [...before, '', resultBlock, '', ...afterTrimmed];
  return next.join('\n');
}
