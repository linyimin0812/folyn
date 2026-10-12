/**
 * Claude Code transcript reader — read-only adapter (slice 2).
 *
 * Mechanism (verified on this machine, Claude Code 2.1.114–2.1.296): plain
 * read-only parsing of `~/.claude/projects/<encoded-project>/<session-id>.jsonl`.
 * Chosen over the Agent SDK `listSessions`/`getSessionMessages`: those spawn a
 * `claude` process and add a runtime dependency, while the JSONL records
 * already provide everything the capture needs (cwd, timestamps, tool_use /
 * tool_result correlation, inline base64 images). `claude -p --resume` is
 * forbidden — it creates new session messages.
 *
 * Format observed locally (flat records, NOT a Codex-style envelope):
 *  - Every record carries: `type`, `uuid`, `parentUuid`, `sessionId`,
 *    `timestamp` (ISO), `cwd`, `version`, `gitBranch`, `isSidechain`,
 *    `userType`. The entry format is internal and version-varying — unknown
 *    types are counted in warnings, never fatal.
 *  - `user`: `message = {role, content}` — content is either a STRING (the
 *    typed prompt) or an ARRAY of `tool_result` blocks (`tool_use_id` +
 *    content: string or block array incl. base64 images). `isMeta: true`
 *    marks injected context (local-command caveats) — excluded, like Codex's
 *    content_item_kinds filter.
 *  - `assistant`: `message.content` is an ARRAY of blocks: `text`,
 *    `thinking` (display-hidden, known category), `tool_use` (id `toolu_*`,
 *    name, input OBJECT).
 *  - `attachment` (hook output), `system`, `last-prompt`, `mode`,
 *    `permission-mode`, `ai-title`/`custom-title`, `cost-state`,
 *    `file-history-*`, `queue-operation`, `agent-name`, `atis-latch` — not
 *    conversation; skipped silently (known bookkeeping).
 *  - Project identity: the project directory slug is NOT reversible — cwd
 *    comes from the records' own `cwd` field.
 *  - Branching copies history into a NEW session file: one file = one
 *    session, no in-file branch merge. A session id duplicated across
 *    project dirs resolves to the first sorted path (deterministic).
 *  - Sidechain (subagent) records (`isSidechain: true`; not observed on this
 *    machine but the field is on every record) are excluded from the
 *    displayed conversation and noted in the warnings.
 *
 * Pure module: filesystem access goes through the injectable
 * `ClaudeSessionFs` port (Tauri adapter in `fs.tauri.ts`, in-memory shims in
 * tests). Reads never resume, migrate or mutate source sessions.
 */

import { LINEAR_BRANCH } from './types';
import { errorToMessage } from './errorToMessage';
import type { CodexSessionFs } from './codexSessions';
import type {
  ExternalSessionDetail,
  ExternalSessionMessage,
  ExternalSessionSummary,
  ExternalToolCall,
  MissingMaterial,
} from './types';

/** Injectable FS port. `mtime` backs the list's "last updated" ordering. */
export interface ClaudeSessionFs extends CodexSessionFs {
  /** File modification time, epoch ms. Null when unavailable. */
  mtime(path: string): Promise<number | null>;
}

export interface ClaudeDiscovery {
  sessions: ExternalSessionSummary[];
  /** Per-file read/parse problems — reported per source, never fatal. */
  errors: string[];
}

// ponytail: head-read bound for discovery summaries. The first typed prompt
// usually lands within the first ~40 lines; sessions with very long hook /
// attachment preambles fall back to a detail-read title refinement.
const HEAD_LINES = 80;

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

interface ClaudeRecord {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: unknown;
  cwd?: unknown;
  sessionId?: unknown;
  message?: { role?: string; content?: unknown };
  title?: unknown;
}

interface ContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  source?: { type?: string; media_type?: string; data?: string };
}

/** `toolu_…` id, or null when the record carries none. */
function toolUseIdOf(block: ContentBlock): string | null {
  if (typeof block.id === 'string' && block.id !== '') return block.id;
  if (typeof block.tool_use_id === 'string' && block.tool_use_id !== '') return block.tool_use_id;
  return null;
}

function isBlockArray(content: unknown): content is ContentBlock[] {
  return Array.isArray(content);
}

