import type { CliAdapterConfig, CliSendOptions, CommandEntry, CliStreamEvent, SkillEntry } from './types';
import { Command } from '@tauri-apps/plugin-shell';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { BaseCliAdapter } from './baseAdapter';
import { quoteShellArg } from './claudeAdapter';
import {
  collectCommands,
  collectSkills,
  resolveHome,
  type CommandSource,
  type SkillSource,
} from './discovery';

/**
 * Pure seam: map a parsed pi `--mode rpc` / `--mode json` JSONL event object
 * into zero or more `CliStreamEvent`s for the Mochi adapter event bus.
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

/** Build the shell command a settings UI uses to self-test an adapter
 * (e.g. `<cliPath> --version`). For pi with an absolute cliPath, reuse the
 * sibling-node invocation from buildPiShellCommand so the test runs on the
 * same node the spawn will use (not the stale `env node` the GUI app PATH
 * resolves). For claude (standalone binary) / unknown adapters, just
 * `exec <cliPath> --version` on Unix; on Windows cmd.exe has no `exec`
 * builtin and single-quote wrapping doesn't work, so invoke the binary
 * directly with double-quote wrapping (handles paths containing spaces). */
export function buildAdapterVersionCommand(
  adapterId: string,
  cliPath: string,
  platform: string = process.platform,
): string {
  if (platform === 'win32') {
    // ponytail: cmd.exe has no exec; double-quote wrap is sufficient for
    // paths with spaces. Pi adapter Windows support is partial — see PR3
    // notes in 08-12-windows — but the version probe works for any binary.
    return `"${cliPath}" --version`;
  }
  if (adapterId === 'pi') {
    return buildPiShellCommand(cliPath, '', ['--version']);
  }
  if (adapterId === 'gemini') {
    // ponytail: gemini is a JS script with #!/usr/bin/env node shebang.
    // /bin/sh -lc (the sidecar) doesn't load nvm (bash login sources
    // .bash_profile, not .bashrc where nvm lives), so the shebang
    // resolves to /usr/local/bin/node v14.16.0 — too old for ||= (Node
    // 16+) → SyntaxError before --version even runs. Same root cause as
    // buildGeminiShellCommand (commit 369428da), different code path
    // (settings page test-probe, not the adapter's send()).
    //
    // Two fixes, switched by cliPath (mirror the pi case's shape):
    // - absolute (contains /): use sibling node from the same dir — no
    //   nvm-loading overhead. Detect button already resolves to absolute
    //   nvm paths, so this is the common case.
    // - bare (e.g. "gemini"): wrap with the user's login shell + -ilc
    //   (mirrors buildAdapterDetectCommand) so .zshrc/.bashrc loads nvm.
    //   Drop exec — `| tail -1` extracts the version line from under
    //   the sdkman/nvm banner noise -ilc prints to stdout first; 2>/dev/null
    //   silences zsh/bash non-TTY job-control warnings.
    if (cliPath.includes('/')) {
      const dir = cliPath.slice(0, cliPath.lastIndexOf('/'));
      return `exec ${quoteShellArg(`${dir}/node`)} ${quoteShellArg(cliPath)} ${quoteShellArg('--version')}`;
    }
    const userShell = platform === 'darwin'
      ? `$(dscl . -read /Users/$(whoami) UserShell | awk '{print $2}')`
      : platform === 'linux'
        ? `$(getent passwd $(whoami) | cut -d: -f7)`
        : '';
    if (!userShell) {
      // Unknown platform — fall back to bare exec (matches pre-fix
      // behavior; user can fix by setting absolute cliPath via detect).
      return `exec ${quoteShellArg(cliPath)} ${quoteShellArg('--version')}`;
    }
    return `"${userShell}" -ilc ${quoteShellArg(`${cliPath} --version`)} 2>/dev/null | tail -1`;
  }
  return `exec ${quoteShellArg(cliPath)} ${quoteShellArg('--version')}`;
}

/** Build the shell command a settings UI uses to detect an adapter's CLI
 * path on the user's real default shell — NOT the Tauri sidecar's `/bin/sh`.
 *
 * Why: Tauri GUI processes inherit launchd's PATH, not the user's interactive
 * shell PATH. `/bin/sh -lc which <cmd>` reads only `/etc/profile` + `~/.profile`,
 * so it picks up shim directories (e.g. cmux-cli-shims under `/var/folders/`)
 * injected via `/etc/paths.d/` — returning a UUID-suffixed temp path that
 * breaks on reboot. Running `which` under the user's actual login shell
 * (`dscl`/`getent`-resolved) gives the same path the user sees in a terminal.
 *
 * Platform branches:
 * - darwin: resolve user shell via `dscl . -read /Users/$(whoami) UserShell`
 * - linux:  resolve user shell via `getent passwd $(whoami) | cut -d: -f7`
 * - win32:  `where <cmd>` (no shell concept; uses Windows system PATH)
 * - other:  plain `which <cmd>` (fallback for unknown platforms)
 *
 * The resolved shell is invoked with `-ilc` (interactive + login). `-l` reads
 * `/etc/zprofile` + `~/.zprofile` (zsh) / `/etc/profile` + `~/.profile` (sh).
 * `-i` additionally sources `~/.zshrc` / `~/.bashrc`, where users typically
 * `export PATH` (e.g. `~/.local/bin`, nvm, sdkman). Without `-i`, PATH set only
 * in those rc files is NOT loaded, and detect returns shim paths (e.g.
 * cmux-cli-shims under `/var/folders/`) injected via `/etc/paths.d/`.
 *
 * `-i` has a cost: rc-file init blocks (SDKMAN's "Using java version...",
 * nvm, etc.) print noise to stdout BEFORE `which` runs. `2>/dev/null` silences
 * stderr (non-TTY `-i` mode may emit warnings; rc-file init may also write to
 * stderr), and `| tail -1` extracts the path — it is always the LAST stdout
 * line because `which` runs after rc-file sourcing.
 *
 * No `exec`: we need a pipe (`| tail -1`), and `exec` replaces the shell
 * process so the pipe cannot attach. The wrapper `/bin/sh -l -c` (the sidecar)
 * hosts the pipeline as a parent, launching the user shell as a child.
 *
 * The command is run via the sidecar with `args`: Unix sidecar uses
 * `['-l', '-c', <cmd>]`, Windows sidecar uses `['/c', <cmd>]`. Caller picks
 * the sidecar name based on `navigator.platform` (browser-safe). */
