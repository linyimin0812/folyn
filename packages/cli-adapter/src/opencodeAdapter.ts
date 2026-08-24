import type { CliAdapterConfig, CliSendOptions, CliStreamEvent } from './types';
import { Command } from '@tauri-apps/plugin-shell';
import { BaseCliAdapter } from './baseAdapter';
import { quoteShellArg } from './claudeAdapter';
import { splitJsonlLines } from './piAdapter';

/** opencode raw NDJSON event shape (subset we parse). Wire format is flat
 *  NDJSON — one event per line — with a top-level `{type, timestamp,
 *  sessionID, part}` envelope. `part.type` discriminates the inner event
 *  (`step-start`, `text`, `tool`, `step-finish`). Field-for-field NOT
 *  compatible with codex/qoder — see `research/opencode-cli-shape.md` §4.
 *  Only fields the adapter reads are typed; everything else passes
 *  through untouched. */
interface OpencodeStreamEvent {
  type: string;
  sessionID?: string;
  part?: {
    type?: string;
    text?: string;
    tool?: string;
    callID?: string;
    state?: {
      status?: 'running' | 'completed' | 'error' | string;
      input?: Record<string, unknown>;
      output?: string;
    };
    reason?: string;
  };
}

/** Pure seam: map a parsed opencode NDJSON event into zero or more
 *  `CliStreamEvent`s for the Folyn adapter event bus.
 *
 * opencode event taxonomy (per `research/opencode-cli-shape.md` §4):
 * - `step_start` `{sessionID}` → `session_id` (first event; persist id for
 *   resume). No-op on subsequent `step_start`s in the same run.
 * - `text` `{part:{text}}` → one `text` event per chunk.
 * - `tool_use` `{part:{tool, callID, state:{status, input, output}}}` →
 *   fused event carrying start + result. Emit `tool_start` always; emit
 *   `tool_end` (with `state.output`) when `status === "completed"`; emit
 *   `tool_end` + `error` content when `status === "error"`. A separate
 *   `status:"running"` event was NOT observed live for fast tools, but the
 *   translator handles it (emits only `tool_start` when running).
 * - `step_finish` → ignore (`reason: "stop"` is not the done signal; rely
 *   on `command.on('close')`).
 *
 * Unknown `type` → []. The adapter class relies on `command.on('close')`
 * as the authoritative `done` signal — opencode emits NO terminal
 * `result`/`done` event (unlike codex/qoder).
 *
 * ponytail: `text` events may be chunked or single-shot per turn (unverified
 * for long outputs — research §4.2 Caveats). Treating each `text` event as
 * an independent `text` emission is safe either way. */
export function translateOpencodeEvent(event: unknown): CliStreamEvent[] {
  if (!event || typeof event !== 'object') return [];
  const e = event as OpencodeStreamEvent;

  if (e.type === 'step_start' && typeof e.sessionID === 'string') {
    return [{ type: 'session_id', sessionId: e.sessionID }];
  }

  if (e.type === 'text' && e.part && typeof e.part.text === 'string') {
    return [{ type: 'text', content: e.part.text }];
  }

  if (e.type === 'tool_use' && e.part && typeof e.part.callID === 'string') {
    const toolName = typeof e.part.tool === 'string' ? e.part.tool : 'tool_use';
    const toolId = e.part.callID;
    const status = e.part.state?.status;
    const input = e.part.state?.input ?? {};
    const output = e.part.state?.output;

    if (status === 'running') {
      return [{ type: 'tool_start', toolName, toolId, toolInput: input }];
    }
    if (status === 'error') {
      const errContent = typeof output === 'string' && output ? output : 'opencode tool failed';
      return [
        { type: 'tool_start', toolName, toolId, toolInput: input },
        { type: 'error', content: errContent },
      ];
    }
    // ponytail: status === "completed" or absent — fused event carries the
    // result. Emit tool_start + tool_end so the UI sees the full lifecycle
    // (qoder only emits tool_start; opencode carries output so we can do
    // better).
    return [
      { type: 'tool_start', toolName, toolId, toolInput: input },
      { type: 'tool_end', toolId, toolOutput: typeof output === 'string' ? output : '' },
    ];
  }

  return [];
}

/** Build the raw `opencode` argument vector (before shell-quoting).
 *
 * Two shapes, switched by `options.resumeSessionId`:
 * - First send: `opencode run --format json --auto [--dir <workingDir>]
 *   <prompt>` — prompt as the trailing positional, `--format json` for
 *   NDJSON streaming, `--auto` to bypass interactive permission prompts
 *   (the Tauri sidecar has no TTY).
 * - Resume: same flags + `-s <sessionId> <prompt>` — per `opencode run
 *   --help`, `-s/--session <id>` continues a specific session.
 *
 * `--workingDir` is passed here via the shell wrapper (cd + exec), not as
 * a flag, to match qoder/codex's shape. opencode has a native `--dir` flag
 * but the shell `cd` pattern is established and equally correct.
 *
 * ponytail: opencode does NOT block on stdin (research §6 — prompt is a
 * positional arg, not stdin-read), so `< /dev/null` is not strictly needed.
 * Kept for symmetry with qoder/codex; harmless. */
