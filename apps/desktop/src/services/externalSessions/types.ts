/**
 * Shared contract for external-session knowledge capture (Trellis task
 * 10-10-external-session-knowledge, slice 1).
 *
 * Two layers, kept strictly separate:
 *  - `ExternalSessionMessage` — the DISPLAY projection (what the Sessions
 *    panel renders). Normalized, deduped, tool-call/result correlated.
 *  - `rawRecord` / `rawToolRecords` — the verbatim source JSONL lines that
 *    back a message. Evidence captures copy these; `CliMessage` is NOT a
 *    lossless archive format.
 *
 * Slice 1 ships the Codex adapter only; `ExternalSessionSource` grows with
 * the Claude Code (slice 2) and pi (slice 3) adapters without changing the
 * list/detail/capture contracts below.
 */

/** Source tools with locally persisted, readable session records. */
export type ExternalSessionSource = 'codex';

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

export interface ExternalSessionDetail {
  summary: ExternalSessionSummary;
  messages: ExternalSessionMessage[];
  /** Session-level problems (unparsable lines, trailing incomplete record). */
  warnings: string[];
}