// Known-and-expected non-conversation entry types — excluded from the
// projection AND from warnings (they appear in every real transcript; warning
// on them is noise). `file-history-*` is a family (snapshot, restore, …).
// Only genuinely unknown entry types warn (real format-drift signal).
const KNOWN_NON_CONVERSATION_TYPES = new Set([
  'attachment', 'system', 'last-prompt', 'mode', 'permission-mode',
  'ai-title', 'custom-title', 'cost-state', 'queue-operation',
  'agent-name', 'atis-latch',
]);
const KNOWN_NON_CONVERSATION_PREFIXES = ['file-history-'];

function isKnownNonConversation(type: string | undefined): boolean {
  if (type == null) return false; // '(empty)' — unknown, warn
  return (
    KNOWN_NON_CONVERSATION_TYPES.has(type) ||
    KNOWN_NON_CONVERSATION_PREFIXES.some((p) => type.startsWith(p))
  );
}

/** Inline image block → data URL, or a non-speculative missing reason. */
function imageFromBlock(block: ContentBlock): { dataUrl: string } | { missing: MissingMaterial } {
  const source = block.source;
  if (source && typeof source.data === 'string' && source.data !== '') {
    const mime = typeof source.media_type === 'string' ? source.media_type : 'application/octet-stream';
    return { dataUrl: `data:${mime};base64,${source.data}` };
  }
  return {
    missing: {
      kind: 'image',
      reason: 'image source without inline base64 data — bytes not obtainable',
    },
  };
}

/** Text of a tool_result content: verbatim string, or concatenated text blocks. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (isBlockArray(content)) {
    return content.map((b) => (typeof b.text === 'string' ? b.text : '')).join('');
  }
  return '';
}

/** First displayed user message, single-lined, for title fallback. */
function firstUserText(messages: ExternalSessionMessage[]): string | null {
  const first = messages.find((m) => m.role === 'user' && m.content.trim() !== '');
  if (!first) return null;
  const oneLine = first.content.trim().replace(/\s+/g, ' ');
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}

// ── Discovery ──────────────────────────────────────────────────────────────────

interface HeadScan {
  cwd: string | null;
  sessionId: string | null;
  startedAt: number | null;
  title: string;
}

/** Bounded head scan: cwd/sessionId/start from the first records, title from
 * a `custom-title`/`ai-title` entry or the first typed prompt. */
async function scanHead(filePath: string, fs: ClaudeSessionFs): Promise<HeadScan | null> {
  let lines: string[];
  try {
    lines = await fs.readLines(filePath, HEAD_LINES);
  } catch {
    return null; // unreadable head — surfaced as a discovery error by caller
  }
  const scan: HeadScan = { cwd: null, sessionId: null, startedAt: null, title: '' };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let record: ClaudeRecord;
    try {
      record = JSON.parse(trimmed) as ClaudeRecord;
    } catch {
      continue; // torn line inside the head — later records still speak
    }
    if (scan.cwd === null && typeof record.cwd === 'string') scan.cwd = record.cwd;
    if (scan.sessionId === null && typeof record.sessionId === 'string') scan.sessionId = record.sessionId;
    if (scan.startedAt === null) scan.startedAt = parseTimestamp(record.timestamp);
    if (scan.title === '' && (record.type === 'custom-title' || record.type === 'ai-title')) {
      if (typeof record.title === 'string' && record.title !== '') scan.title = record.title;
    }
    if (scan.title === '' && record.type === 'user' && record.isMeta !== true) {
      const content = record.message?.content;
      if (typeof content === 'string' && content.trim() !== '') {
        const oneLine = content.trim().replace(/\s+/g, ' ');
        scan.title = oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
      }
    }
  }
  return scan;
}

function sessionIdFromFilename(filePath: string): string {
  return (filePath.split('/').pop() ?? filePath).replace(/\.jsonl$/, '');
}

