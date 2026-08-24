import type { CliAdapterConfig, CliSendOptions, CommandEntry, FileChange, SkillEntry } from './types';
import { Command } from '@tauri-apps/plugin-shell';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { BaseCliAdapter } from './baseAdapter';
import {
  collectCommands,
  collectSkills,
  resolveHome,
  type CommandSource,
  type SkillSource,
} from './discovery';

interface ClaudeStreamMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  tool_use_id?: string;
  content?: string;
  message?: {
    content?: { type: string; text?: string; thinking?: string; name?: string; id?: string; tool_use_id?: string; input?: Record<string, unknown>; content?: string }[];
  };
  result?: string;
  is_error?: boolean;
}

export class ClaudeAdapter extends BaseCliAdapter {
  readonly id = 'claude';
  readonly displayName = 'Claude Code';
  readonly description = 'Anthropic 官方 CLI 工具，支持对话式编辑与多工具调用';

  private sessionId: string | null = null;
  private running = false;
  private lineBuffer = '';
  private pendingFileContents = new Map<string, string>();
  private pendingWriteTools = new Map<string, { relativePath: string; absolutePath: string }>();
  private runningToolIds: string[] = [];
  private childProcess: Awaited<ReturnType<ReturnType<typeof Command.create>['spawn']>> | null = null;

  isRunning(): boolean {
    return this.running;
  }

  async start(config: CliAdapterConfig): Promise<void> {
    this.config = config;
  }

  /** List discoverable Claude Code skills. Reads the on-disk sources from
   *  the research file: user (`~/.claude/skills/`), project
   *  (`<cwd>/.claude/skills/`), and plugin skills (via
   *  `~/.claude/plugins/installed_plugins.json` → `<installPath>/skills/`).
   *  Precedence: user > project > plugin (first occurrence wins). Returns []
   *  when the adapter has not been started.
   *  ponytail: project sources use workingDir only (the vault root in Folyn);
   *  walking up to a `.git` repo root is not done — add if a non-vault cwd
   *  ever needs ancestor discovery. */
  async listSkills(): Promise<SkillEntry[]> {
    if (!this.config) return [];
    const sources: SkillSource[] = [];
    const userDir = await resolveHome('~/.claude/skills');
    sources.push({ path: userDir, source: 'user', rootMd: true });
    sources.push({ path: `${this.config.workingDir}/.claude/skills`, source: 'project' });
    for (const plugin of await this.pluginSkillDirs()) {
      sources.push({ path: plugin.dir, source: 'plugin', pluginName: plugin.name });
    }
    return collectSkills(sources);
  }

  /** List discoverable Claude Code slash commands. Same three trees as
   *  skills, globbing `*.md` AND `*.toml` under `commands/`; subfolder →
   *  `group:name` (e.g. `.claude/commands/trellis/continue.md` →
   *  `trellis:continue`). Precedence: user > project > plugin. */
  async listCommands(): Promise<CommandEntry[]> {
    if (!this.config) return [];
    const sources: CommandSource[] = [];
    const userDir = await resolveHome('~/.claude/commands');
    sources.push({ path: userDir, source: 'user', toml: true });
    sources.push({ path: `${this.config.workingDir}/.claude/commands`, source: 'project', toml: true });
    for (const plugin of await this.pluginCommandDirs()) {
      sources.push({ path: plugin.dir, source: 'plugin', pluginName: plugin.name, toml: true });
    }
    return collectCommands(sources);
  }

  /** Read `~/.claude/plugins/installed_plugins.json` and return the
   *  `{dir, name}` for each installed plugin's `skills/` dir. Malformed /
   *  missing registry → []. */
  private async pluginSkillDirs(): Promise<{ dir: string; name: string }[]> {
    return this.pluginDirs('skills');
  }

  private async pluginCommandDirs(): Promise<{ dir: string; name: string }[]> {
    return this.pluginDirs('commands');
  }

  /** Parse the installed-plugins registry (`name@marketplace` →
   *  `{installPath, version}`) and return each plugin's `<installPath>/<kind>/`
   *  dir + the plugin's short name (before `@`). */
  private async pluginDirs(kind: 'skills' | 'commands'): Promise<{ dir: string; name: string }[]> {
    const registryPath = await resolveHome('~/.claude/plugins/installed_plugins.json');
    let text: string;
    try {
      text = await readTextFile(registryPath);
    } catch {
      return [];
    }
    let registry: Record<string, { installPath?: string; version?: string }>;
    try {
      registry = JSON.parse(text);
    } catch {
      return [];
    }
    if (!registry || typeof registry !== 'object') return [];
    const out: { dir: string; name: string }[] = [];
    for (const [key, val] of Object.entries(registry)) {
      if (!val || typeof val.installPath !== 'string') continue;
      out.push({ dir: `${val.installPath}/${kind}`, name: key.split('@')[0] });
    }
    return out;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pendingFileContents.clear();
    this.pendingWriteTools.clear();
    this.runningToolIds = [];
    if (this.childProcess) {
      await this.childProcess.kill();
      this.childProcess = null;
    }
  }

