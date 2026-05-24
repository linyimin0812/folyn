import { BaseCliAdapter } from './base.adapter';
import type { CliAdapterConfig, CliSendOptions, FileChange } from './types';
import { Command } from '@tauri-apps/plugin-shell';
import { readTextFile } from '@tauri-apps/plugin-fs';

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
  private runningToolIds: string[] = [];
  private childProcess: Awaited<ReturnType<ReturnType<typeof Command.create>['spawn']>> | null = null;

  isRunning(): boolean {
    return this.running;
  }

  async start(config: CliAdapterConfig): Promise<void> {
    this.config = config;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.childProcess) {
      await this.childProcess.kill();
      this.childProcess = null;
    }
  }

  async send(prompt: string, options?: CliSendOptions): Promise<void> {
    if (!this.config) throw new Error('Adapter not started');
    this.running = true;
    this.lineBuffer = '';

    const resumeId = options?.resumeSessionId || this.sessionId;

    const cliPath = this.config.cliPath || 'claude';
    const cliArgs = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--thinking', 'enabled',
      '--permission-mode', 'bypassPermissions',
      '--bare',
    ];

    if (resumeId) {
      cliArgs.push('--resume', resumeId);
    }

    cliArgs.push(prompt);

    const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    const cliCmd = [cliPath, ...cliArgs].map(quote).join(' ') + ' < /dev/null';
    const shellCmd = this.config.workingDir
      ? `cd ${quote(this.config.workingDir)} && ${cliCmd}`
      : cliCmd;

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
      } else if (this.runningToolIds.length > 0) {
        const lastId = this.runningToolIds[this.runningToolIds.length - 1];
        this.runningToolIds.pop();
        this.emit({ type: 'tool_end', toolId: lastId, toolOutput: output });
      }
    }

    if (event.type === 'result') {
      this.completeRunningTools();
      if (event.is_error) {
        this.emit({ type: 'error', content: event.result || 'Unknown error' });
      }
    }
  }

  private handleToolUse(
    toolName: string,
    toolId: string,
    input: Record<string, unknown>,
  ): void {
    const isFileWrite = toolName === 'Write' || toolName === 'Edit';
    if (!isFileWrite || !this.config) return;

    const filePath = (input.file_path as string) || (input.path as string) || '';
    if (!filePath) return;

    const workingDir = this.config.workingDir;
    const relativePath = filePath.startsWith(workingDir)
      ? filePath.slice(workingDir.length).replace(/^\//, '')
      : filePath;

    this.snapshotBeforeWrite(relativePath, filePath, toolId);
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
