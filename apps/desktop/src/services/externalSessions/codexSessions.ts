/**
 * Codex rollout reader — read-only adapter (slice 1).
 *
 * Mechanism (verified on this machine, Codex CLI 0.162.0-alpha.17.2):
 * plain read-only parsing of `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
 * plus `~/.codex/archived_sessions/rollout-*.jsonl` (flat). The app-server
 * `thread/list` / `thread/read` API is NOT exposed to Folyn, so raw parsing
 * is the single chosen mechanism — no SDK-vs-raw fallback pair.
 *
 * Format observed locally (outer envelope: `{timestamp, ordinal, type, payload}`):
 *  - `session_meta` — session id, cwd, originator, cli_version, timestamps.
 *  - `response_item` payloads: `message` (role user/developer/assistant,
 *    content parts `input_text` / `output_text` / image variants),
 *    `reasoning` (encrypted — not displayable), `function_call` /
 *    `custom_tool_call` + their `*_output` siblings correlated by `call_id`.
 *  - `event_msg` (incl. `item_completed` UserMessage duplicates),
 *    `world_state`, `turn_context`, `token_usage_record` — NOT used for the
 *    projection. Building the projection from `response_item` records only
 *    IS the event deduplication: the same user input appears as both a
 *    response_item and an event_msg.
 *  - Real user messages carry `content_item_kinds: ['user.text']`; injected
 *    context (AGENTS.md, environment, app pages) carries other kinds and is
 *    excluded from the display projection.
 *
 * The service is pure: all filesystem access goes through the injectable
 * `CodexSessionFs` port (Tauri adapter in `fs.tauri.ts`, in-memory shims in
 * tests). Reads never resume, migrate or mutate source sessions.
 */

import type {
  ExternalSessionDetail,
  ExternalSessionMessage,
  ExternalSessionSummary,
  ExternalToolCall,
  MissingMaterial,
} from './types';

/** Injectable FS port. Paths are absolute; the adapter owns resolution. */
export interface CodexSessionFs {
  /** Read up to `maxLines` text lines from a file. Missing file throws. */
  readLines(path: string, maxLines: number): Promise<string[]>;
  /** Read the entire file as UTF-8 text. */
  readTextFile(path: string): Promise<string>;
  /** Absolute paths of every `*.jsonl` file under `dir` (recursive). */
  listJsonlFiles(dir: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

export interface CodexDiscovery {
  sessions: ExternalSessionSummary[];
  /** Per-file read/parse problems — reported per source, never fatal. */
  errors: string[];
}

const INDEX_FILE = 'session_index.jsonl';
const SESSIONS_DIR = 'sessions';
const ARCHIVED_DIR = 'archived_sessions';

// ponytail: context-injection filter keys off `content_item_kinds`, which the
// desktop CLI writes on every user message. Rollouts from CLI versions without
// that field show ALL user messages — acceptable: pre-desktop rollouts were
// not context-stuffed. Upgrade only if an old rollout proves noisy.
const USER_TEXT_KIND = 'user.text';

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

/** `rollout-2026-10-10T22-12-33-<uuid>.jsonl` → `2026-10-10 22:12`. */
function titleFromFilename(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  const m = base.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  return '';
}

/** Session id from a `rollout-...-<uuid>.jsonl` filename (last 5 dash groups). */
export function sessionIdFromFilename(filePath: string): string | null {
  const base = (filePath.split('/').pop() ?? '').replace(/\.jsonl$/, '');
  const parts = base.split('-');
  if (parts.length < 6) return null;
  return parts.slice(-5).join('-');
}

interface SessionIndexEntry {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

async function readSessionIndex(root: string, fs: CodexSessionFs): Promise<Map<string, SessionIndexEntry>> {
  const map = new Map<string, SessionIndexEntry>();
  const index = joinPath(root, INDEX_FILE);
  if (!(await fs.exists(index))) return map;
  try {
    const text = await fs.readTextFile(index);
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as SessionIndexEntry;
        if (typeof entry.id === 'string') map.set(entry.id, entry);
      } catch {
        // tolerate a torn trailing index line — the sessions still list
      }
    }
  } catch {
    // unreadable index → titles fall back to filename; not an error source
  }
  return map;
}

/** Parse the first `session_meta` record of a rollout (bounded head read). */
async function readSessionMeta(filePath: string, fs: CodexSessionFs): Promise<Record<string, unknown> | null> {
  const lines = await fs.readLines(filePath, 5);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const o = JSON.parse(trimmed) as { type?: string; payload?: unknown };
      if (o.type === 'session_meta' && o.payload && typeof o.payload === 'object') {
        return o.payload as Record<string, unknown>;
      }
    } catch {
      return null; // torn first line — no metadata for this file
    }
  }
  return null;
}