export function buildAdapterDetectCommand(
  adapterCmd: string,
  platform: string = process.platform,
): string {
  switch (platform) {
    case 'darwin':
      return `"$(dscl . -read /Users/$(whoami) UserShell | awk '{print $2}')" -ilc "which ${adapterCmd}" 2>/dev/null | tail -1`;
    case 'linux':
      return `"$(getent passwd $(whoami) | cut -d: -f7)" -ilc "which ${adapterCmd}" 2>/dev/null | tail -1`;
    case 'win32':
      return `where ${adapterCmd}`;
    default:
      return `which ${adapterCmd}`;
  }
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

  /** List discoverable Pi skills (Agent Skills standard). Reads the on-disk
   *  sources from the research file: `~/.pi/agent/skills/` (rootMd),
   *  `~/.agents/skills/` (SKILL.md dirs only), project `.pi/skills/` (rootMd)
   *  + `.agents/skills/`, and package skills from `settings.json` `skills[]`.
   *  Precedence: user > project > plugin (first occurrence wins). Skills
   *  WITHOUT `description` are skipped (Pi refuses to load them). Skills with
   *  `disable-model-invocation: true` ARE included (user-triggerable via
   *  `/skill:name`). Returns [] when not started.
   *  ponytail: Pi project trust is NOT replicated — the adapter only reads
   *  files; an untrusted project's skills won't actually resolve in a Pi rpc
   *  session started against it. Documented gap, see PRD Technical Notes. */
  async listSkills(): Promise<SkillEntry[]> {
    if (!this.config) return [];
    const sources: SkillSource[] = [];
    sources.push({ path: await resolveHome('~/.pi/agent/skills'), source: 'user', rootMd: true });
    sources.push({ path: await resolveHome('~/.agents/skills'), source: 'user' });
    sources.push({ path: `${this.config.workingDir}/.pi/skills`, source: 'project', rootMd: true });
    sources.push({ path: `${this.config.workingDir}/.agents/skills`, source: 'project' });
    for (const dir of await this.packageSkillDirs()) {
      sources.push({ path: dir, source: 'plugin' });
    }
    return collectSkills(sources);
  }

  /** List discoverable Pi prompt templates (the slash-command analog).
   *  Templates are NON-recursive: `~/.pi/agent/prompts/*.md` → `/review`;
   *  subfolders must be added explicitly (per docs). Precedence:
   *  user > project > plugin. */
  async listCommands(): Promise<CommandEntry[]> {
    if (!this.config) return [];
    const sources: CommandSource[] = [];
    sources.push({ path: await resolveHome('~/.pi/agent/prompts'), source: 'user', flat: true });
    sources.push({ path: `${this.config.workingDir}/.pi/prompts`, source: 'project', flat: true });
    for (const dir of await this.packagePromptDirs()) {
      sources.push({ path: dir, source: 'plugin', flat: true });
    }
    return collectCommands(sources);
  }

  /** Read `~/.pi/agent/settings.json` and return the `skills[]` entries that
   *  point to dirs (Pi merges these into the discovery). Missing /
   *  malformed settings → []. The `prompts[]` array is read by
   *  packagePromptDirs. */
  private async readSettings(): Promise<{ skills?: string[]; prompts?: string[] }> {
    const settingsPath = await resolveHome('~/.pi/agent/settings.json');
    let text: string;
    try {
      text = await readTextFile(settingsPath);
    } catch {
      return {};
    }
    try {
      const data = JSON.parse(text) as { skills?: unknown; prompts?: unknown };
      const skills = Array.isArray(data.skills) ? data.skills.filter((s): s is string => typeof s === 'string') : [];
      const prompts = Array.isArray(data.prompts) ? data.prompts.filter((s): s is string => typeof s === 'string') : [];
      return { skills, prompts };
    } catch {
      return {};
    }
  }

  private async packageSkillDirs(): Promise<string[]> {
    const { skills } = await this.readSettings();
    return skills ?? [];
  }

  private async packagePromptDirs(): Promise<string[]> {
    const { prompts } = await this.readSettings();
    return prompts ?? [];
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
