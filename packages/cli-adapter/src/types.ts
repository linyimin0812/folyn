export interface MessageAttachment {
  name: string;
  path: string;
  type: 'image' | 'file';
  previewUrl?: string;
}

export interface CliMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  toolCalls?: ToolCallInfo[];
  attachments?: MessageAttachment[];
  timestamp: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  status: 'running' | 'done';
  input?: Record<string, unknown>;
  output?: string;
}

export interface FileChange {
  path: string;
  oldContent: string;
  newContent: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
}

export type CliStreamEventType =
  | 'text'
  | 'thinking'
  | 'tool_start'
  | 'tool_end'
  | 'file_change'
  | 'session_id'
  | 'error'
  | 'done';

export interface CliStreamEvent {
  type: CliStreamEventType;
  content?: string;
  toolName?: string;
  toolId?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  fileChange?: FileChange;
  sessionId?: string;
}

export interface CliAdapterConfig {
  cliPath: string;
  workingDir: string;
}

export interface CliAgentDefinition {
  description?: string;
  prompt: string;
  /** Optional tool whitelist (e.g. ["Read","Edit","WebSearch"]). */
  tools?: string[];
}

export interface CliSendOptions {
  resumeSessionId?: string;
  /** Run with a named agent (`--agent <name>`). Requires `agents` to inline the
   * agent definition when the agent is not already discoverable on disk. */
  agent?: string;
  /** Inline agent definitions (`--agents '<json>'`). Scope is limited to this
   * invocation; avoids writing to the user's `~/.claude/agents/`. */
  agents?: Record<string, CliAgentDefinition>;
  /** Additional directories made readable to the CLI (`--add-dir`). */
  addDir?: string[];
}

export type CliEventHandler = (event: CliStreamEvent) => void;

export interface CliAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;

  start(config: CliAdapterConfig): Promise<void>;
  send(prompt: string, options?: CliSendOptions): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  onEvent(handler: CliEventHandler): void;
  offEvent(handler: CliEventHandler): void;
}