  async send(prompt: string, options?: CliSendOptions): Promise<void> {
    if (!this.config) throw new Error('Adapter not started');
    this.running = true;
    this.lineBuffer = '';

    const resumeId = options?.resumeSessionId || this.sessionId || undefined;
    const cliPath = this.config.cliPath || 'claude';
    const cliArgs = buildClaudeArgs(prompt, { ...options, resumeSessionId: resumeId });
    const shellCmd = buildClaudeShellCommand(cliPath, this.config.workingDir, cliArgs);

    try {
      const command = Command.create('claude-cli', ['-l', '-c', shellCmd]);
      command.stdout.on('data', (line: string) => this.handleStdoutLine(line));
      command.stderr.on('data', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.includes('No such file or directory') && trimmed.includes('profile')) return;
        if (trimmed.startsWith('Warning:') && trimmed.includes('stdin')) return;
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

  private handleStdoutLine(data: string): void {
    this.lineBuffer += data;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as ClaudeStreamMessage;
        this.processEvent(event);
      } catch {
        // not JSON, skip
      }
    }
  }

  private completeRunningTools(output?: string): void {
    for (const id of this.runningToolIds) {
      this.emit({ type: 'tool_end', toolId: id, toolOutput: output });
    }
    this.runningToolIds = [];
  }

  private processEvent(event: ClaudeStreamMessage): void {
    if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
      this.sessionId = event.session_id;
      this.emit({ type: 'session_id', sessionId: event.session_id });
      return;
    }

    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          this.completeRunningTools();
          this.emit({ type: 'text', content: block.text });
        } else if (block.type === 'thinking' && block.thinking) {
          this.emit({ type: 'thinking', content: block.thinking });
        } else if (block.type === 'tool_use' && block.name && block.id) {
          this.completeRunningTools();
          this.emit({
            type: 'tool_start',
            toolName: block.name,
            toolId: block.id,
            toolInput: block.input,
          });
          this.runningToolIds.push(block.id);
          this.handleToolUse(block.name, block.id, block.input || {});
        } else if (block.type === 'tool_result') {
          const toolId = block.tool_use_id || block.id || '';
          const output = block.content || block.text || '';
          this.runningToolIds = this.runningToolIds.filter((id) => id !== toolId);
          this.emit({ type: 'tool_end', toolId, toolOutput: output });
          this.handleToolComplete(toolId);
        }
      }
    }

    // Tool results arrive as type "user" events with message.content containing tool_result blocks
    if (event.type === 'user' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const toolId = block.tool_use_id;
          const output = block.content || '';
          this.runningToolIds = this.runningToolIds.filter((id) => id !== toolId);
          this.emit({ type: 'tool_end', toolId, toolOutput: output });
          this.handleToolComplete(toolId);
        }
      }
    }

    // Tool result as top-level event (fallback)
    if (event.type === 'tool_result' || event.type === 'tool') {
      const toolId = event.tool_use_id || '';
      const output = event.content || event.result || '';
      if (toolId) {
        this.runningToolIds = this.runningToolIds.filter((id) => id !== toolId);
        this.emit({ type: 'tool_end', toolId, toolOutput: output });
        this.handleToolComplete(toolId);
      } else if (this.runningToolIds.length > 0) {
        const lastId = this.runningToolIds[this.runningToolIds.length - 1];
        this.runningToolIds.pop();
        this.emit({ type: 'tool_end', toolId: lastId, toolOutput: output });
        this.handleToolComplete(lastId);
      }
    }

    if (event.type === 'result') {
      this.completeRunningTools();
      if (event.is_error) {
        // ponytail: when result text is empty, surface the raw event JSON so the
        // user can see what the CLI actually said (auth failure, missing agent,
        // working dir, etc). Ugly in the UI, but the only window into the real
        // failure when `result` is blank. Truncated to keep it readable.
        if (event.result) {
          this.emit({ type: 'error', content: event.result });
        } else {
          console.error('[claudeAdapter] result event:', event);
          this.emit({
            type: 'error',
            content: `CLI result error (empty result). Raw event: ${JSON.stringify(event).slice(0, 500)}`,
          });
        }
      }
    }
  }

  private handleToolUse(
    toolName: string,
    toolId: string,
    input: Record<string, unknown>,
  ): void {
    const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'write_file', 'edit_file', 'writefile', 'editfile']);
    const isFileWrite = WRITE_TOOL_NAMES.has(toolName.toLowerCase());
    if (!isFileWrite || !this.config) return;

    const filePath = (input.file_path as string) || (input.path as string)
      || (input.filePath as string) || '';
    if (!filePath) return;

    const workingDir = this.config.workingDir;
    const relativePath = filePath.startsWith(workingDir)
      ? filePath.slice(workingDir.length).replace(/^\//, '')
      : filePath;

    this.pendingWriteTools.set(toolId, { relativePath, absolutePath: filePath });
    this.snapshotBeforeWrite(relativePath, filePath, toolId);
  }

  private async handleToolComplete(toolId: string): Promise<void> {
    const info = this.pendingWriteTools.get(toolId);
    if (!info) return;
    this.pendingWriteTools.delete(toolId);

    // ponytail: snapshotBeforeWrite schedules checkFileChange (500ms after the
    // snapshot read resolves) — that's the canonical emit path with the real
    // oldContent. The fallback that used to live here read the file AFTER the
    // write had landed and emitted { oldContent: '', newContent }, which made
    // every AI edit show up as whole-file-added (all green, no removals).
    // Snapshot read may still be in flight here; checkFileChange fires once it
    // resolves. No snapshot registered (e.g. readTextFile hung) → no emit,
    // which is better than a bogus whole-file-green diff.
    return;
  }

  private async snapshotBeforeWrite(
    relativePath: string,
    absolutePath: string,
    toolId: string,
  ): Promise<void> {
    try {
      const oldContent = await readTextFile(absolutePath);
      this.pendingFileContents.set(relativePath, oldContent);
    } catch {
      this.pendingFileContents.set(relativePath, '');
    }

    setTimeout(() => this.checkFileChange(relativePath, absolutePath, toolId), 500);
  }

  private async checkFileChange(
    relativePath: string,
    absolutePath: string,
    _toolId: string,
  ): Promise<void> {
    const oldContent = this.pendingFileContents.get(relativePath) ?? '';
    this.pendingFileContents.delete(relativePath);

    try {
      const newContent = await readTextFile(absolutePath);
      if (newContent !== oldContent) {
        const fileChange: FileChange = {
          path: relativePath,
          oldContent,
          newContent,
          status: 'pending',
          createdAt: Date.now(),
        };
        this.emit({ type: 'file_change', fileChange });
      }
    } catch {
      // file might have been deleted
    }
  }
}

