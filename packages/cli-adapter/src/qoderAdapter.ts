import type { CliAdapterConfig, CliSendOptions, CliStreamEvent } from './types';
import { Command } from '@tauri-apps/plugin-shell';
import { BaseCliAdapter } from './baseAdapter';
import { quoteShellArg } from './claudeAdapter';
import { splitJsonlLines } from './piAdapter';

/** Qoder CLI raw event shape (subset we parse). Wire format is flat JSONL —
 *  one event per line — with `type` discriminating `system`/`assistant`/
 *  `result`. Only fields the adapter reads are typed; everything else passes
 *  through untouched. See `research/qoder-cli-shape.md` §2 for the captured
 *  stream shape. Field-for-field compatible with codex `exec --json`. */
interface QoderStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: unknown;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
}

/** Pure seam: map a parsed Qoder CLI JSONL event into zero or more
 *  `CliStreamEvent`s for the Quill adapter event bus.
 *
 * Qoder event taxonomy (per `research/qoder-cli-shape.md` §2):
 * - `system` `{session_id}` → `session_id` (first event; persist id for resume).
 * - `assistant` `{message:{content:[{type:"text",text}] | [{type:"tool_use",id,name,input}]}}`
 *   → one `text` event per text block, one `tool_start` per tool_use block.
 * - `result` `{is_error?, result?}` → `done` (or `error` + `done` when `is_error`).
 *
 * Unknown `type` → []. The adapter class relies on `command.on('close')` as a
 * fallback `done` signal so a process that exits without `result` still
 * resolves the send promise.
 *
 * ponytail: `tool_end` is not emitted — the `tool_use` shape was not observed
 * on an authenticated run (research/qoder-cli-shape.md §2, Caveats). The
 * overall `result` → `done` resolves the turn. Add `tool_end` when an
 * authenticated run reveals the closing event shape. */
export function translateQoderEvent(event: unknown): CliStreamEvent[] {
  if (!event || typeof event !== 'object') return [];
  const e = event as QoderStreamEvent;

  if (e.type === 'system' && typeof e.session_id === 'string') {
    return [{ type: 'session_id', sessionId: e.session_id }];
  }

  if (e.type === 'assistant' && e.message?.content) {
    const events: CliStreamEvent[] = [];
    for (const block of e.message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        events.push({ type: 'text', content: block.text });
      }
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        events.push({
          type: 'tool_start',
          toolName: typeof block.name === 'string' ? block.name : 'tool_use',
          toolId: block.id,
          toolInput: block.input ?? {},
        });
      }
    }
    return events;
  }

  if (e.type === 'result') {
    if (e.is_error) {
      const msg = typeof e.result === 'string' ? e.result : 'qoder run failed';
      return [{ type: 'error', content: msg }, { type: 'done' }];
    }
    return [{ type: 'done' }];
  }

  return [];
}

/** Build the raw `qodercli`/`qoderclicn` argument vector (before shell-quoting).
 *
 * Two shapes, switched by `options.resumeSessionId`:
 * - First send: `qodercli -p --output-format stream-json
 *   --dangerously-skip-permissions <prompt>` — prompt as the trailing
 *   positional, stdin closed (`< /dev/null` added by the shell wrapper) so
 *   qodercli does NOT block waiting on stdin.
 * - Resume: same flags + `-r <SESSION_ID> <prompt>` — per `qodercli --help`,
 *   `-r/--resume [id]` is a flag taking a positional id.
 *
 * `--dangerously-skip-permissions` mirrors codex's
 * `--dangerously-bypass-approvals-and-sandbox`: full-tool autonomy with no
 * interactive approval (the Tauri sidecar has no TTY anyway).
 *
 * ponytail: `--no-session-persistence` is intentionally NOT used. With it,
 * turn 1 never writes the session to disk, so turn 2's `-r <session_id>`
 * fails with "Invalid session identifier … Searched current project and
 * same-repo worktrees". Default persistence lets resume work across
 * processes; the user can clean up via `qodercli --list-sessions` /
 * `--delete-session <index>`. */
