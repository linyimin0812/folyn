/**
 * Shared contract for external-session knowledge capture (Trellis task
 * 10-10-external-session-knowledge, slices 1-4).
 *
 * Two layers, kept strictly separate:
 *  - `ExternalSessionMessage` — the DISPLAY projection (what the Sessions
 *    panel renders). Normalized, deduped, tool-call/result correlated.
 *  - `rawRecord` / `rawToolRecords` — the verbatim source JSONL lines that
 *    back a message. Evidence captures copy these; `CliMessage` is NOT a
 *    lossless archive format.
 *
 * Slices 1-3 ship the Codex, Claude Code and pi adapters. Slice 3 adds the
 * branch projection: pi records form a parent-child tree; the detail carries
 * the projected messages of ONE branch plus the branch list to switch to.
 * Slice 4 adds text-range selection: one contiguous excerpt inside a single
 * message, identified by coordinates against the message's canonical text.
 */

/** Source tools with locally persisted, readable session records. */
export type ExternalSessionSource = 'codex' | 'claude' | 'pi';

export interface ExternalSessionSummary {
  source: ExternalSessionSource;
  /** Native session id from the source tool (identity: source + this id). */
  sessionId: string;
  /** Absolute path of the physical record file. */
  filePath: string;
  /** Session index name when known; otherwise derived fallback. May be ''. */
  title: string;
  /** Recorded working directory — project identity. Null when unknown. */
  cwd: string | null;
  /** Session start, epoch ms. Null when unknown. */
  startedAt: number | null;
  /** Last known update, epoch ms. Null when unknown. */
  updatedAt: number | null;
  /** Fork/parent linkage when the source records it (Codex session_meta
   * fork/parent fields). Null when the session has no parent. */
  parentSessionId: string | null;
}

export interface MissingMaterial {
  kind: 'image' | 'tool-output';
  /** Human-readable, non-speculative reason (encrypted / file-id reference /
   * result absent / …). */
  reason: string;
}

/** An inline image that could be obtained as a data URL. */
export interface ExternalImage {
  dataUrl: string;
}

export interface ExternalToolCall {
  callId: string;
  name: string;
  /** Raw input payload from the source (JSON string for Codex function calls). */
  input: string;
  /** Null when the correlated result record is absent. */
  output: string | null;
}

export interface ExternalSessionMessage {
  /** Stable within a session: `msg-<line ordinal of the record>`. */
  id: string;
  role: 'user' | 'assistant';
  /** Concatenated text parts, verbatim. */
  content: string;
  timestamp: number | null;
  images: ExternalImage[];
  /** Inline images that could NOT be obtained, with reasons. */
  missing: MissingMaterial[];
  /** Tool calls correlated to this message (call + result via call_id). */
  toolCalls: ExternalToolCall[];
  /** Verbatim JSONL line of the message record itself. */
  rawRecord: string;
  /** Verbatim JSONL lines of the correlated tool call/result records. */
  rawToolRecords: string[];
}

/** One branch of a session's parent-child record tree (slice 3, pi).
 * `id` is stable source identity (the branch-tip record id); `label` is a
 * human fallback (first words of the branch's first user message). */
export interface ExternalSessionBranch {
  id: string;
  label: string;
}

/** Branch info for linear (single-branch) sources — Codex/Claude Code store
 * one branch per physical file, so they report this trivial branch and the
 * UI contract stays uniform across sources. */
export const LINEAR_BRANCH: { currentId: string; all: ExternalSessionBranch[] } = {
  currentId: 'main',
  all: [{ id: 'main', label: '' }],
};

/** One contiguous verbatim text excerpt selected inside a single message
 * (slice 4). Coordinates are half-open [start, end) against the message's
 * CANONICAL TEXT — `ExternalSessionMessage.content`, the concatenated
 * verbatim text parts of the source record. The definition is uniform across
 * all three adapters, so coordinates reproduce the same slice everywhere.
 *
 * v1 model: one range per message. A range contributes ONLY that text: the
 * rest of the message, its images and its tool records stay OUT of the
 * capture (selecting text does not authorize the rest of the message). */
export interface TextRangeSelection {
  messageId: string;
  start: number;
  end: number;
}

export interface ExternalSessionDetail {
  summary: ExternalSessionSummary;
  messages: ExternalSessionMessage[];
  /** Session-level problems (unparsable lines, trailing incomplete record). */
  warnings: string[];
  /** Branch projection (slice 3): which branch `messages` belongs to and the
   * branches the user can switch to. Selected evidence always comes from the
   * current branch — other branches are never silently included. */
  branch: {
    currentId: string;
    all: ExternalSessionBranch[];
  };
}
