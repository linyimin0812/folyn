/**
 * Machine-parsable source locator for saved session captures (slice 6).
 *
 * A capture note ends with a fenced `folyn-session` code block whose content
 * is `renderSourceLocator(...)` output. The Sessions panel's "open by
 * locator" affordance reads that block from the clipboard and navigates:
 * the live session + recorded branch when the source still exists (with a
 * changed-content notice when recorded message ids no longer resolve),
 * otherwise the saved evidence bundle via its vault-relative path.
 *
 * Format (one `key: value` per line; the FIRST line is the format marker):
 *   folyn-session-locator/1
 *   source: codex | claude | pi
 *   session: <native session id>
 *   file: <absolute source file path>         (when known)
 *   branch: <branch id>                       (branched sessions only)
 *   messages: <id>, <id>                      (whole-message selections)
 *   ranges: <id>[<start>,<end>), …            (text-range selections)
 *   evidence: <vault-relative bundle path>    (missing-source fallback)
 *
 * Parsing REQUIRES the marker line — arbitrary pasted note text (localized
 * provenance lines such as "来源工具: codex") must never parse as a locator.
 * Pure module: no i18n, no Tauri, no React.
 */
import type { ExternalSessionSource } from './types';

export const LOCATOR_FORMAT = 'folyn-session-locator/1';

export interface SourceLocatorRange {
  messageId: string;
  start: number;
  end: number;
}

export interface SourceLocator {
  source: ExternalSessionSource;
  sessionId: string;
  filePath: string | null;
  branchId: string | null;
  messageIds: string[];
  ranges: SourceLocatorRange[];
  evidencePath: string | null;
}

const SOURCES: readonly ExternalSessionSource[] = ['codex', 'claude', 'pi'];

function renderRange(r: SourceLocatorRange): string {
  return `${r.messageId}[${r.start},${r.end})`;
}

export function renderSourceLocator(loc: SourceLocator): string {
  const lines: string[] = [
    LOCATOR_FORMAT,
    `source: ${loc.source}`,
    `session: ${loc.sessionId}`,
  ];
  if (loc.filePath) lines.push(`file: ${loc.filePath}`);
  if (loc.branchId) lines.push(`branch: ${loc.branchId}`);
  if (loc.messageIds.length > 0) lines.push(`messages: ${loc.messageIds.join(', ')}`);
  if (loc.ranges.length > 0) lines.push(`ranges: ${loc.ranges.map(renderRange).join(', ')}`);
  if (loc.evidencePath) lines.push(`evidence: ${loc.evidencePath}`);
  return lines.join('\n');
}

/** Parse a pasted locator block (whole code block or just its content).
 * Returns null when the marker is absent, the source is unknown, the
 * session id is missing, or a range coordinate is malformed — refuse
 * rather than guess. */
export function parseSourceLocator(text: string): SourceLocator | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (!lines.includes(LOCATOR_FORMAT)) return null;

  const values: Record<string, string> = {};
  for (const line of lines) {
    const m = /^(\w+):\s*(.+)$/.exec(line);
    if (m) values[m[1]!] = m[2]!.trim();
  }

  const source = values['source'] as ExternalSessionSource | undefined;
  if (!source || !SOURCES.includes(source)) return null;
  const sessionId = values['session'];
  if (!sessionId) return null;

  const messageIds = (values['messages'] ?? '')
    .split(',').map((s) => s.trim()).filter((s) => s !== '');

  const ranges: SourceLocatorRange[] = [];
  const rangesRaw = values['ranges'];
  if (rangesRaw) {
    // Scanner, NOT split(','): a range token `msg-5[12,40)` itself contains a
    // comma. Each iteration must consume one complete token + its separator,
    // otherwise the coordinates are malformed — refuse rather than guess.
    let rest = rangesRaw;
    while (rest !== '') {
      const m = /^\s*(\S+)\[(\d+),(\d+)\)\s*(?:,|$)/.exec(rest);
      if (!m) return null;
      ranges.push({ messageId: m[1]!, start: Number(m[2]), end: Number(m[3]) });
      rest = rest.slice(m[0].length);
    }
  }

  return {
    source,
    sessionId,
    filePath: values['file'] ?? null,
    branchId: values['branch'] ?? null,
    messageIds,
    ranges,
    evidencePath: values['evidence'] ?? null,
  };
}
