import type { CliAdapterConfig, CliSendOptions, CliStreamEvent } from './types';
import { Command } from '@tauri-apps/plugin-shell';
import { BaseCliAdapter } from './baseAdapter';
import { quoteShellArg } from './claudeAdapter';
import { splitJsonlLines } from './piAdapter';

/** Gemini CLI raw NDJSON event shape (subset we parse). Wire format is flat
 *  NDJSON — one event per line — with six top-level `type` values: `init`,
 *  `message`, `tool_use`, `tool_result`, `error`, `result`. Field-for-field
 *  NOT compatible with codex/qoder/opencode — see
 *  `research/gemini-cli-shape.md` §3. Only fields the adapter reads are
 *  typed; everything else passes through untouched. */
interface GeminiStreamEvent {
  type: string;
  session_id?: string;
  model?: string;
  role?: string;
  content?: string;
  delta?: boolean;
  tool_name?: string;
  tool_id?: string;
  parameters?: Record<string, unknown>;
  status?: 'success' | 'error' | string;
  output?: string;
  error?: { type?: string; message?: string };
  severity?: 'warning' | 'error' | string;
  message?: string;
  stats?: unknown;
}

/** Pure seam: map a parsed Gemini NDJSON event into zero or more
 *  `CliStreamEvent`s for the Quill adapter event bus.
 *
 * Gemini event taxonomy (per `research/gemini-cli-shape.md` §3):
 * - `init` `{session_id, model}` → `session_id` (first event; persist id for
 *   resume).
 * - `message` `{role:"user", content}` → `[]` (echo of our own prompt).
 * - `message` `{role:"assistant", content, delta:true}` → one `text` event
 *   per delta chunk (multiple per turn — UI appends).
 * - `tool_use` `{tool_name, tool_id, parameters}` → `tool_start` (the start
 *   only — result comes as a separate `tool_result` event, paired by id).
 * - `tool_result` `{tool_id, status, output, error}` → `tool_end` (+
 *   `error` when `status === "error"`).
 * - `error` `{severity, message}` → `error` when `severity === "error"`;
 *   `[]` when `severity === "warning"` (run continues — not terminal).
 * - `result` `{status, error?, stats?}` → `done` (terminal); on
 *   `status:"error"` also emit `error` first.
 *
 * Unknown `type` → []. The `result` event is the authoritative terminal
 * signal (codex-like, not opencode-like); the adapter class still keeps
 * `command.on('close')` as a defensive fallback.
 *
 * ponytail: shapes reconstructed from bundle source grep (API endpoint
 * was unreachable from this machine for live capture — research §3
 * Caveats). The two confirmed shapes (`init`, `message` role+content)
 * match source exactly; update on first authenticated re-verify. */
export function translateGeminiEvent(event: unknown): CliStreamEvent[] {
  if (!event || typeof event !== 'object') return [];
  const e = event as GeminiStreamEvent;

  if (e.type === 'init' && typeof e.session_id === 'string') {
    return [{ type: 'session_id', sessionId: e.session_id }];
  }

  if (e.type === 'message') {
    if (e.role === 'assistant' && typeof e.content === 'string') {
      return [{ type: 'text', content: e.content }];
    }
    // role:"user" is the prompt echo — no UI value.
    return [];
  }

  if (e.type === 'tool_use' && typeof e.tool_id === 'string') {
    const toolName = typeof e.tool_name === 'string' ? e.tool_name : 'tool_use';
    return [
      {
        type: 'tool_start',
        toolName,
        toolId: e.tool_id,
        toolInput: e.parameters ?? {},
      },
    ];
  }

  if (e.type === 'tool_result' && typeof e.tool_id === 'string') {
    const output = typeof e.output === 'string' ? e.output : '';
    if (e.status === 'error') {
      const errContent = e.error?.message || 'gemini tool failed';
      return [
        { type: 'tool_end', toolId: e.tool_id, toolOutput: output },
        { type: 'error', content: errContent },
      ];
    }
    return [{ type: 'tool_end', toolId: e.tool_id, toolOutput: output }];
  }

  if (e.type === 'error') {
    // ponytail: only `severity:"error"` is fatal; `severity:"warning"` is
    // retryable (loop detected, blocked, invalid stream) and the run
    // continues — no-op.
    if (e.severity === 'error' && typeof e.message === 'string') {
      return [{ type: 'error', content: e.message }];
    }
    return [];
  }

  if (e.type === 'result') {
    if (e.status === 'error') {
      const errContent = e.error?.message || 'gemini run failed';
      return [
        { type: 'error', content: errContent },
        { type: 'done' },
      ];
    }
    // status:"success" or absent — terminal.
    // ponytail: skip stats capture (UI doesn't render usage yet; add when it
    // does).
    return [{ type: 'done' }];
  }

  return [];
}