export function buildOpencodeArgs(prompt: string, options?: CliSendOptions): string[] {
  const flags = ['run', '--format', 'json', '--auto'];
  if (options?.resumeSessionId) {
    return [...flags, '-s', options.resumeSessionId, prompt];
  }
  return [...flags, prompt];
}

/** Resolve the binary path to exec. The aiConfigStore's `defaultFor = id => id`
 *  fallback only works when adapter id === binary name (claude/codex/pi
 *  satisfy this; qoder/qoder-cn/opencode do not). For opencode the id
 *  (`opencode`) differs from the binary name (`opencode`) only by case-
 *  sensitivity in some stores — but the store may still hand back the
 *  adapter id as the "unset" sentinel. Treat id-equals-cliPath as unset.
 *  ponytail: upgrade path is to plumb `cliPathDefault` through registry →
 *  store, killing the `id => id` heuristic at the source. */
export function resolveOpencodeCliPath(
  cliPath: string | undefined,
  adapterId: string,
  cliPathDefault: string,
): string {
  if (!cliPath || cliPath === adapterId) return cliPathDefault;
  return cliPath;
}

/** Compose the full shell command: optionally `cd` into the working dir,
 *  then `exec opencode … < /dev/null`. Mirrors `buildQoderShellCommand`.
 *  `< /dev/null` closes stdin defensively — opencode does not block on
 *  stdin (research §6), but the symmetry is harmless. */
export function buildOpencodeShellCommand(
  cliPath: string,
  workingDir: string,
  args: string[],
): string {
  const cliCmd = [cliPath, ...args].map(quoteShellArg).join(' ') + ' < /dev/null';
  return workingDir
    ? `cd ${quoteShellArg(workingDir)} && exec ${cliCmd}`
    : `exec ${cliCmd}`;
}

/** Tauri shell plugin child shape (subset we use). */
interface ShellChild {
  kill(): Promise<void>;
}

/** opencode CLI adapter.
 *
 * Lifecycle: `start(config)` stores cliPath/workingDir. `send(prompt, opts)`
 * spawns a fresh `opencode run --format json --auto …` (or with `-s <id>`
 * on subsequent sends) per call via `Command.create('opencode-cli', …)`,
 * parses the streamed NDJSON events via `translateOpencodeEvent`, and emits
 * `CliStreamEvent`s. The first `step_start` event persists a `sessionId`
 * for resume on the next send. `stop()` kills the in-flight child.
 *
 * One-shot spawn per send (NOT a long-lived rpc child like pi) — opencode
 * has no stdin-driven long-lived protocol. The spawn cost mirrors
 * codex/qoder's one-shot.
 *
 * `command.on('close')` is the authoritative `done` signal — opencode
 * emits NO terminal `result` event (unlike codex/qoder).
 *
 * listSkills / listCommands inherit `BaseCliAdapter`'s `[]` default —
 * opencode's `plugin`/`agent`/`mcp` subcommands exist but are not wired
 * here (Out of Scope, see prd.md). */
export class OpencodeAdapter extends BaseCliAdapter {
  readonly id = 'opencode';
  readonly displayName = 'opencode';
  readonly description = 'opencode CLI（opencode run --format json --auto），一发一进程，NDJSON 事件流，shell + tool 工具';

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
    const cliPath = resolveOpencodeCliPath(this.config.cliPath, this.id, 'opencode');
    const args = buildOpencodeArgs(prompt, { ...options, resumeSessionId: resumeId });
    const shellCmd = buildOpencodeShellCommand(cliPath, this.config.workingDir, args);

    try {
      const command = Command.create('opencode-cli', ['-l', '-c', shellCmd]);
      command.stdout.on('data', (chunk: string) => this.handleStdoutChunk(chunk));
      command.stderr.on('data', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        this.emit({ type: 'error', content: trimmed });
      });

      this.childProcess = await command.spawn();

      await new Promise<void>((resolve) => {
        command.on('close', () => {
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
   *  inside JSON strings. */
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
      const events = translateOpencodeEvent(parsed);
      for (const ev of events) {
        if (ev.type === 'session_id' && ev.sessionId) {
          this.sessionId = ev.sessionId;
        }
        this.emit(ev);
      }
    }
  }
}
