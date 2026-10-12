/**
 * Verbatim capture — turns a selection of external-session messages into a
 * Markdown note plus a companion evidence bundle inside the vault.
 *
 * Contract (spec.md, slice 1):
 *  - The note is published ONLY after its evidence bundle and assets have
 *    been written (write order: assets → records.json → note). A write
 *    failure therefore never leaves a published note with broken links.
 *  - The evidence bundle stores the verbatim raw source records, selection
 *    coordinates (message ids), provenance, capture time, digests, and
 *    obtainable asset bytes — so evidence survives source deletion.
 *  - Missing/truncated material is listed with reasons and makes the capture
 *    explicitly INCOMPLETE. Nothing is reconstructed or guessed. Completeness
 *    is scoped to the SELECTED material: session-level read warnings
 *    (genuinely unknown record types, a torn trailing line after the
 *    selection) are
 *    recorded in the note and bundle but do not by themselves mark the
 *    capture incomplete — a trailing unfinished record must not invalidate
 *    preceding complete records (spec.md).
 *  - An existing note is never silently overwritten (CaptureConflictError).
 *
 * Pure service: vault writes go through the injectable `CaptureWritePort`
 * (built from the active VaultManager in `fs.tauri.ts`). The port is bound
 * when the user confirms the save, so an async vault switch cannot retarget
 * the write.
 */

import i18n from '@/i18n';
import type {
  ExternalSessionDetail,
  ExternalSessionMessage,
  TextRangeSelection,
} from './types';
import { renderSourceLocator } from './sourceLocator';

/** Evidence bundle format marker (records.json `format` field). */
export const EVIDENCE_FORMAT = 'folyn-session-evidence/1';