function summaryFromMeta(
  filePath: string,
  meta: Record<string, unknown> | null,
  indexEntry: SessionIndexEntry | undefined,
): ExternalSessionSummary {
  const sessionIdFromMeta = typeof meta?.session_id === 'string' ? (meta.session_id as string) : null;
  const sessionId = sessionIdFromMeta ?? sessionIdFromFilename(filePath) ?? filePath;
  return {
    source: 'codex',
    sessionId,
    filePath,
    title: indexEntry?.thread_name ?? titleFromFilename(filePath),
    cwd: typeof meta?.cwd === 'string' ? (meta.cwd as string) : null,
    startedAt: parseTimestamp(meta?.timestamp),
    updatedAt: parseTimestamp(indexEntry?.updated_at) ?? parseTimestamp(meta?.timestamp),
    parentSessionId: typeof meta?.parent_session_id === 'string' ? (meta.parent_session_id as string) : null,
  };
}

/** Discover every readable Codex rollout under `root` (default `~/.codex`). */
export async function discoverCodexSessions(root: string, fs: CodexSessionFs): Promise<CodexDiscovery> {
  const errors: string[] = [];
  const sessions: ExternalSessionSummary[] = [];
  const seen = new Set<string>();

  const index = await readSessionIndex(root, fs);

  // Active directory first — a session duplicated in the archive loses to it.
  const roots = [joinPath(root, SESSIONS_DIR), joinPath(root, ARCHIVED_DIR)];
  for (const dir of roots) {
    if (!(await fs.exists(dir))) continue; // missing root = empty source
    let files: string[] = [];
    try {
      files = await fs.listJsonlFiles(dir);
    } catch (err) {
      errors.push(`${dir}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const filePath of files.sort()) {
      try {
        const meta = await readSessionMeta(filePath, fs);
        const summary = summaryFromMeta(filePath, meta, index.get(sessionIdFromFilename(filePath) ?? ''));
        if (!seen.has(summary.sessionId)) {
          seen.add(summary.sessionId);
          sessions.push(summary);
        }
      } catch (err) {
        errors.push(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  sessions.sort((a, b) => (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0));
  return { sessions, errors };
}

// ── Rollout parsing ───────────────────────────────────────────────────────────

interface ContentPart {
  type?: unknown;
  text?: unknown;
  image_url?: unknown;
  url?: unknown;
}

interface ResponseItemPayload {
  type?: string;
  id?: string;
  role?: string;
  content?: ContentPart[];
  call_id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  output?: unknown;
  internal_chat_message_metadata_passthrough?: { content_item_kinds?: unknown };
}

interface RolloutRecord {
  timestamp?: unknown;
  type?: string;
  payload?: ResponseItemPayload;
}

function textOfPart(part: ContentPart): string {
  return typeof part.text === 'string' ? part.text : '';
}

/** Normalize a tool result: string (possibly JSON-wrapped) or structured parts. */
function normalizeToolOutput(output: unknown): string | null {
  if (output == null) return null;
  if (typeof output === 'string') {
    // `function_call_output` wraps the payload as a JSON string
    // `{"output": "...", "metadata": {...}}` — unwrap when it parses.
    try {
      const parsed = JSON.parse(output) as { output?: unknown };
      if (parsed && typeof parsed === 'object' && 'output' in parsed) {
        const inner = parsed.output;
        if (typeof inner === 'string') return inner;
        if (Array.isArray(inner)) return inner.map((p) => textOfPart(p as ContentPart)).join('');
      }
    } catch {
      // plain text output — use verbatim
    }
    return output;
  }
  if (Array.isArray(output)) {
    return output.map((p) => textOfPart(p as ContentPart)).join('');
  }
  return JSON.stringify(output);
}

const TOOL_CALL_TYPES = new Set(['function_call', 'custom_tool_call']);
const TOOL_OUTPUT_TYPES = new Set(['function_call_output', 'custom_tool_call_output']);

function isUserConversationMessage(payload: ResponseItemPayload): boolean {
  if (payload.role !== 'user') return false;
  const kinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds;
  if (Array.isArray(kinds)) {
    return kinds.some((k) => k === USER_TEXT_KIND);
  }
  return true; // no kind metadata — treat as real user input (see ponytail above)
}

/** First displayed user message, single-lined, for title fallback. */
function firstUserText(messages: ExternalSessionMessage[]): string | null {
  const first = messages.find((m) => m.role === 'user' && m.content.trim() !== '');
  if (!first) return null;
  const oneLine = first.content.trim().replace(/\s+/g, ' ');
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}

/**
 * Parse a full rollout JSONL text into a display projection. A trailing
 * unfinished line is skipped with a warning — preceding complete records stay
 * intact. Unknown record types are counted in the warnings, not displayed.
 */
export function parseCodexRollout(text: string): {
  summaryMeta: Record<string, unknown> | null;
  messages: ExternalSessionMessage[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const messages: ExternalSessionMessage[] = [];
  let summaryMeta: Record<string, unknown> | null = null;

  // callId → { call, ownerMessage } for result correlation
  const openCalls = new Map<string, { call: ExternalToolCall; owner: ExternalSessionMessage }>();
  const skippedTypes = new Map<string, number>();

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;

    let record: RolloutRecord;
    try {
      record = JSON.parse(line) as RolloutRecord;
    } catch {
      // Only a TORN trailing line can fail to parse here (complete lines are
      // well-formed JSON). Earlier records are unaffected.
      warnings.push(`line ${i + 1}: incomplete/unparsable record (skipped)`);
      continue;
    }

    if (record.type === 'session_meta') {
      if (record.payload && typeof record.payload === 'object') {
        summaryMeta = record.payload as unknown as Record<string, unknown>;
      }
      continue;
    }
    if (record.type !== 'response_item') continue; // event_msg/world_state/… — see header
    const payload = record.payload;
    if (!payload || typeof payload !== 'object') continue;

    const ts = parseTimestamp(record.timestamp);
    const type = payload.type ?? '';

    if (type === 'message') {
      const role = payload.role === 'assistant' ? 'assistant' : payload.role === 'user' ? 'user' : null;
      if (role === null) continue; // developer/system instructions — not conversation
      if (role === 'user' && !isUserConversationMessage(payload)) continue; // injected context

      const images: ExternalSessionMessage['images'] = [];
      const missing: MissingMaterial[] = [];
      let content = '';
      for (const part of payload.content ?? []) {
        const partType = typeof part.type === 'string' ? part.type : '';
        if (partType.includes('image')) {
          const url = typeof part.image_url === 'string' ? part.image_url : typeof part.url === 'string' ? part.url : null;
          if (url && url.startsWith('data:')) {
            images.push({ dataUrl: url });
          } else {
            missing.push({
              kind: 'image',
              reason: url
                ? 'image stored by file reference in the source (not inline) — bytes not obtainable'
                : 'image record without a readable URL',
            });
          }
        } else {
          content += textOfPart(part);
        }
      }
      messages.push({
        id: `msg-${i}`,
        role,
        content,
        timestamp: ts,
        images,
        missing,
        toolCalls: [],
        rawRecord: lines[i]!,
        rawToolRecords: [],
      });
      continue;
    }

    if (TOOL_CALL_TYPES.has(type)) {
      const callId = payload.call_id ?? payload.id ?? `unknown-${i}`;
      const input = typeof payload.input === 'string' ? payload.input
        : typeof payload.arguments === 'string' ? payload.arguments
        : payload.input != null ? JSON.stringify(payload.input) : '';
      const call: ExternalToolCall = {
        callId,
        name: payload.name ?? type,
        input,
        output: null,
      };
      // Attach to the latest message (Codex emits calls after the assistant
      // message they belong to). No message yet → synthetic assistant holder.
      let owner = messages[messages.length - 1];
      if (!owner) {
        owner = {
          id: `msg-${i}`,
          role: 'assistant',
          content: '',
          timestamp: ts,
          images: [],
          missing: [],
          toolCalls: [],
          rawRecord: '',
          rawToolRecords: [],
        };
        messages.push(owner);
      }
      owner.toolCalls.push(call);
      owner.rawToolRecords.push(lines[i]!);
      openCalls.set(callId, { call, owner });
      continue;
    }

    if (TOOL_OUTPUT_TYPES.has(type)) {
      const callId = payload.call_id ?? '';
      const open = openCalls.get(callId);
      const output = normalizeToolOutput(payload.output);
      if (open) {
        open.call.output = output;
        open.owner.rawToolRecords.push(lines[i]!);
      } else {
        warnings.push(`line ${i + 1}: tool output without a matching call (skipped)`);
      }
      continue;
    }

    // reasoning (encrypted), web_search_call, local_shell_call, … — counted
    // honestly, not displayed. ponytail: retained-as-evidence for unknown
    // types arrives when a real rollout on some machine needs it.
    skippedTypes.set(type || '(empty)', (skippedTypes.get(type || '(empty)') ?? 0) + 1);
  }

  // Calls whose result never arrived are missing tool output — explicit.
  for (const { call, owner } of openCalls.values()) {
    if (call.output === null) {
      owner.missing.push({ kind: 'tool-output', reason: `no result record for tool call ${call.name} (${call.callId})` });
    }
  }

  if (skippedTypes.size > 0) {
    const parts = [...skippedTypes.entries()].map(([t, n]) => `${t}×${n}`);
    warnings.push(`unsupported record types not displayed: ${parts.join(', ')}`);
  }

  return { summaryMeta, messages, warnings };
}

/**
 * Read one session's full detail. `summary` comes from discovery; the title
 * is refined to the first user message when the session index had no name.
 */
export async function readCodexSession(
  summary: ExternalSessionSummary,
  fs: CodexSessionFs,
): Promise<ExternalSessionDetail> {
  const text = await fs.readTextFile(summary.filePath);
  const { summaryMeta, messages, warnings } = parseCodexRollout(text);
  const refinedTitle = summary.title || firstUserText(messages) || summary.sessionId.slice(0, 8);
  return {
    summary: {
      ...summary,
      title: refinedTitle,
      cwd: typeof summaryMeta?.cwd === 'string' ? (summaryMeta.cwd as string) : summary.cwd,
      startedAt: summary.startedAt ?? parseTimestamp(summaryMeta?.timestamp),
    },
    messages,
    warnings,
  };
}
