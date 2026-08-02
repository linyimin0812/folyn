export interface MessageAttachment {
  name: string;
  path: string;
  type: 'image' | 'file';
  previewUrl?: string;
}

/** An inline image emitted by an image-generation assistant turn. The image
 *  sits at character position `atOffset` in the message `content` — the
 *  frontend interleaves text and images by this offset (text segments are
 *  `content[0..atOffset]`, `content[atOffset..nextOffset]`, etc.; images
 *  consume no characters in `content` itself, only mark a render position). */
export interface AssistantImage {
  /** Full `data:image/<mt>;base64,<...>` URL, ready for `<img src>`. */
  data: string;
  /** Parsed MIME (e.g. `image/png`). */
  mediaType: string;
  /** Character offset in `CliMessage.content` where the image renders. */
  atOffset: number;
}

export interface CliMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  toolCalls?: ToolCallInfo[];
  attachments?: MessageAttachment[];
  timestamp: number;
  // ponytail: provider/model are optional so legacy persisted messages hydrate
  // without migration. AI responses are tagged at write time in a later PR.
  // `string` (not a narrower union) keeps cli-adapter decoupled from the
  // desktop ChatProvider catalog; the desktop consumer narrows on read.
  provider?: string;
  model?: string;
  // ponytail: mode is optional so legacy persisted messages hydrate without
  // migration. Persisted with the message (not as a session-global) so the
  // Agent/Ask/Chat tag survives app restart — see AiPanel renderPairTag.
  mode?: string;
  /** Assistant-turn inline images (image-generation models). Frontend-only;
   *  the desktop store populates this from `'image'` stream events and
   *  persists it via the rig backend's `assistant_images` history field. */
  images?: AssistantImage[];
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
  | 'done'
  | 'image';

export interface CliStreamEvent {
  type: CliStreamEventType;
  content?: string;
  toolName?: string;
  toolId?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  fileChange?: FileChange;
  sessionId?: string;
  /** Present when `type === 'image'`. Carries the full `data:image/...;base64,...`
   *  URL and parsed MIME. Frontend stores it as an `AssistantImage` on the
   *  streaming assistant message. */
  imageData?: { data: string; mediaType: string };
}

export interface CliAdapterConfig {
  cliPath: string;
  workingDir: string;
}

/** A discoverable skill (Agent Skills standard `SKILL.md`). `name` and
 *  `description` come from the file's YAML frontmatter; skills without a
 *  `description` are skipped (Pi refuses to load them; Claude mirrors that).
 *  `source` mirrors config layering; `pluginName` is set for plugin skills.
 *  `dir` is the skill's directory (parent of `SKILL.md`). */
export interface SkillEntry {
  name: string;
  description: string;
  source: 'user' | 'project' | 'plugin' | 'builtin';
  pluginName?: string;
  dir: string;
}

/** A discoverable slash command / prompt template. `name` is the trigger
 *  (e.g. `trellis:continue` for a Claude project command in
 *  `.claude/commands/trellis/continue.md`, or `review` for a Pi prompt
 *  template `~/.pi/agent/prompts/review.md`). `argumentHint` is the
 *  frontmatter `argument-hint` (optional). `file` is the source path. */
export interface CommandEntry {
  name: string;
  description: string;
  source: 'user' | 'project' | 'plugin' | 'builtin';
  argumentHint?: string;
  pluginName?: string;
  file: string;
}

export interface CliAgentDefinition {
  description?: string;
  prompt: string;
  /** Optional tool whitelist (e.g. ["Read","Edit","WebSearch"]). */
  tools?: string[];
}

/** Claude Code `--permission-mode` values. Controls how the CLI treats tools
 * that require permission. `bypassPermissions` (the historical default) grants
 * all tools; `plan` enables read-only research without side effects. */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

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
  /** Whether to run in `--bare` mode (isolated, no cwd agent discovery, no
   * CLAUDE.md/hooks loading). Defaults to `true` to preserve the existing
   * isolated behavior. Set to `false` to let Claude Code discover agents in
   * `<cwd>/.claude/agents/` and load the project's CLAUDE.md / settings. */
  bare?: boolean;
  /** `--permission-mode` value. Defaults to `bypassPermissions` to preserve the
   * historical full-tool behavior when unset. Use `plan` for read-only ask
   * mode, `acceptEdits` to auto-accept edits, etc. */
  permissionMode?: PermissionMode;
  /** Text appended to the CLI's default system prompt via
   * `--append-system-prompt`. Used by input modes to nudge reply style without
   * replacing the base system prompt. */
  systemPrompt?: string;
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
  /** List discoverable skills for the current session's cwd. Returns [] when
   *  the adapter has not been started (no workingDir) or the CLI exposes no
   *  on-disk skills. Built-in skills are not enumerable; see PRD Technical
   *  Notes for the known gap. */
  listSkills(): Promise<SkillEntry[]>;
  /** List discoverable slash commands / prompt templates for the current
   *  session's cwd. Returns [] when not started. Built-in session commands
   *  (`/clear`, `/help`, …) are NOT listed — they are hardcoded in the CLI
   *  and verified non-functional in `-p` one-shot mode. */
  listCommands(): Promise<CommandEntry[]>;
}
