import type { CliAdapterConfig, CliSendOptions, CliStreamEvent } from './types';
import { Command } from '@tauri-apps/plugin-shell';
import { BaseCliAdapter } from './baseAdapter';
import { quoteShellArg } from './claudeAdapter';

/**
 * Pure seam: map a parsed pi `--mode rpc` / `--mode json` JSONL event object
 * into zero or more `CliStreamEvent`s for the Quill adapter event bus.
 *
 * pi event shapes per `docs/rpc.md` / `docs/json.md`. The adapter class handles
 * process I/O (spawn, stdin prompt commands, `\n`-only line splitting) and
 * file-change synthesis (needs fs + workingDir); this function is the
 * stateless translation core, exported for unit testing.
 */
export function translatePiEvent(event: unknown): CliStreamEvent[] {
  if (!event || typeof event !== 'object') return [];
  const e = event as Record<string, any>;

  if (e.type === 'message_update') {
    const a = e.assistantMessageEvent;
    if (a && a.type === 'text_delta' && typeof a.delta === 'string') {
      return [{ type: 'text', content: a.delta }];
    }
    if (a && a.type === 'thinking_delta' && typeof a.delta === 'string') {
      return [{ type: 'thinking', content: a.delta }];
    }
  }

  if (
    e.type === 'tool_execution_start' &&
    typeof e.toolCallId === 'string' &&
    typeof e.toolName === 'string'
  ) {
    return [{ type: 'tool_start', toolName: e.toolName, toolId: e.toolCallId, toolInput: e.args }];
  }

  if (e.type === 'tool_execution_end' && typeof e.toolCallId === 'string') {
    return [{ type: 'tool_end', toolId: e.toolCallId, toolOutput: extractToolOutput(e.result) }];
  }

  // agent_end = one low-level run done (may retry/compact/continue); only
  // agent_settled means truly settled → emit done.
  if (e.type === 'agent_settled') {
    return [{ type: 'done' }];
  }

  // Session header line: {"type":"session","id":"...","cwd":"..."}
  if (e.type === 'session' && typeof e.id === 'string') {
    return [{ type: 'session_id', sessionId: e.id }];
  }

  if (e.type === 'extension_error' && typeof e.error === 'string') {
    return [{ type: 'error', content: e.error }];
  }

  return [];
}

/** Extract a flat string from a pi tool result object.
 * pi tool results look like `{content: [{type:'text',text:'...'}], details:{...}}`.
 * Join all text blocks; fall back to empty string (mirrors ClaudeAdapter's
 * `block.content || ''` leniency). */
function extractToolOutput(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as Record<string, any>;
  const content = Array.isArray(r.content) ? r.content : [];
  const text = content
    .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c: any) => c.text)
    .join('');
  return text;
}

/** Claude tool name → pi built-in tool name. pi built-ins: read, bash, edit,
 * write, grep, find, ls. WebSearch/WebFetch have no pi builtin (need an
 * extension/skill) and are dropped — see ADR/plan for the web gap. */
const CLAUDE_TO_PI_TOOL: Record<string, string> = {
  read: 'read',
  bash: 'bash',
  edit: 'edit',
  write: 'write',
  grep: 'grep',
  glob: 'find',
};

/** Map a claude-style tool whitelist to pi tool names, dropping unmapped tools
 * (case-insensitive). Returns [] for falsy/empty input. */
