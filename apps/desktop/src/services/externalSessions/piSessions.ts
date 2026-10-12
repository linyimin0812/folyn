/**
 * pi coding-agent session reader — read-only adapter (slice 3).
 *
 * Mechanism (verified on this machine, pi session format version 3, 138 local
 * session files): plain read-only parsing of
 * `~/.pi/agent/sessions/<encoded-cwd>/<ISO-timestamp>_<uuid>.jsonl`. pi's own
 * `SessionManager.open` is NOT used — its load path runs legacy format
 * migrations and may write. Unsupported format versions are an explicit
 * unsupported state; no migration is attempted (project rule: no compat
 * layers).
 *
 * Format observed locally (machine-verified):
 *  - First line = `session` header: `{type:'session', version:3, id:UUID,
 *    timestamp:ISO, cwd}` (optional `parentSession` per upstream; not observed
 *    locally). Project identity comes from this header cwd — the directory
 *    slug is not reversible.
 *  - Every other record: `{type, id, parentId, timestamp, …}` — entries form a
 *    TREE via id/parentId (the parent always precedes the child in file
 *    order). Entry kinds observed: `message`, `compaction`, `custom`
 *    (customType e.g. 'web-search-results'), `model_change`,
 *    `thinking_level_change`.
 *  - `message` records carry `message: {role, content: Part[], …}` with roles
 *    `user` / `assistant` / `toolResult`:
 *      - user parts: `text` (upstream also allows `image`).
 *      - assistant parts: `text`, `thinking` (display-hidden), `toolCall`
 *        `{id, name, arguments: object}`.
 *      - `toolResult` role: `message.toolCallId` correlates to the toolCall
 *        part id (verified: 260/260 matched locally); content parts are
 *        `text` (upstream also allows images/details/nestedCalls —
 *        nestedCalls record no outputs, surfaced as explicit missing).
 *  - No forks were observed locally, but the id/parentId tree supports them;
 *    this adapter enumerates branches and projects one at a time.
 *
 * Branch model: the default (mainline) branch follows the LAST child at every
 * fork — since a session file is append-only and active work appends to the
 * end, the chain of the last record is the currently active conversation.
 * Every leaf of the tree is a selectable branch (identity = its tip record
 * id, stable across re-reads). Branch switching re-reads the source with an
 * explicit branch id; an id that vanished throws instead of silently
 * retargeting. compaction/context-edit/branch-summary-style entries are
 * model-context bookkeeping, not conversation: excluded from the projection
 * without a warning (known bookkeeping), never used as a replacement for
 * history.
 *
 * Pure module: filesystem access goes through the injectable `ClaudeSessionFs`
 * port (the superset port — Tauri adapter in `fs.tauri.ts`, in-memory shims
 * in tests). Reads never resume, migrate or mutate source sessions.
 */

import type { ClaudeSessionFs } from './claudeSessions';
import { errorToMessage } from './errorToMessage';
import type {
  ExternalSessionBranch,
  ExternalSessionDetail,
  ExternalSessionMessage,
  ExternalSessionSummary,
  ExternalToolCall,
  MissingMaterial,
} from './types';

export type PiSessionFs = ClaudeSessionFs;

export interface PiDiscovery {
  sessions: ExternalSessionSummary[];
  /** Per-file read/parse problems — reported per source, never fatal. */
  errors: string[];
}

const SUPPORTED_VERSION = 3;

// ponytail: head-read bound for discovery titles — the first typed prompt
// lands within the first ~40 lines of every local file observed.
const HEAD_LINES = 40;

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** `2026-09-02T12-54-36-633Z_<uuid>.jsonl` → `2026-09-02 12:54`. */
function titleFromFilename(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  return '';
}

/** `<ISO>_<uuid>.jsonl` → the uuid (after the first underscore). */
function sessionIdFromFilename(filePath: string): string {
  const base = (filePath.split('/').pop() ?? '').replace(/\.jsonl$/, '');
  const underscore = base.indexOf('_');
  return underscore === -1 ? base : base.slice(underscore + 1);
}

