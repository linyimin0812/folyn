import type { CliAdapterConfig, CliSendOptions, CliStreamEvent } from './types';
import { Command } from '@tauri-apps/plugin-shell';
import { BaseCliAdapter } from './baseAdapter';
import { quoteShellArg } from './claudeAdapter';
import { splitJsonlLines } from './piAdapter';

/** Codex CLI raw event shape (subset we parse). The actual wire format is
 *  flat JSONL — one event per line — with `event.type` dispatch. Only the
 *  fields the adapter reads are typed; everything else passes through
 *  untouched. See `research/codex-streaming-and-resume.md` for the full
 *  taxonomy. */
interface CodexStreamEvent {
  type: string;
  thread_id?: string;
  item?: {
    id: string;
    type: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number | null;
    status?: string;
  };
}

/** Pure seam: map a parsed Codex CLI JSONL event into zero or more
 *  `CliStreamEvent`s for the Mochi adapter event bus.
 *
 * Codex event taxonomy (per `research/codex-streaming-and-resume.md`):
 * - `thread.started` `{thread_id}` → `session_id` (first event; persist id for resume).
 * - `turn.started` `{}` → no payload, skip.
 * - `item.started` `{item:{id, type, command?}}` → `tool_start` (unless the
 *   item is `agent_message`, which has no useful start payload — text arrives
 *   only at `item.completed`).
 * - `item.completed` `{item:{id, type, text? | aggregated_output?}}`:
 *   - `item.type === 'agent_message'` → `text` (whole message, NOT a delta).
 *   - any other type (`command_execution`, `apply_patch`, `mcp_call`, …) →
 *     `tool_end` with `aggregated_output` (empty string when absent).
 * - `turn.completed` `{usage:{...}}` → `done` (terminal).
 *
 * Unknown `event.type` or `item.type` → []. The adapter class relies on
 * `command.on('close')` as a fallback `done` signal so a process that exits
 * without `turn.completed` still resolves the send promise. */
export function translateCodexEvent(event: unknown): CliStreamEvent[] {
  if (!event || typeof event !== 'object') return [];
  const e = event as CodexStreamEvent;

  if (e.type === 'thread.started' && typeof e.thread_id === 'string') {
    return [{ type: 'session_id', sessionId: e.thread_id }];
  }

  if (e.type === 'item.started' && e.item && typeof e.item.id === 'string') {
    const item = e.item;
    if (item.type === 'agent_message') return [];
    return [{
      type: 'tool_start',
      toolName: item.type,
      toolId: item.id,
      toolInput: typeof item.command === 'string' ? { command: item.command } : {},
    }];
  }

  if (e.type === 'item.completed' && e.item && typeof e.item.id === 'string') {
    const item = e.item;
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      return [{ type: 'text', content: item.text }];
    }
    const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
    return [{ type: 'tool_end', toolId: item.id, toolOutput: output }];
  }

  if (e.type === 'turn.completed') {
    return [{ type: 'done' }];
  }

  return [];
}

/** Build the raw `codex` CLI argument vector (before shell-quoting).
 *
 * Two shapes, switched by `options.resumeSessionId`:
 * - First send: `codex exec --json --skip-git-repo-check
 *   --dangerously-bypass-approvals-and-sandbox <prompt>` — prompt as the
 *   trailing positional, stdin closed (`< /dev/null` added by the shell
 *   wrapper) so Codex does NOT block waiting on stdin.
 * - Resume: `codex exec resume <SESSION_ID> <prompt> --json
 *   --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox` —
 *   per `codex exec resume --help`, positionals come first (SESSION_ID then
 *   PROMPT), then flags.
 *
 * Sandbox + approval flags mirror pi's `--approve` / claude's
 * `--permission-mode bypassPermissions`: full-tool autonomy with no
 * interactive approval prompt (the Tauri sidecar has no TTY anyway).
 * `--skip-git-repo-check` is required because Mochi's working dirs (vault
 * roots, temp probe dirs) are not always git repos. */
export function buildCodexArgs(prompt: string, options?: CliSendOptions): string[] {
  const flags = ['--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox'];
  if (options?.resumeSessionId) {
    return ['exec', 'resume', options.resumeSessionId, prompt, ...flags];
  }
  return ['exec', ...flags, prompt];
}

/** Compose the full shell command: optionally `cd` into the working dir,
 * then `exec codex … < /dev/null`. Mirrors `buildClaudeShellCommand` —
 * Codex is a standalone binary (homebrew cask), no sibling-node workaround
 * needed (unlike pi). `< /dev/null` closes stdin so Codex doesn't print
 * `Reading additional input from stdin...` and block. */
export function buildCodexShellCommand(
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

/** OpenAI Codex CLI adapter.
 *
 * Lifecycle: `start(config)` stores cliPath/workingDir. `send(prompt, opts)`
 * spawns a fresh `codex exec --json …` (or `codex exec resume <thread_id> …`
 * on subsequent sends) per call via `Command.create('codex-cli', …)`, parses
 * the streamed JSONL events via `translateCodexEvent`, and emits
 * `CliStreamEvent`s. The first `thread.started` event persists a `threadId`
 * for resume on the next send. `stop()` kills the in-flight child.
 *
 * One-shot spawn per send (NOT a long-lived rpc child like pi) — Codex has no
 * stdin-driven long-lived protocol. The spawn cost is the same as claude's
 * `-p` one-shot.
 *
 * listSkills / listCommands inherit `BaseCliAdapter`'s `[]` default —
 * Codex CLI has no on-disk skills/commands discovery surface (see research). */
export class CodexAdapter extends BaseCliAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex';
  readonly description = 'OpenAI Codex CLI（codex exec --json），一发一进程，exec/resume 两模式，shell + apply_patch 工具';

  private threadId: string | null = null;
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

    const resumeId = options?.resumeSessionId || this.threadId || undefined;
    const cliPath = this.config.cliPath || 'codex';
    const args = buildCodexArgs(prompt, { ...options, resumeSessionId: resumeId });
    const shellCmd = buildCodexShellCommand(cliPath, this.config.workingDir, args);

    try {
      const command = Command.create('codex-cli', ['-l', '-c', shellCmd]);
      command.stdout.on('data', (chunk: string) => this.handleStdoutChunk(chunk));
      command.stderr.on('data', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        // ponytail: Codex prints "Reading additional input from stdin..." to
        // stderr when stdin is /dev/null — non-JSON noise, must be suppressed
        // or every send surfaces a bogus error event.
        if (trimmed.startsWith('Reading additional input from stdin')) return;
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
        // not JSON (e.g. stray non-JSON stdout line) — skip
        continue;
      }
      const events = translateCodexEvent(parsed);
      for (const ev of events) {
        if (ev.type === 'session_id' && ev.sessionId) {
          this.threadId = ev.sessionId;
        }
        this.emit(ev);
      }
    }
  }
}