/** Build the raw `gemini` argument vector (before shell-quoting).
 *
 * Two shapes, switched by `options.resumeSessionId`:
 * - First send: `gemini -p <prompt> -o stream-json -y --skip-trust` —
 *   `-p` for non-interactive headless mode, `-o stream-json` for NDJSON,
 *   `-y/--yolo` to auto-approve tool calls (Tauri sidecar has no TTY),
 *   `--skip-trust` to trust the workingDir for this session only
 *   (Quill workingDirs are not pre-trusted — research §2 Trust quirk).
 * - Resume: same flags + `-r <sessionId>` — per `gemini --help`, `-r/
 *   --resume <id|latest|index>` continues a specific session.
 *
 * `--workingDir` is passed here via the shell wrapper (cd + exec), not as
 * a flag — Gemini has no `--dir` flag (research §5). Mirror qoder/codex
 * pattern verbatim.
 *
 * ponytail: `< /dev/null` is load-bearing for latency, not just safety —
 * Gemini has a 500ms stdin-wait timer (research §6); without it every
 * send pays 500ms. The shell wrapper adds it. */
export function buildGeminiArgs(prompt: string, options?: CliSendOptions): string[] {
  const flags = ['-p', prompt, '-o', 'stream-json', '-y', '--skip-trust'];
  if (options?.resumeSessionId) {
    return [...flags, '-r', options.resumeSessionId];
  }
  return flags;
}

/** Resolve the binary path to exec. The aiConfigStore's `defaultFor = id => id`
 *  fallback only works when adapter id === binary name (claude/codex/pi/
 *  opencode/gemini all satisfy this; qoder/qoder-cn do not). The store may
 *  still hand back the adapter id as the "unset" sentinel. Treat
 *  id-equals-cliPath as unset.
 *  ponytail: upgrade path is to plumb `cliPathDefault` through registry →
 *  store, killing the `id => id` heuristic at the source. */
export function resolveGeminiCliPath(
  cliPath: string | undefined,
  adapterId: string,
  cliPathDefault: string,
): string {
  if (!cliPath || cliPath === adapterId) return cliPathDefault;
  return cliPath;
}

/** Compose the full shell command: optionally `cd` into the working dir,
 *  then `exec gemini … < /dev/null`.
 *
 *  Unlike qoder/opencode (compiled Mach-O binaries that ignore PATH to
 *  `node`), gemini is a JS script with `#!/usr/bin/env node` shebang. On
 *  this machine `/bin/sh -lc` does NOT load nvm (bash login sources
 *  `.bash_profile`, not `.bashrc` where nvm lives), so the shebang
 *  resolves to the system `/usr/local/bin/node` (v14.16.0) — too old for
 *  `||=` logical assignment (Node 16+), throwing SyntaxError before any
 *  event is emitted.
 *
 *  Fix: invoke the user's `$SHELL` with `-lic` (login + interactive) so
 *  `.zshrc`/`.bashrc` loads nvm → PATH has the v25 node → shebang resolves
 *  correctly. Falls back to `/bin/sh -lc` if `$SHELL` is unset (defensive —
 *  matches the original behavior for environments without `$SHELL`).
 *
 *  `< /dev/null` remains load-bearing for latency — Gemini's 500ms
 *  stdin-wait timer adds a per-send delay otherwise (research §6). */
export function buildGeminiShellCommand(
  cliPath: string,
  workingDir: string,
  args: string[],
  shell: string = process.env.SHELL || '',
): string {
  const cliCmd = [cliPath, ...args].map(quoteShellArg).join(' ') + ' < /dev/null';
  const innerCmd = workingDir
    ? `cd ${quoteShellArg(workingDir)} && exec ${cliCmd}`
    : `exec ${cliCmd}`;
  // ponytail: $SHELL -lic loads nvm; /bin/sh -lc fallback matches the
  // pre-fix behavior when $SHELL is unset (no nvm, but at least no
  // regression for non-nvm setups). Upgrade path: plumb an absolute
  // node+cli path through registry → kill shell-choice entirely.
  const shellBin = shell || '/bin/sh';
  const shellFlags = shell ? '-lic' : '-lc';
  return `${quoteShellArg(shellBin)} ${shellFlags} ${quoteShellArg(innerCmd)}`;
}

/** Filter stderr noise lines so version-manager banners don't emit as
 *  `error` events. Interactive shells (zsh -ic, bash -ic) print banners
 *  from sdkman/ensa/rtx/asdf/conda at startup — those are not gemini
 *  errors. Real gemini errors start with `[ERROR]`, `Error:`, stack
 *  trace lines, or contain `SyntaxError`/`TypeError`/etc. */