interface PiEntry {
  type?: string;
  version?: unknown;
  id?: unknown;
  parentId?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  parentSession?: unknown;
  message?: PiMessage;
}

interface PiMessage {
  role?: string;
  content?: unknown;
  toolCallId?: unknown;
  isError?: unknown;
}

interface PiPart {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  image?: unknown;
  mimeType?: unknown;
  nestedCalls?: unknown;
}

/** First session header (line 1 in every observed file). */
function readPiHeaderLines(lines: string[]): { entry: PiEntry | null; torn: boolean } {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      return { entry: JSON.parse(trimmed) as PiEntry, torn: false };
    } catch {
      return { entry: null, torn: true };
    }
  }
  return { entry: null, torn: false };
}

function assertSupportedVersion(entry: PiEntry, filePath: string): void {
  if (entry.type !== 'session') {
    throw new Error(`${filePath}: first record is not a pi session header`);
  }
  if (entry.version !== SUPPORTED_VERSION) {
    // No migration, no fallback parse — explicit unsupported state.
    throw new Error(
      `${filePath}: unsupported pi session format version ${String(entry.version)} (supported: ${SUPPORTED_VERSION})`,
    );
  }
}

/** First user text within the head lines, single-lined, for the list title. */
function headTitle(lines: string[]): string {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let entry: PiEntry;
    try {
      entry = JSON.parse(trimmed) as PiEntry;
    } catch {
      continue; // torn line inside the head — later records still speak
    }
    if (entry.type !== 'message' || entry.message?.role !== 'user') continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .map((p) => (typeof (p as PiPart).text === 'string' ? (p as PiPart).text! : ''))
      .join('')
      .trim();
    if (text !== '') {
      const oneLine = text.replace(/\s+/g, ' ');
      return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
    }
  }
  return '';
}

// ── Discovery ──────────────────────────────────────────────────────────────────

/** Discover every readable pi session under `root` (default `~/.pi/agent/sessions`). */
export async function discoverPiSessions(root: string, fs: PiSessionFs): Promise<PiDiscovery> {
  const errors: string[] = [];
  const sessions: ExternalSessionSummary[] = [];
  const seen = new Set<string>();

  if (!(await fs.exists(root))) return { sessions, errors }; // missing root = empty source
  let files: string[] = [];
  try {
    files = await fs.listJsonlFiles(root); // recursive: covers every project dir
  } catch (err) {
    return { sessions, errors: [`${root}: ${errorToMessage(err)}`] };
  }

  for (const filePath of files.sort()) {
    try {
      let lines: string[];
      try {
        lines = await fs.readLines(filePath, HEAD_LINES);
      } catch (err) {
        throw new Error(errorToMessage(err));
      }
      const { entry, torn } = readPiHeaderLines(lines);
      if (entry === null) {
        throw new Error(torn ? 'unreadable/torn session header' : 'empty file');
      }
      assertSupportedVersion(entry, filePath);
      const sessionId = typeof entry.id === 'string' && entry.id !== '' ? entry.id : sessionIdFromFilename(filePath);
      // Same session id in two project dirs = duplicate physical copy — first
      // sorted path wins, deterministic, never merged.
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);
      sessions.push({
        source: 'pi',
        sessionId,
        filePath,
        title: headTitle(lines) || titleFromFilename(filePath),
        cwd: typeof entry.cwd === 'string' ? entry.cwd : null, // header cwd, never the slug
        startedAt: parseTimestamp(entry.timestamp),
        updatedAt: await fs.mtime(filePath),
        parentSessionId: typeof entry.parentSession === 'string' ? entry.parentSession : null,
      });
    } catch (err) {
      errors.push(errorToMessage(err));
    }
  }

  sessions.sort((a, b) => (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0));
  return { sessions, errors };
}

// ── Session parsing (tree + branch projection) ─────────────────────────────────