// ── Pure helpers (exported for unit testing) ──

/** Shell-quote a single argument using single-quote wrapping. */
export function quoteShellArg(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the raw `claude` CLI argument vector (before shell-quoting).
 *
 * Base flags: `-p --output-format stream-json --verbose --thinking enabled
 * --permission-mode <mode>` + optionally `--bare`. `--permission-mode` defaults
 * to `bypassPermissions` (historical full-tool behavior); override via
 * `options.permissionMode` (e.g. `plan` for read-only ask mode). `--bare` is
 * omitted when `options.bare === false` so Claude Code performs cwd agent
 * discovery (loading `<cwd>/.claude/agents/*.md`) and reads the project's
 * `CLAUDE.md` / `settings.json` hooks. By default `--bare` stays on to keep
 * the historical isolated behavior. `options.systemPrompt`, when set, appends
 * to the CLI's default system prompt via `--append-system-prompt`.
 *
 * Order: base flags → `--append-system-prompt` → `--agent` / `--agents` /
 * `--add-dir` (inline delivery) → `--resume <id>` → `<prompt>`.
 * `--agent`/`--agents`/`--add-dir`/`--append-system-prompt` are appended after
 * `--bare` and before `--resume`/prompt so they are not interpreted as part of
 * the prompt.
 */
export function buildClaudeArgs(prompt: string, options?: CliSendOptions): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--thinking', 'enabled',
    '--permission-mode', options?.permissionMode ?? 'bypassPermissions',
  ];

  // Default: --bare on (isolated). bare === false → omit so cwd agents/CLAUDE.md load.
  if (options?.bare !== false) {
    args.push('--bare');
  }

  if (options?.systemPrompt) {
    args.push('--append-system-prompt', options.systemPrompt);
  }

  if (options?.agent) {
    args.push('--agent', options.agent);
  }
  if (options?.agents) {
    args.push('--agents', JSON.stringify(options.agents));
  }
  if (options?.addDir && options.addDir.length > 0) {
    // 去重（保序），避免同一目录多次传入。
    const seen = new Set<string>();
    for (const dir of options.addDir) {
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        args.push('--add-dir', dir);
      }
    }
  }

  if (options?.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }

  args.push(prompt);
  return args;
}

/**
 * Compose the full shell command string: optionally `cd` into the working dir,
 * then `exec claude ... < /dev/null`. Each arg is shell-quoted so values
 * containing JSON / spaces survive intact.
 */
export function buildClaudeShellCommand(
  cliPath: string,
  workingDir: string,
  args: string[],
): string {
  const cliCmd = [cliPath, ...args].map(quoteShellArg).join(' ') + ' < /dev/null';
  return workingDir
    ? `cd ${quoteShellArg(workingDir)} && exec ${cliCmd}`
    : `exec ${cliCmd}`;
}