export function isGeminiStderrNoise(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  // sdkman: "Using java version 8.0.382-zulu in this shell."
  // ensa/rtx: similar "Using the ..." banner shape.
  if (/^Using (java|gradle|maven|scala|kotlin|clojure|groovy|the )/i.test(trimmed)) return true;
  // zsh job-control warnings on non-TTY interactive shells.
  if (/^zsh: (job control|no tty|can't set)/i.test(trimmed)) return true;
  if (/job control/i.test(trimmed) && /tty/i.test(trimmed)) return true;
  // ASCII-art banners (e.g. conda activate's activation banner).
  if (/^[_*=\-+~`|#<>]{3,}/.test(trimmed)) return true;
  return false;
}

/** Tauri shell plugin child shape (subset we use). */
interface ShellChild {
  kill(): Promise<void>;
}

/** Gemini CLI adapter.
 *
 * Lifecycle: `start(config)` stores cliPath/workingDir. `send(prompt, opts)`
 * spawns a fresh `gemini -p <prompt> -o stream-json -y --skip-trust …`
 * (or with `-r <id>` on subsequent sends) per call via
 * `Command.create('gemini-cli', …)`, parses the streamed NDJSON events via
 * `translateGeminiEvent`, and emits `CliStreamEvent`s. The first `init`
 * event persists a `sessionId` for resume on the next send. `stop()` kills
 * the in-flight child.
 *
 * One-shot spawn per send (NOT a long-lived rpc child like pi) — Gemini
 * has no stdin-driven long-lived protocol. The spawn cost mirrors
 * codex/qoder/opencode's one-shot.
 *
 * The `result` event is the authoritative `done` signal (codex-like, not
 * opencode-like). `command.on('close')` remains as a defensive fallback —
 * whichever fires first resolves the send promise; the second is a no-op
 * duplicate guarded by `this.running`.
 *
 * listSkills / listCommands inherit `BaseCliAdapter`'s `[]` default —
 * Gemini's `mcp`/`extensions`/`skills`/`hooks`/`gemma` subcommands exist
 * but are not wired here (Out of Scope, see prd.md). */
export class GeminiAdapter extends BaseCliAdapter {
  readonly id = 'gemini';
  readonly displayName = 'Gemini';
  readonly description = 'Gemini CLI（gemini -p -o stream-json -y --skip-trust），一发一进程，NDJSON 事件流，shell + tool 工具';

  private sessionId: string | null = null;
  private running = false;
  private lineBuffer = '';
  private childProcess: ShellChild | null = null;

  isRunning(): boolean {
    return this.running;
  }

  async start(config: CliAdapterConfig): Promise<void> {
    this.config = config;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.lineBuffer = '';
    if (this.childProcess) {
      try {
        await this.childProcess.kill();
      } catch {
        // process may already be gone
      }
      this.childProcess = null;
    }
  }

  async send(prompt: string, options?: CliSendOptions): Promise<void> {
    if (!this.config) throw new Error('Adapter not started');
    this.running = true;
    this.lineBuffer = '';

    const resumeId = options?.resumeSessionId || this.sessionId || undefined;
    const cliPath = resolveGeminiCliPath(this.config.cliPath, this.id, 'gemini');
    const args = buildGeminiArgs(prompt, { ...options, resumeSessionId: resumeId });
    const shellCmd = buildGeminiShellCommand(cliPath, this.config.workingDir, args);

    try {
      const command = Command.create('gemini-cli', ['-c', shellCmd]);
      command.stdout.on('data', (chunk: string) => this.handleStdoutChunk(chunk));
      command.stderr.on('data', (line: string) => {
        if (isGeminiStderrNoise(line)) return;
        const trimmed = line.trim();
        if (!trimmed) return;
        this.emit({ type: 'error', content: trimmed });
      });

      this.childProcess = await command.spawn();

      await new Promise<void>((resolve) => {
        command.on('close', () => {
          if (!this.running) {
            // `result` event already finalized this send — close is a
            // late duplicate. No-op.
            resolve();
            return;
          }
          this.running = false;
          this.childProcess = null;
          this.emit({ type: 'done' });
          resolve();
        });
        command.on('error', (err: string) => {
          this.running = false;
          this.childProcess = null;
          this.emit({ type: 'error', content: err });
          this.emit({ type: 'done' });
          resolve();
        });
      });
    } catch (err) {
      this.running = false;
      this.emit({ type: 'error', content: String(err) });
      this.emit({ type: 'done' });
    }
  }

  /** Feed a stdout chunk through `\n`-only framing and translate complete
   *  NDJSON lines. Reuses `splitJsonlLines` from piAdapter to avoid the
   *  U+2028/U+2029 split bug (rpc.md) — generic readline splits on those
   *  inside JSON strings.
   *
   *  `result` events flip `this.running` to false so the subsequent
   *  `command.on('close')` is a no-op duplicate (the send promise was
   *  already resolved by the `result`-driven `done` emit). */
  private handleStdoutChunk(chunk: string): void {
    const { lines, buffer } = splitJsonlLines(this.lineBuffer, chunk);
    this.lineBuffer = buffer;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // not JSON — skip
        continue;
      }
      const events = translateGeminiEvent(parsed);
      for (const ev of events) {
        if (ev.type === 'session_id' && ev.sessionId) {
          this.sessionId = ev.sessionId;
        }
        if (ev.type === 'done') {
          // ponytail: `result` is authoritative terminal — flip running
          // false so `command.on('close')` becomes a no-op duplicate.
          this.running = false;
        }
        this.emit(ev);
      }
    }
  }
}