/** Discover every readable Claude Code session under `root` (default `~/.claude/projects`). */
export async function discoverClaudeSessions(
  root: string,
  fs: ClaudeSessionFs,
): Promise<ClaudeDiscovery> {
  const errors: string[] = [];
  const sessions: ExternalSessionSummary[] = [];
  const seen = new Set<string>();

  if (!(await fs.exists(root))) return { sessions, errors }; // missing root = empty source
  let files: string[] = [];
  try {
    files = await fs.listJsonlFiles(root);
  } catch (err) {
    return { sessions, errors: [`${root}: ${errorToMessage(err)}`] };
  }

  for (const filePath of files.sort()) {
    try {
      const scan = await scanHead(filePath, fs);
      if (scan === null) throw new Error('unreadable file head');
      const sessionId = scan.sessionId ?? sessionIdFromFilename(filePath);
      // Same session id in two project dirs = duplicate physical copy —
      // first sorted path wins, deterministic, never merged.
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);
      sessions.push({
        source: 'claude',
        sessionId,
        filePath,
        title: scan.title,
        cwd: scan.cwd, // recorded cwd — the dir slug is NOT reversible
        startedAt: scan.startedAt,
        updatedAt: await fs.mtime(filePath),
        parentSessionId: null, // Claude records carry no parent-session field
      });
    } catch (err) {
      errors.push(`${filePath}: ${errorToMessage(err)}`);
    }
  }

  sessions.sort((a, b) => (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0));
  return { sessions, errors };
}

// ── Transcript parsing ─────────────────────────────────────────────────────────

interface ParseResult {
  messages: ExternalSessionMessage[];
  warnings: string[];
  /** First record's cwd / timestamp — summary fallbacks for legacy records. */
  firstCwd: string | null;
  firstTimestamp: number | null;
}

/**
 * Parse a full transcript JSONL into a display projection. A trailing
 * unfinished line is skipped with a warning — preceding complete records stay
 * intact. Known non-conversation entry types are skipped silently; genuinely
 * unknown entry types are counted in the warnings, not displayed.
 */