export function buildQoderArgs(prompt: string, options?: CliSendOptions): string[] {
  const flags = ['-p', '--output-format', 'stream-json', '--dangerously-skip-permissions'];
  if (options?.resumeSessionId) {
    return [...flags, '-r', options.resumeSessionId, prompt];
  }
  return [...flags, prompt];
}

/** Resolve the binary path to exec. The aiConfigStore's `defaultFor = id => id`
 *  fallback only works when adapter id === binary name (claude/codex/pi all
 *  satisfy this by coincidence). For qoder the id (`qoder`/`qoder-cn`) differs
 *  from the binary name (`qodercli`/`qoderclicn`), so a `cliPath` that equals
 *  the adapter id is the store's "unset" sentinel — treat it as unset and fall
 *  back to the real default.
 *  ponytail: upgrade path is to plumb `cliPathDefault` through registry →
 *  store, killing the `id => id` heuristic at the source. */
export function resolveQoderCliPath(
  cliPath: string | undefined,
  adapterId: string,
  cliPathDefault: string,
): string {
  if (!cliPath || cliPath === adapterId) return cliPathDefault;
  return cliPath;
}

/** Compose the full shell command: optionally `cd` into the working dir,
 *  then `exec qodercli … < /dev/null`. Mirrors `buildCodexShellCommand` —
 *  qodercli is a standalone binary, no sibling-node workaround needed (unlike
 *  pi). `< /dev/null` closes stdin so qodercli doesn't block on stdin. */
export function buildQoderShellCommand(
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

/** Constructor options — parameterize the single implementation class for both
 *  international and China variants. Per research/qoder-cli-shape.md §5, the
 *  two binaries share the same CLI surface; only binary name, config dir, and
 *  sidecar registration differ. */
export interface QoderAdapterOptions {
  id: string;
  displayName: string;
  description: string;
  /** Tauri sidecar name registered in capabilities (e.g. `qoder-cli`,
   *  `qoder-cli-cn`). */
  sidecarName: string;
  /** Default binary name on `$PATH` when `config.cliPath` is empty (e.g.
   *  `qodercli`, `qoderclicn`). */
  cliPathDefault: string;
}

/** Qoder CLI adapter (international + China share this class).
 *
 * Lifecycle: `start(config)` stores cliPath/workingDir. `send(prompt, opts)`
 * spawns a fresh `qodercli -p --output-format stream-json …` (or with `-r <id>`
 * on subsequent sends) per call via `Command.create(sidecarName, …)`, parses
 * the streamed JSONL events via `translateQoderEvent`, and emits
 * `CliStreamEvent`s. The first `system` event persists a `sessionId` for
 * resume on the next send. `stop()` kills the in-flight child.
 *
 * One-shot spawn per send (NOT a long-lived rpc child like pi) — qodercli has
 * no stdin-driven long-lived protocol. The spawn cost mirrors codex's
 * one-shot.
 *
 * listSkills / listCommands inherit `BaseCliAdapter`'s `[]` default — qoder
 * CLI's `skills`/`plugins` subcommands exist but are not wired here (Out of
 * Scope, see prd.md). */
export class QoderAdapter extends BaseCliAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  private readonly sidecarName: string;
  private readonly cliPathDefault: string;

  private sessionId: string | null = null;
  private running = false;
  private lineBuffer = '';
  private childProcess: ShellChild | null = null;

  constructor(opts: QoderAdapterOptions) {
    super();
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.description = opts.description;
    this.sidecarName = opts.sidecarName;
    this.cliPathDefault = opts.cliPathDefault;
  }

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
    const cliPath = resolveQoderCliPath(this.config.cliPath, this.id, this.cliPathDefault);
    const args = buildQoderArgs(prompt, { ...options, resumeSessionId: resumeId });
    const shellCmd = buildQoderShellCommand(cliPath, this.config.workingDir, args);

    try {
      const command = Command.create(this.sidecarName, ['-l', '-c', shellCmd]);
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
   *  JSONL lines. Reuses `splitJsonlLines` from piAdapter to avoid the
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
      const events = translateQoderEvent(parsed);
      for (const ev of events) {
        if (ev.type === 'session_id' && ev.sessionId) {
          this.sessionId = ev.sessionId;
        }
        this.emit(ev);
      }
    }
  }
}