export function mapClaudeToolsToPi(tools: string[] | undefined | null): string[] {
  if (!tools || !Array.isArray(tools)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tools) {
    if (typeof t !== 'string') continue;
    const mapped = CLAUDE_TO_PI_TOOL[t.toLowerCase()];
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

/** Build the `pi --mode rpc ...` spawn arg vector from send options.
 *
 * pi's rpc mode is a long-lived process: `system-prompt`/`tools`/`session` are
 * STARTUP flags (set once at spawn), not per-prompt. The adapter class calls
 * this on first send; subsequent sends write `prompt` commands to stdin.
 *
 * Mapping:
 * - base: `--mode rpc`.
 * - session: `--no-session` default; `--session-id <id>` when resumeSessionId
 *   (pi: "use exact project session id, creating if missing").
 * - trust: `--approve` so project-local AGENTS.md/CLAUDE.md load without a
 *   prompt (mirrors claude's bare:false cwd discovery).
 * - system prompt: prefer the feature-agent body `agents[agent].prompt` over
 *   `options.systemPrompt`; emit `--append-system-prompt <body>` (pi appends
 *   to its default coding-assistant prompt, like claude's --append).
 * - tools: if derivable from `agents[agent].tools`, map via
 *   mapClaudeToolsToPi and emit `--tools <csv>`; else omit (pi defaults).
 * - addDir: no pi equivalent (pi reads only cwd + trusted project files);
 *   dropped — see ADR/plan for the addDir gap.
 */
export function buildPiSpawnArgs(options?: import('./types').CliSendOptions): string[] {  const args = ['--mode', 'rpc'];

  if (options?.resumeSessionId) {
    args.push('--session-id', options.resumeSessionId);
  } else {
    args.push('--no-session');
  }

  args.push('--approve');

  const agentDef = options?.agent && options.agents ? options.agents[options.agent] : undefined;
  const body = agentDef?.prompt ?? options?.systemPrompt;
  if (body) {
    args.push('--append-system-prompt', body);
  }

  if (agentDef?.tools) {
    const piTools = mapClaudeToolsToPi(agentDef.tools);
    if (piTools.length > 0) {
      args.push('--tools', piTools.join(','));
    }
  }

  return args;
}

/** Build the pi rpc `prompt` command object. The adapter stringifies this
 * and writes it to the child's stdin followed by `\n` (rpc JSONL framing). */
export function buildPromptCommand(prompt: string): { type: 'prompt'; message: string } {
  return { type: 'prompt', message: prompt };
}

/** Compose the shell command: optionally `cd` into workingDir, then
 * `exec <node> <cliPath> <args>` (or `exec <cliPath> <args>` for a bare
 * cliPath). Each arg is shell-quoted. Unlike claude's one-shot `-p`, pi
 * `--mode rpc` reads prompt commands from stdin, so stdin is NOT
 * redirected to /dev/null.
 *
 * Sibling-node invocation: when `cliPath` looks like an absolute path (a
 * `/`-containing bin, e.g. an nvm install `~/.nvm/versions/node/vX/bin/pi`),
 * invoke pi via `dirname(cliPath)/node` instead of letting pi's
 * `#!/usr/bin/env node` shebang resolve `node` off PATH. A Tauri GUI app's
 * login shell (`/bin/sh -l -c`) does NOT source nvm, so `env node` resolves
 * to a stale system Node (e.g. v14) that can't parse the current pi dist
 * (`??=` SyntaxError). The nvm node sits next to the pi bin, so dirname +
 * `/node` bypasses PATH entirely. Falls back to invoking `cliPath` directly
 * when it has no path separator (bare `pi`). */
export function buildPiShellCommand(cliPath: string, workingDir: string, args: string[]): string {
  const useSiblingNode = cliPath.includes('/');
  const entry = useSiblingNode ? [`${cliPath.slice(0, cliPath.lastIndexOf('/'))}/node`, cliPath] : [cliPath];
  const cliCmd = [...entry, ...args].map(quoteShellArg).join(' ');
  return workingDir ? `cd ${quoteShellArg(workingDir)} && exec ${cliCmd}` : `exec ${cliCmd}`;
}

/** Split a stdout chunk into complete JSONL lines plus a trailing remainder.
 * Splits on `\n` ONLY — not a Unicode-aware reader. rpc.md warns that
 * generic readers (Node `readline`) also split on U+2028 / U+2029, which
 * are valid inside JSON strings; `split('\n')` does not. */
export function splitJsonlLines(prevBuffer: string, chunk: string): { lines: string[]; buffer: string } {
  const combined = prevBuffer + chunk;
  const parts = combined.split('\n');
  // Last element is the incomplete remainder (may be '').
  const buffer = parts.pop() ?? '';
  return { lines: parts, buffer };
}

/** Tauri shell plugin message shape (subset we use). */
interface ShellChild {
  write(data: string | number[]): Promise<void>;
  kill(): Promise<void>;
}

/** pi `--mode rpc` sidecar adapter.
 *
 * Lifecycle: `start(config)` stores cliPath/workingDir. `send(prompt, opts)`
 * spawns `pi --mode rpc <buildPiSpawnArgs(opts)>` in workingDir on first call
 * (long-lived), writes a `prompt` command to stdin, and translates the
 * streamed JSONL events to `CliStreamEvent`s via `translatePiEvent`. Later
 * sends reuse the child (writing new prompt commands); session resume is via
 * `--session-id`. `stop()` kills the child.
 *
 * Line splitting is `\n`-only (NOT a Unicode-aware reader) per rpc.md —
 * generic readline splits on U+2028/U+2029 which are valid inside JSON strings.
 *
 * file_change synthesis (for edit/write tools) needs fs + workingDir and is a
 * follow-up; slice-1 `translatePiEvent` already emits tool_end with output so
 * the UI shows tool activity.
 */
export class PiAdapter extends BaseCliAdapter {
  readonly id = 'pi';
  readonly displayName = 'Pi';
  readonly description = 'pi 代码 Agent（@earendil-works/pi-coding-agent），read/bash/edit/write 工具，支持多轮 rpc 会话';

  private running = false;
  private child: ShellChild | null = null;
  private lineBuffer = '';
  /** Promises waiting on `agent_settled` to resolve each send(). FIFO: one
   *  resolver per outstanding send; settled pops the oldest. Sequential sends
   *  (the AiPanel/pet-chat pattern) keep this at depth ≤1. */
  private pendingResolvers: Array<() => void> = [];

  isRunning(): boolean {
    return this.running;
  }

  async start(config: CliAdapterConfig): Promise<void> {
    this.config = config;
  }

  async stop(): Promise<void> {
    this.running = false;
    // Spec: stop() clears buffers + nulls refs (no stale partial line on next send).
    this.lineBuffer = '';
    if (this.child) {
      try {
        await this.child.kill();
      } catch {
        // process may already be gone
      }
      this.child = null;
    }
  }

  async send(prompt: string, options?: CliSendOptions): Promise<void> {
    if (!this.config) throw new Error('Adapter not started');
    this.running = true;

    const cliPath = this.config.cliPath || 'pi';

    // Spawn the long-lived `pi --mode rpc` child on first send.
    if (!this.child) {
      const spawnArgs = buildPiSpawnArgs(options);
      const shellCmd = buildPiShellCommand(cliPath, this.config.workingDir, spawnArgs);
      const command = Command.create('pi-cli', ['-l', '-c', shellCmd]);
      command.stdout.on('data', (chunk: string) => this.handleStdoutChunk(chunk));
      command.stderr.on('data', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        this.emit({ type: 'error', content: trimmed });
      });
      command.on('close', () => {
        this.running = false;
        this.child = null;
        // Resolve any still-pending sends as done.
        while (this.pendingResolvers.length > 0) {
          this.pendingResolvers.shift()!();
        }
        this.emit({ type: 'done' });
      });
      command.on('error', (err: string) => {
        this.running = false;
        this.child = null;
        this.emit({ type: 'error', content: err });
        while (this.pendingResolvers.length > 0) {
          this.pendingResolvers.shift()!();
        }
        this.emit({ type: 'done' });
      });
      this.child = await command.spawn();
    }

    // Write the prompt command to stdin; resolve when this turn settles.
    await this.child.write(JSON.stringify(buildPromptCommand(prompt)) + '\n');

    await new Promise<void>((resolve) => {
      this.pendingResolvers.push(resolve);
    });
  }

  /** Feed a stdout chunk through \n-only framing and translate complete lines. */
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
      const events = translatePiEvent(parsed);
      for (const ev of events) {
        if (ev.type === 'done') {
          // agent_settled → resolve the oldest pending send.
          this.pendingResolvers.shift()?.();
        }
        this.emit(ev);
      }
    }
  }
}