export interface CaptureWritePort {
  createDir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  writeFileBytes(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface CaptureMissingItem {
  messageId: string;
  kind: 'image' | 'tool-output';
  reason: string;
}

export interface CaptureResult {
  /** Vault-relative path of the published Markdown note. */
  notePath: string;
  /** Vault-relative path of the evidence bundle directory. */
  evidencePath: string;
  missing: CaptureMissingItem[];
  complete: boolean;
}

export class CaptureConflictError extends Error {
  constructor(public readonly notePath: string) {
    super(`capture target already exists: ${notePath}`);
  }
}

/** Thrown by `verifySelectionFresh` when the source no longer matches the
 * selection snapshot (message changed, vanished, or the source became
 * unreadable). The caller must require reselection — never silently save
 * changed content under the old selection. */
export class StaleSelectionError extends Error {
  constructor(public readonly changedMessageIds: string[]) {
    super(`selection source changed since snapshot: ${changedMessageIds.join(', ')}`);
  }
}

export interface SaveCaptureInput {
  detail: ExternalSessionDetail;
  selectedMessages: ExternalSessionMessage[];
  /** Text-range selections (slice 4). A message listed here contributes ONLY
   * the ranged excerpt — its remaining text, images and tool records stay
   * out. Whole-message selection supersedes a range on the same message. */
  textRanges?: TextRangeSelection[];
  /** AI-organized note body (slice 5) — the user-EDITED generated draft. When
   * present, the published note's body is this draft instead of the verbatim
   * message rendering; the provenance header, completeness/missing section,
   * evidence bundle and assets are written exactly as for a verbatim capture. */
  noteBody?: string;
}

/** Selection resolution shared by the verbatim capture and the AI note
 * generation (slice 5) — both must describe the SAME selection. Whole-message
 * selection supersedes a text range on the same message; ranges are resolved
 * and validated against each message's canonical text. */
export interface ResolvedSelection {
  whole: ExternalSessionMessage[];
  ranged: { message: ExternalSessionMessage; ranges: { start: number; end: number }[] }[];
  /** Flattened resolved ranges, in selection order (evidence coordinates). */
  resolvedRanges: { message: ExternalSessionMessage; start: number; end: number }[];
}

export function resolveSelectionParts(input: SaveCaptureInput): ResolvedSelection {
  const { selectedMessages, textRanges = [] } = input;
  const resolvedRanges = textRanges
    .filter((r) => !selectedMessages.some((m) => m.id === r.messageId))
    .map((r) => resolveRange(r, input.detail));
  // Group by message (v1: one range per message; grouping tolerates more).
  const rangedByMessage = new Map<string, { message: ExternalSessionMessage; ranges: { start: number; end: number }[] }>();
  for (const r of resolvedRanges) {
    const entry = rangedByMessage.get(r.message.id) ?? { message: r.message, ranges: [] };
    entry.ranges.push({ start: r.start, end: r.end });
    rangedByMessage.set(r.message.id, entry);
  }
  return { whole: selectedMessages, ranged: [...rangedByMessage.values()], resolvedRanges };
}

/** Strip path separators / control chars; keep it a single safe filename. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f/\\:]/g, '')
    .replace(/^\.+/, '')
    .trim();
  const bounded = cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
  return bounded === '' ? 'capture' : bounded;
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir.replace(/\/+$/, '')}/${name}` : name;
}

/** A code fence longer than any backtick run inside `content`. */
function fenceFor(content: string): string {
  const runs = content.match(/`{3,}/g) ?? [];
  const longest = runs.reduce((max, r) => Math.max(max, r.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma === -1) return null;
  const meta = dataUrl.slice(5, comma); // "image/png;base64"
  const slash = meta.indexOf('/');
  const semi = meta.indexOf(';');
  const mime = slash === -1 ? '' : meta.slice(slash + 1, semi === -1 ? meta.length : semi);
  if (!meta.includes('base64')) return null;
  try {
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, ext: mime || 'bin' };
  } catch {
    return null;
  }
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  const view = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < view.length; i++) hex += view[i]!.toString(16).padStart(2, '0');
  return hex;
}

interface EvidenceAsset {
  file: string;
  digest: string;
  messageId: string;
}

/** The persisted shape of a bundle's records.json. Exported for the
 * Sessions panel's evidence viewer (slice 6) — it only READS this shape. */
export interface EvidenceRecord {
  format: string;
  capturedAt: string;
  source: {
    tool: string;
    sessionId: string;
    title: string;
    cwd: string | null;
    filePath: string;
    /** Branch provenance (pi, slice 3): which branch was displayed. Null for
     * linear sources / unbranched sessions — never noise in the record. */
    branch: { id: string; label: string } | null;
  };
  selectedMessageIds: string[];
  /** Slice 4: text-range coordinates, half-open [start, end) against the
   * message's canonical text. Absent when no ranges were selected. */
  selectedTextRanges?: { messageId: string; start: number; end: number }[];
  messages: {
    id: string;
    role: string;
    digest: string;
    /** Verbatim source JSONL lines (message + correlated tool records).
     * EMPTY for text-range-only messages: the unselected part of the message
     * stays in the source — only the excerpt + coordinates are retained. */
    rawRecords: string[];
    /** Present only for text-range selections: verbatim excerpt text plus
     * its coordinates, so the original slice can be located/reproduced. */
    ranges?: { start: number; end: number; text: string }[];
  }[];
  assets: EvidenceAsset[];
  missing: CaptureMissingItem[];
  sessionWarnings: string[];
  complete: boolean;
}

/** Resolve + validate a text range against its message's canonical text.
 * Throws on unknown messages and out-of-bounds/empty ranges (input
 * validation at the capture boundary). */
function resolveRange(
  range: TextRangeSelection,
  detail: ExternalSessionDetail,
): { message: ExternalSessionMessage; start: number; end: number } {
  const msg = detail.messages.find((m) => m.id === range.messageId);
  if (!msg) {
    throw new Error(`sessions: text range references unknown message ${range.messageId}`);
  }
  const { start, end } = range;
  if (
    !Number.isInteger(start) || !Number.isInteger(end) ||
    start < 0 || end > msg.content.length || start >= end
  ) {
    throw new Error(
      `sessions: invalid text range [${start}, ${end}) for ${range.messageId} (content length ${msg.content.length})`,
    );
  }
  return { message: msg, start, end };
}

/** Confirm-time freshness check (slice 4): the selection snapshot was taken
 * from an earlier read. Re-read the session and pass the fresh detail here
 * (or null when the source is no longer readable) — any selected/ranged
 * message that vanished or whose source records changed makes the snapshot
 * stale, and the caller must require reselection instead of saving. */
export function verifySelectionFresh(
  input: SaveCaptureInput,
  fresh: ExternalSessionDetail | null,
): void {
  const recordKey = (m: ExternalSessionMessage) =>
    [m.rawRecord, ...m.rawToolRecords].join('\n');
  const changed = new Set<string>();
  for (const msg of input.selectedMessages) {
    const now = fresh?.messages.find((m) => m.id === msg.id);
    if (!now || recordKey(now) !== recordKey(msg)) changed.add(msg.id);
  }
  for (const range of input.textRanges ?? []) {
    const snapshot = input.detail.messages.find((m) => m.id === range.messageId);
    const now = fresh?.messages.find((m) => m.id === range.messageId);
    // A range is only safe while its anchor text is unchanged: identical
    // content keeps the exact coordinates meaningful.
    if (!snapshot || !now || now.content !== snapshot.content) changed.add(range.messageId);
  }
  if (changed.size > 0) throw new StaleSelectionError([...changed]);
}

/**
 * Save a verbatim capture. `dir` is the vault-relative target directory the
 * user chose; `filename` the (unsanitized) note name. Throws
 * `CaptureConflictError` when the note already exists; propagates port write
 * errors (note not published in that case).
 */
export async function saveVerbatimCapture(
  dir: string,
  filename: string,
  input: SaveCaptureInput,
  port: CaptureWritePort,
): Promise<CaptureResult> {
  const { detail, selectedMessages, noteBody } = input;
  const base = sanitizeFilename(filename).replace(/\.md$/i, '');
  const notePath = joinPath(dir, `${base}.md`);
  const evidencePath = joinPath(dir, `${base}.evidence`);

  if (await port.exists(notePath)) {
    throw new CaptureConflictError(notePath);
  }

  const { ranged, resolvedRanges } = resolveSelectionParts(input);

  const capturedAt = new Date().toISOString();

  // ── Missing material (explicit, never silent) ──
  const missing: CaptureMissingItem[] = [];
  for (const msg of selectedMessages) {
    for (const m of msg.missing) {
      missing.push({ messageId: msg.id, kind: m.kind, reason: m.reason });
    }
  }
  const sessionWarnings = detail.warnings;

  // ── Assets: obtainable inline images, byte-identical ──
  const assets: EvidenceAsset[] = [];
  const assetWrites: { path: string; bytes: Uint8Array }[] = [];
  let assetSeq = 0;
  for (const msg of selectedMessages) {
    for (const image of msg.images) {
      const decoded = decodeDataUrl(image.dataUrl);
      if (!decoded) {
        missing.push({ messageId: msg.id, kind: 'image', reason: 'inline image could not be decoded' });
        continue;
      }
      assetSeq += 1;
      const file = `assets/${String(assetSeq).padStart(4, '0')}.${decoded.ext}`;
      const digest = await sha256Hex(decoded.bytes);
      assets.push({ file, digest, messageId: msg.id });
      assetWrites.push({ path: joinPath(evidencePath, file), bytes: decoded.bytes });
    }
  }

  // Selection-scoped: a capture is complete when every piece of SELECTED
  // material was obtained. Session warnings outside the selection (torn
  // trailing line, unknown record types) are recorded, not penalized.
  const complete = missing.length === 0;

  // ── Evidence records (verbatim raw source lines + digests) ──
  const messageRecords: EvidenceRecord['messages'] = [];
  for (const msg of selectedMessages) {
    const rawRecords = [msg.rawRecord, ...msg.rawToolRecords].filter((r) => r !== '');
    messageRecords.push({
      id: msg.id,
      role: msg.role,
      digest: await sha256Hex(rawRecords.join('\n')),
      rawRecords,
    });
  }
  for (const entry of ranged) {
    // Text-range evidence: excerpt + coordinates only. The raw record stays
    // out — it contains the unselected part of the message, and a hash over
    // the excerpt keeps the retained part verifiable.
    const excerpt = entry.ranges.map((r) => ({
      start: r.start,
      end: r.end,
      text: entry.message.content.slice(r.start, r.end),
    }));
    messageRecords.push({
      id: entry.message.id,
      role: entry.message.role,
      digest: await sha256Hex(JSON.stringify(excerpt)),
      rawRecords: [],
      ranges: excerpt,
    });
  }

  // Branch provenance: recorded only when the session actually has branches,
  // so the displayed branch is distinguishable from its siblings in evidence.
  const branchInfo =
    detail.branch.all.length > 1
      ? detail.branch.all.find((b) => b.id === detail.branch.currentId) ?? null
      : null;

  const record: EvidenceRecord = {
    format: EVIDENCE_FORMAT,
    capturedAt,
    source: {
      tool: detail.summary.source,
      sessionId: detail.summary.sessionId,
      title: detail.summary.title,
      cwd: detail.summary.cwd,
      filePath: detail.summary.filePath,
      branch: branchInfo == null ? null : { id: branchInfo.id, label: branchInfo.label },
    },
    selectedMessageIds: selectedMessages.map((m) => m.id),
    selectedTextRanges:
      resolvedRanges.length === 0
        ? undefined
        : resolvedRanges.map((r) => ({ messageId: r.message.id, start: r.start, end: r.end })),
    messages: messageRecords,
    assets,
    missing,
    sessionWarnings,
    complete,
  };

  // ── Write evidence FIRST; the note last (publish-after-evidence) ──
  await port.createDir(joinPath(evidencePath, 'assets'));
  for (const w of assetWrites) {
    await port.writeFileBytes(w.path, w.bytes);
  }
  await port.writeFile(joinPath(evidencePath, 'records.json'), JSON.stringify(record, null, 2));

  const note = renderNoteMarkdown(base, detail, selectedMessages, ranged, {
    capturedAt,
    missing,
    sessionWarnings,
    complete,
    assets,
    branch: branchInfo,
    evidencePath,
    noteBody,
  });
  await port.writeFile(notePath, note);

  return { notePath, evidencePath, missing, complete };
}

function t(key: string, vars?: Record<string, string | number>): string {
  return i18n.t(`sessions:${key}`, vars);
}

function isoTime(ts: number | null): string {
  return ts == null ? '—' : new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function renderNoteMarkdown(
  base: string,
  detail: ExternalSessionDetail,
  selectedMessages: ExternalSessionMessage[],
  ranged: { message: ExternalSessionMessage; ranges: { start: number; end: number }[] }[],
  ctx: {
    capturedAt: string;
    missing: CaptureMissingItem[];
    sessionWarnings: string[];
    complete: boolean;
    assets: EvidenceAsset[];
    branch: { id: string; label: string } | null;
    /** Vault-relative evidence bundle path (locator `evidence:` field). */
    evidencePath: string;
    /** AI-organized note body (slice 5) — replaces the verbatim message body. */
    noteBody?: string;
  },
): string {
  const s = detail.summary;
  const out: string[] = [];
  const evidenceLink = `./${base}.evidence/records.json`;

  // An AI note carries its own title from the (edited) draft; a verbatim
  // capture reuses the session title.
  if (ctx.noteBody == null) {
    out.push(`# ${s.title || s.sessionId}`);
    out.push('');
  }
  out.push(
    `> ${t('note.provenance.source')}: ${s.source} · ${t('note.provenance.sessionId')}: ${s.sessionId}`,
  );
  out.push(`> ${t('note.provenance.project')}: ${s.cwd ?? t('note.unknown')}`);
  if (ctx.branch) {
    out.push(`> ${t('note.provenance.branch')}: ${ctx.branch.label || ctx.branch.id}`);
  }
  out.push(`> ${t('note.provenance.captureTime')}: ${isoTime(Date.parse(ctx.capturedAt))}`);
  out.push(`> ${t('note.provenance.evidence')}: [${base}.evidence](${evidenceLink})`);
  out.push(
    ctx.complete
      ? `> ${t('note.completeness.complete')}`
      : `> ${t('note.completeness.incomplete', { count: ctx.missing.length })}`,
  );
  out.push('');

  if (ctx.noteBody != null) {
    // AI-organized note (slice 5): the user-edited draft IS the body. The
    // provenance header above and the missing/locator sections below still
    // frame it, so provenance, completeness and evidence links stay readable.
    out.push(ctx.noteBody.trim());
    out.push('');
  } else {
  // assetSeq mirrors the bundle write order (messages × images, 1-based)
  let assetSeq = 0;
  selectedMessages.forEach((msg, idx) => {
    const role = t(msg.role === 'user' ? 'note.role.user' : 'note.role.assistant');
    out.push(`## ${idx + 1}. ${role} · ${isoTime(msg.timestamp)}`);
    out.push('');
    if (msg.content !== '') {
      const fence = fenceFor(msg.content);
      out.push(fence);
      out.push(msg.content);
      out.push(fence);
      out.push('');
    }
    for (let k = 0; k < msg.images.length; k++) {
      assetSeq += 1;
      const asset = ctx.assets[assetSeq - 1];
      if (asset) {
        out.push(`![${t('note.imageAlt')}](./${base}.evidence/${asset.file})`);
      }
    }
    if (msg.images.length > 0) out.push('');
    for (const call of msg.toolCalls) {
      out.push(`### ${t('note.toolCall')} \`${call.name}\``);
      out.push('');
      out.push(`**${t('note.toolInput')}**`);
      out.push('');
      const inFence = fenceFor(call.input);
      out.push(inFence);
      out.push(call.input);
      out.push(inFence);
      out.push('');
      out.push(`**${t('note.toolOutput')}**`);
      out.push('');
      if (call.output == null) {
        out.push(`_${t('note.toolOutputMissing')}_`);
      } else {
        const outFence = fenceFor(call.output);
        out.push(outFence);
        out.push(call.output);
        out.push(outFence);
      }
      out.push('');
    }
  });

  // ── Text-range excerpts: ONLY the selected text — the rest of the
  //    message, its images and tool records are deliberately absent. ──
  ranged.forEach((entry, idx) => {
    const role = t(entry.message.role === 'user' ? 'note.role.user' : 'note.role.assistant');
    out.push(`## ${selectedMessages.length + idx + 1}. ${role} · ${isoTime(entry.message.timestamp)}`);
    out.push('');
    out.push(`*${t('note.excerpt')}: ${entry.ranges.map((r) => `[${r.start}, ${r.end})`).join(', ')}*`);
    out.push('');
    const excerptText = entry.ranges
      .map((r) => entry.message.content.slice(r.start, r.end))
      .join('\n…\n');
    const fence = fenceFor(excerptText);
    out.push(fence);
    out.push(excerptText);
    out.push(fence);
    out.push('');
  });
  }

  if (ctx.missing.length > 0 || ctx.sessionWarnings.length > 0) {
    out.push(`## ${t('note.missing.title')}`);
    out.push('');
    for (const m of ctx.missing) {
      out.push(
        `- ${t('note.missing.item', {
          id: m.messageId,
          kind: t(`note.missing.kind.${m.kind}`),
          reason: m.reason,
        })}`,
      );
    }
    for (const w of ctx.sessionWarnings) {
      out.push(`- ${w}`);
    }
    out.push('');
  }

  out.push('---');
  out.push('');
  // Machine-parsable source locator (slice 6): the Sessions panel's
  // "open by locator" reads this block (one click copies it from the
  // preview's code block) to jump back to the live session + recorded
  // branch — or to this evidence bundle when the source no longer exists.
  // Format documented in sourceLocator.ts.
  out.push('```folyn-session');
  out.push(renderSourceLocator({
    source: s.source,
    sessionId: s.sessionId,
    filePath: s.filePath,
    branchId: ctx.branch?.id ?? null,
    messageIds: selectedMessages.map((m) => m.id),
    ranges: ranged.flatMap((e) =>
      e.ranges.map((r) => ({ messageId: e.message.id, start: r.start, end: r.end })),
    ),
    evidencePath: ctx.evidencePath,
  }));
  out.push('```');
  out.push('');

  return out.join('\n');
}