export function parseClaudeTranscript(text: string): ParseResult {
  const warnings: string[] = [];
  const messages: ExternalSessionMessage[] = [];
  let firstCwd: string | null = null;
  let firstTimestamp: number | null = null;

  // toolUseId → { call, ownerMessage } for result correlation
  const openCalls = new Map<string, { call: ExternalToolCall; owner: ExternalSessionMessage }>();
  const skippedTypes = new Map<string, number>();
  let sidechainCount = 0;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;

    let record: ClaudeRecord;
    try {
      record = JSON.parse(line) as ClaudeRecord;
    } catch {
      // Only a TORN trailing line can fail to parse here. Earlier records
      // are unaffected.
      warnings.push(`line ${i + 1}: incomplete/unparsable record (skipped)`);
      continue;
    }

    if (firstCwd === null && typeof record.cwd === 'string') firstCwd = record.cwd;
    if (firstTimestamp === null) firstTimestamp = parseTimestamp(record.timestamp);

    if (record.type !== 'user' && record.type !== 'assistant') {
      // attachment/system/last-prompt/mode/… — known bookkeeping, skipped
      // silently (see KNOWN_NON_CONVERSATION_TYPES); unknown types warn.
      if (!isKnownNonConversation(record.type)) {
        skippedTypes.set(record.type ?? '(empty)', (skippedTypes.get(record.type ?? '(empty)') ?? 0) + 1);
      }
      continue;
    }
    if (record.isSidechain === true) {
      sidechainCount += 1;
      continue; // subagent records — excluded, noted below
    }

    const ts = parseTimestamp(record.timestamp);
    const content = record.message?.content;

    if (record.type === 'user') {
      if (record.isMeta === true) continue; // injected context (local-command caveats)

      if (typeof content === 'string') {
        messages.push({
          id: `msg-${i}`,
          role: 'user',
          content,
          timestamp: ts,
          images: [],
          missing: [],
          toolCalls: [],
          rawRecord: lines[i]!,
          rawToolRecords: [],
        });
        continue;
      }

      // Array content: tool_result blocks (correlated) + text/image blocks.
      if (isBlockArray(content)) {
        let text = '';
        const images: ExternalSessionMessage['images'] = [];
        const missing: MissingMaterial[] = [];
        for (const block of content) {
          const blockType = typeof block.type === 'string' ? block.type : '';
          if (blockType === 'text') {
            text += typeof block.text === 'string' ? block.text : '';
          } else if (blockType === 'image') {
            const img = imageFromBlock(block);
            if ('dataUrl' in img) images.push({ dataUrl: img.dataUrl });
            else missing.push(img.missing);
          } else if (blockType === 'tool_result') {
            const callId = toolUseIdOf(block);
            const output = toolResultText(block.content);
            const open = callId != null ? openCalls.get(callId) : undefined;
            if (open) {
              // A found result record sets output even when its text is empty;
              // null (missing) is reserved for calls with no result record.
              open.call.output = output;
              open.owner.rawToolRecords.push(lines[i]!);
              // Images inside the tool result are obtainable attachments —
              // attached to the owner message so the capture copies them.
              if (isBlockArray(block.content)) {
                for (const inner of block.content) {
                  if (inner.type === 'image') {
                    const img = imageFromBlock(inner);
                    if ('dataUrl' in img) open.owner.images.push({ dataUrl: img.dataUrl });
                    else open.owner.missing.push(img.missing);
                  }
                }
              }
            } else {
              warnings.push(`line ${i + 1}: tool result without a matching call (skipped)`);
            }
          }
        }
        if (text !== '' || images.length > 0) {
          messages.push({
            id: `msg-${i}`,
            role: 'user',
            content: text,
            timestamp: ts,
            images,
            missing,
            toolCalls: [],
            rawRecord: lines[i]!,
            rawToolRecords: [],
          });
        } else if (missing.length > 0) {
          // No displayable content, but the record reported missing images —
          // attribute them to the latest message so they stay visible.
          const owner = messages[messages.length - 1];
          if (owner) owner.missing.push(...missing);
        }
      }
      continue;
    }

    // assistant: content is a block array (string tolerated for safety).
    const blocks: ContentBlock[] = isBlockArray(content)
      ? content
      : typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : [];

    let text = '';
    const images: ExternalSessionMessage['images'] = [];
    const missing: MissingMaterial[] = [];
    const toolCalls: ExternalToolCall[] = [];
    for (const block of blocks) {
      const blockType = typeof block.type === 'string' ? block.type : '';
      if (blockType === 'text') {
        text += typeof block.text === 'string' ? block.text : '';
      } else if (blockType === 'image') {
        const img = imageFromBlock(block);
        if ('dataUrl' in img) images.push({ dataUrl: img.dataUrl });
        else missing.push(img.missing);
      } else if (blockType === 'tool_use') {
        const callId = toolUseIdOf(block) ?? `unknown-${i}`;
        const input = block.input != null ? JSON.stringify(block.input) : '';
        const call: ExternalToolCall = { callId, name: block.name ?? 'tool', input, output: null };
        toolCalls.push(call);
      }
      // 'thinking' — display-hidden known category, silently skipped (the
      // entry's rawRecord is retained when the entry also has text/tools).
    }
    if (text !== '' || images.length > 0 || toolCalls.length > 0) {
      const message: ExternalSessionMessage = {
        id: `msg-${i}`,
        role: 'assistant',
        content: text,
        timestamp: ts,
        images,
        missing,
        toolCalls,
        rawRecord: lines[i]!,
        rawToolRecords: [],
      };
      messages.push(message);
      for (const call of toolCalls) {
        openCalls.set(call.callId, { call, owner: message });
      }
    }
  }

  // Calls whose result never arrived are missing tool output — explicit.
  for (const { call, owner } of openCalls.values()) {
    if (call.output === null) {
      owner.missing.push({ kind: 'tool-output', reason: `no result record for tool call ${call.name} (${call.callId})` });
    }
  }

  if (sidechainCount > 0) {
    warnings.push(`${sidechainCount} sidechain (subagent) records not shown`);
  }
  if (skippedTypes.size > 0) {
    const parts = [...skippedTypes.entries()].map(([t, n]) => `${t}×${n}`);
    warnings.push(`unsupported record types not displayed: ${parts.join(', ')}`);
  }

  return { messages, warnings, firstCwd, firstTimestamp };
}

/**
 * Read one session's full detail. `summary` comes from discovery; the title
 * is refined to the first typed prompt when no title entry exists.
 */
export async function readClaudeSession(
  summary: ExternalSessionSummary,
  fs: ClaudeSessionFs,
): Promise<ExternalSessionDetail> {
  const text = await fs.readTextFile(summary.filePath);
  const { messages, warnings, firstCwd, firstTimestamp } = parseClaudeTranscript(text);
  const refinedTitle = summary.title || firstUserText(messages) || summary.sessionId.slice(0, 8);
  return {
    summary: {
      ...summary,
      title: refinedTitle,
      cwd: summary.cwd ?? firstCwd,
      startedAt: summary.startedAt ?? firstTimestamp,
    },
    messages,
    warnings,
    branch: LINEAR_BRANCH, // one transcript file = one linear branch
  };
}