interface TreeNode {
  id: string;
  parentId: string | null;
  /** Line index in the split text (for message ids and warnings). */
  index: number;
  line: string;
  entry: PiEntry;
}

/** First displayed user message, single-lined, for titles/branch labels. */
function firstUserText(messages: ExternalSessionMessage[], maxLen: number): string {
  const first = messages.find((m) => m.role === 'user' && m.content.trim() !== '');
  const oneLine = (first?.content ?? '').trim().replace(/\s+/g, ' ');
  if (oneLine === '') return '';
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen)}…` : oneLine;
}

function imageFromPart(part: PiPart): { dataUrl: string } | { missing: MissingMaterial } {
  if (typeof part.image === 'string' && part.image !== '') {
    const mime = typeof part.mimeType === 'string' ? part.mimeType : 'image/png';
    return { dataUrl: `data:${mime};base64,${part.image}` };
  }
  return {
    missing: {
      kind: 'image',
      reason: 'image part without inline base64 data — bytes not obtainable',
    },
  };
}

/**
 * Parse a pi session file into a branch projection. `branchId` selects the
 * branch (a branch-tip record id); when omitted the mainline (last-child
 * chain from the root) is projected. Throws for unsupported format versions
 * and for a branch id that no longer exists — never silently retargets.
 */
export function parsePiSession(
  text: string,
  branchId?: string,
): {
  header: PiEntry | null;
  messages: ExternalSessionMessage[];
  warnings: string[];
  branch: { currentId: string; all: ExternalSessionBranch[] };
} {
  const warnings: string[] = [];
  const lines = text.split('\n');
  const nodes: TreeNode[] = [];
  let header: PiEntry | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    let entry: PiEntry;
    try {
      entry = JSON.parse(line) as PiEntry;
    } catch {
      // Only a TORN trailing line can fail to parse here. Earlier records
      // are unaffected.
      warnings.push(`line ${i + 1}: incomplete/unparsable record (skipped)`);
      continue;
    }
    if (header === null && entry.type === 'session') {
      header = entry;
      assertSupportedVersion(entry, 'session');
      // The header is metadata, NOT a tree node: in real files no entry
      // parents to the header id — the conversation tree roots at the first
      // post-header entry (verified: 138/138 local files).
      continue;
    }
    if (typeof entry.id === 'string' && entry.id !== '') {
      nodes.push({
        id: entry.id,
        parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
        index: i,
        line: lines[i]!,
        entry,
      });
    }
    // entries without an id are not tree nodes and not conversation.
  }

  if (header === null) throw new Error('pi session has no session header record');

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, TreeNode[]>();
  for (const n of nodes) {
    if (n.parentId != null && byId.has(n.parentId)) {
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    }
  }
  const roots = nodes.filter((n) => n.parentId == null || !byId.has(n.parentId));
  if (roots.length > 1) {
    warnings.push(`${roots.length - 1} records detached from the session tree (using the first root)`);
  }
  const root = roots[0];

  // Mainline: follow the LAST child at each fork. Parents precede children in
  // the append-only file, so the last child chain is the currently active
  // conversation. ponytail: pi exposes no in-file "current branch" pointer —
  // this is the deterministic latest-activity projection; revisit if a future
  // format version adds an explicit pointer.
  const mainline: TreeNode[] = [];
  if (root != null) {
    let node: TreeNode | undefined = root;
    while (node != null) {
      mainline.push(node);
      const kids = children.get(node.id);
      node = kids == null ? undefined : kids[kids.length - 1];
    }
  }
  const mainlineIds = new Set(mainline.map((n) => n.id));

  // Branches: every tree leaf is a selectable root-to-leaf path. Mainline
  // first, then other leaves in file order. Identity = the tip record id.
  const leaves = nodes.filter((n) => !children.has(n.id) || children.get(n.id)!.length === 0);
  const mainlineTip = mainline[mainline.length - 1];
  const otherLeaves = leaves
    .filter((n) => !mainlineIds.has(n.id))
    .sort((a, b) => a.index - b.index);
  const branchTips = [...(mainlineTip ? [mainlineTip] : []), ...otherLeaves];

  const currentTip = branchId == null ? mainlineTip : branchTips.find((n) => n.id === branchId);
  if (branchId != null && (currentTip == null || mainlineTip == null)) {
    throw new Error(`pi branch no longer exists in this session: ${branchId}`);
  }

  // Path root → tip for the selected branch, in conversation order.
  const path: TreeNode[] = [];
  if (currentTip != null) {
    let node: TreeNode | undefined = currentTip;
    while (node != null) {
      path.unshift(node);
      node = node.parentId != null ? byId.get(node.parentId) : undefined;
    }
  }

  const messages = projectBranch(path, warnings);
  const chainTo = (tip: TreeNode): TreeNode[] => {
    const branchPath: TreeNode[] = [];
    let node: TreeNode | undefined = tip;
    while (node != null) {
      branchPath.unshift(node);
      node = node.parentId != null ? byId.get(node.parentId) : undefined;
    }
    return branchPath;
  };
  // Branch label: the first user message UNIQUE to the branch (after its
  // fork point) — the shared prefix would give every branch the same label.
  // The mainline falls back to the session's first user text.
  const all: ExternalSessionBranch[] = branchTips.map((tip, i) => {
    if (mainlineIds.has(tip.id)) {
      return { id: tip.id, label: firstUserText(messages, 24) };
    }
    const unique = chainTo(tip).filter((n) => !mainlineIds.has(n.id));
    const label = firstUserText(projectBranch(unique, []), 24);
    return { id: tip.id, label: label || `branch ${i + 1}` };
  });

  return { header, messages, warnings, branch: { currentId: currentTip?.id ?? '', all } };
}

// Known-and-expected non-conversation entry kinds — bookkeeping, not
// conversation: excluded from the projection AND from warnings (they appear in
// normal sessions; warning on them is noise). `compaction`/`context_edit`/
// `branch_summary` are model-context summaries — the original history stays in
// the source file and is never replaced by them. Only genuinely unknown entry
// kinds warn (real format-drift signal).
const KNOWN_BOOKKEEPING_TYPES = new Set([
  'compaction', 'context_edit', 'branch_summary',
  'model_change', 'thinking_level_change', 'custom',
]);

/** Project one root→tip path into display messages + evidence. */
function projectBranch(path: TreeNode[], warnings: string[]): ExternalSessionMessage[] {
  const messages: ExternalSessionMessage[] = [];
  const openCalls = new Map<string, { call: ExternalToolCall; owner: ExternalSessionMessage }>();
  const skippedTypes = new Map<string, number>();

  for (const node of path) {
    if (node.entry.type !== 'message') {
      // compaction / model_change / custom … — known bookkeeping, skipped
      // silently (see KNOWN_BOOKKEEPING_TYPES); unknown kinds warn.
      if (!KNOWN_BOOKKEEPING_TYPES.has(node.entry.type ?? '')) {
        const key = node.entry.type ?? '(empty)';
        skippedTypes.set(key, (skippedTypes.get(key) ?? 0) + 1);
      }
      continue;
    }
    const msg = node.entry.message;
    const role = msg?.role;
    const ts = parseTimestamp(node.entry.timestamp);
    const parts = Array.isArray(msg?.content) ? (msg!.content as PiPart[]) : [];

    if (role === 'toolResult') {
      const output = parts
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('');
      const open = typeof msg?.toolCallId === 'string' ? openCalls.get(msg!.toolCallId!) : undefined;
      if (open) {
        // A found result record sets output even when its text is empty; null
        // is reserved for calls with no result record.
        open.call.output = output;
        open.owner.rawToolRecords.push(node.line);
        let nestedMissing = false;
        for (const part of parts) {
          const partType = typeof part.type === 'string' ? part.type : '';
          if (partType === 'image') {
            const img = imageFromPart(part);
            if ('dataUrl' in img) open.owner.images.push({ dataUrl: img.dataUrl });
            else open.owner.missing.push(img.missing);
          } else if (partType !== 'text' && part.nestedCalls != null) {
            nestedMissing = true; // nested calls record no outputs upstream
          }
        }
        if (nestedMissing) {
          open.owner.missing.push({
            kind: 'tool-output',
            reason: 'nested tool calls in this result do not record their outputs in the source',
          });
        }
      } else {
        warnings.push(`line ${node.index + 1}: tool result without a matching call (skipped)`);
      }
      continue;
    }

    if (role !== 'user' && role !== 'assistant') {
      skippedTypes.set(`message:${role ?? '(empty)'}`, (skippedTypes.get(`message:${role ?? '(empty)'}`) ?? 0) + 1);
      continue;
    }

    let content = '';
    const images: ExternalSessionMessage['images'] = [];
    const missing: MissingMaterial[] = [];
    const toolCalls: ExternalToolCall[] = [];
    for (const part of parts) {
      const partType = typeof part.type === 'string' ? part.type : '';
      if (partType === 'text') {
        content += typeof part.text === 'string' ? part.text : '';
      } else if (partType === 'image') {
        const img = imageFromPart(part);
        if ('dataUrl' in img) images.push({ dataUrl: img.dataUrl });
        else missing.push(img.missing);
      } else if (partType === 'toolCall' && role === 'assistant') {
        const callId = typeof part.id === 'string' && part.id !== '' ? part.id : `unknown-${node.index}`;
        const input = typeof part.arguments === 'string' ? part.arguments : part.arguments != null ? JSON.stringify(part.arguments) : '';
        toolCalls.push({ callId, name: typeof part.name === 'string' ? part.name : 'tool', input, output: null });
      }
      // 'thinking' — display-hidden known category (raw line retained via the
      // message's rawRecord when the entry also has text/toolCalls).
    }
    if (content !== '' || images.length > 0 || toolCalls.length > 0) {
      const message: ExternalSessionMessage = {
        id: `msg-${node.index}`,
        role,
        content,
        timestamp: ts,
        images,
        missing,
        toolCalls,
        rawRecord: node.line,
        rawToolRecords: [],
      };
      messages.push(message);
      for (const call of toolCalls) {
        openCalls.set(call.callId, { call, owner: message });
      }
    }
  }

  // Calls whose result never arrived on this branch are missing tool output.
  for (const { call, owner } of openCalls.values()) {
    if (call.output === null) {
      owner.missing.push({
        kind: 'tool-output',
        reason: `no result record for tool call ${call.name} (${call.callId})`,
      });
    }
  }

  if (skippedTypes.size > 0) {
    const parts = [...skippedTypes.entries()].map(([t, n]) => `${t}×${n}`);
    warnings.push(`records on this branch not displayed: ${parts.join(', ')}`);
  }

  return messages;
}

/**
 * Read one session's detail, projected onto `branchId` (mainline when
 * omitted). `summary` comes from discovery; the title is refined to the
 * branch's first user message when discovery fell back to the filename.
 */
export async function readPiSession(
  summary: ExternalSessionSummary,
  fs: PiSessionFs,
  branchId?: string,
): Promise<ExternalSessionDetail> {
  const text = await fs.readTextFile(summary.filePath);
  const { header, messages, warnings, branch } = parsePiSession(text, branchId);
  const refinedTitle = summary.title || firstUserText(messages, 48) || summary.sessionId.slice(0, 8);
  return {
    summary: {
      ...summary,
      title: refinedTitle,
      cwd: typeof header?.cwd === 'string' ? header.cwd : summary.cwd,
      startedAt: summary.startedAt ?? parseTimestamp(header?.timestamp),
      parentSessionId:
        typeof header?.parentSession === 'string' ? header.parentSession : summary.parentSessionId,
    },
    messages,
    warnings,
    branch,
  };
}
