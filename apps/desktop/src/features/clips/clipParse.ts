// Shared clip-markdown parsing utilities for the clips feature.
//
// Used by both `clipService` (data layer) and `ClipCardView` (render layer,
// rewired in PR2) so neither depends on the other for parsing. Pure
// functions, no React / store deps — safe to import from services.
//
// Clip markdown structure (new section order, poster-first):
//   ---
//   title: "..."
//   type: clip
//   url: "..."
//   tags: [...]
//   clipped: YYYY-MM-DD
//   ---
//
//   > **来源**: [<hostname>](<url>)
//
//   ## 信息图        ← optional, on-demand; written at TOP position
//   ```json
//   { "version": 1, "blocks": [...] }
//   ```
//   ## 摘要
//   ...
//   ## 要点
//   - ...
//   ## 正文          ← optional; full page markdown from curl.md
//   ...
//
// `parseClipContent` is order-agnostic: it finds each section by heading
// regardless of position, so old clips with `## 信息图` at the bottom still
// parse correctly.

/** A single infographic block. Discriminated union on `type`. */
export type InfographicBlock =
  | { type: 'hero'; title: string; subtitle?: string }
  | { type: 'stat'; items: { value: string; label: string; unit?: string }[] }
  | { type: 'keypoints'; items: string[] }
  | { type: 'timeline'; items: { time: string; title: string; detail?: string }[] }
  | { type: 'steps'; steps: { title: string; detail?: string }[] }
  | { type: 'comparison'; columns: { title: string; items: string[] }[] }
  | { type: 'quote'; text: string; source?: string }
  | { type: 'tags'; tags: string[] }
  | { type: 'source'; url: string; hostname?: string; clipped?: string };

/** Top-level infographic document persisted under the `## 信息图` section. */
export interface InfographicDoc {
  version: number;
  blocks: InfographicBlock[];
}

/** Parsed clip content (frontmatter + body sections). */
export interface ClipData {
  title: string;
  url: string;
  tags: string[];
  clipped: string;
  summary: string;
  keyPoints: string[];
  hostname: string;
  /** Full page markdown stored under `## 正文`; empty string when absent. */
  pageContent: string;
  /** Parsed `## 信息图` section; null when absent or invalid. */
  infographic: InfographicDoc | null;
}

/**
 * Extract a section body by heading, order-agnostic. Finds the first
 * `## <heading>` occurrence and returns the text between it and the next
 * `## ` heading (or EOF). Returns empty string when the heading is absent.
 *
 * Shared by `parseClipContent` so `## 摘要` / `## 要点` / `## 正文` /
 * `## 信息图` all parse the same way regardless of where they appear in
 * the document — old clips with `## 信息图` at the end still parse.
 */
function extractSection(content: string, heading: string): string {
  const re = new RegExp(`${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = content.match(re);
  return m ? m[1].trim() : '';
}

/**
 * Parse clip markdown into structured data. Tolerant: missing frontmatter or
 * sections yield safe defaults rather than throwing. Mirrors the parsing the
 * render layer (ClipCardView) historically did inline, now shared.
 *
 * Order-agnostic: sections are located by heading, not by position, so any
 * clip — new (## 信息图 at top) or legacy (## 信息图 at bottom) — parses
 * the same way.
 */
export function parseClipContent(content: string): ClipData {
  const fm: Record<string, string> = {};
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const body = fmMatch ? content.slice(fmMatch[0].length) : content;

  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      fm[key] = value;
    }
  }

  let tags: string[] = [];
  const rawTags = fm['tags'] || '';
  if (rawTags.startsWith('[') && rawTags.endsWith(']')) {
    const inner = rawTags.slice(1, -1).trim();
    if (inner) {
      tags = inner
        .split(',')
        .map((t) => t.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
  }

  const summary = extractSection(body, '## 摘要');

  // Extract key points.
  const pointsBody = extractSection(body, '## 要点');
  const keyPoints: string[] = pointsBody
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);

  // Extract full page content stored under ## 正文 (may be absent on older clips).
  const pageContent = extractSection(body, '## 正文');

  const url = fm['url'] || '';
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    // invalid / missing url — leave hostname empty
  }

  return {
    title: fm['title'] || 'Untitled',
    url,
    tags,
    clipped: fm['clipped'] || '',
    summary,
    keyPoints,
    hostname,
    pageContent,
    infographic: parseInfographic(body),
  };
}

/**
 * Parse the `## 信息图` fenced JSON block from clip markdown body.
 *
 * Returns `InfographicDoc | null` — null when the section is missing or the
 * fenced JSON is invalid. Never throws: callers can render a fallback on null.
 *
 * Accepts the full document content (it searches within) or just the body
 * after frontmatter. Order-agnostic: finds `## 信息图` wherever it appears.
 */
export function parseInfographic(content: string): InfographicDoc | null {
  // Match the `## 信息图` section up to the next `## ` heading or EOF.
  const sectionMatch = content.match(/## 信息图\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!sectionMatch) return null;
  const sectionBody = sectionMatch[1];

  // Extract the first fenced ```json (or unsuffixed) code block.
  const fenceMatch = sectionBody.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (!fenceMatch) return null;

  try {
    const parsed = JSON.parse(fenceMatch[1]);
    return normalizeInfographicDoc(parsed);
  } catch {
    return null;
  }
}

/**
 * Defensive shape-normalization of an LLM-emitted infographic object.
 * Returns null if the shape is fundamentally wrong. Drops unknown fields
 * silently; the renderer handles unknown block types via fallback.
 *
 * Exported so `clipService.generateClip` (chained infographic-mode call)
 * reuses the same validation instead of duplicating the logic.
 */
export function normalizeInfographicDoc(raw: unknown): InfographicDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const version = typeof obj['version'] === 'number' ? obj['version'] : 1;
  const blocksRaw = obj['blocks'];
  if (!Array.isArray(blocksRaw)) return null;
  // Keep blocks as-is (the discriminated union is enforced at the renderer
  // edge via fallback for unknown types); we only validate the top-level shape
  // here so a partially-malformed block doesn't nuke the whole doc.
  const blocks = blocksRaw.filter(
    (b): b is Record<string, unknown> => !!b && typeof b === 'object' && 'type' in b,
  ) as unknown as InfographicBlock[];
  return { version, blocks };
}

/**
 * Serialize an `InfographicDoc` into the `## 信息图` fenced-JSON section text
 * (just the section, not the surrounding clip body).
 */
export function serializeInfographicSection(doc: InfographicDoc): string {
  const json = JSON.stringify(doc, null, 2);
  return `## 信息图\n\n\`\`\`json\n${json}\n\`\`\``;
}

/**
 * Write (or replace) the `## 信息图` section in a clip markdown document,
 * preserving every other section byte-for-byte. Used by clipService for both
 * first-generation and regenerate (overwrite) flows.
 *
 * **Top-position rule**: the `## 信息图` section is always written at the
 * TOP position — right after the `> **来源**` quote line, before
 * `## 摘要`. For existing clips where `## 信息图` was previously at the
 * bottom (after `## 正文`), regenerate moves it to the top: the old
 * section is removed, then the new section is inserted at the top.
 *
 * Insertion point selection (in priority order):
 *   1. Before `## 摘要` if present
 *   2. Before `## 要点` if present
 *   3. Before `## 正文` if present
 *   4. After the `> **来源**` quote line if present
 *   5. Appended at end of document
 */
export function writeInfographicSection(content: string, doc: InfographicDoc): string {
  const section = serializeInfographicSection(doc);

  // 1. Remove any existing `## 信息图` section (wherever it is).
  let cleaned = content;
  const existing = content.match(/## 信息图\s*\n[\s\S]*?(?=\n## |$)/);
  if (existing && existing.index !== undefined) {
    const before = content.slice(0, existing.index);
    const after = content.slice(existing.index + existing[0].length);
    // Collapse the surrounding blank lines so we don't leave a double-gap.
    cleaned = `${before.replace(/[ \t]*\n+$/, '')}\n\n${after.replace(/^\s+/, '')}`.trim() + '\n';
  }

  // 2. Find the insertion index — before the first of (## 摘要 / ## 要点 /
  //    ## 正文) that appears in the cleaned doc. Each is searched by literal
  //    heading text so we get the earliest position regardless of order.
  const targets = ['## 摘要', '## 要点', '## 正文'];
  let insertAt: number | null = null;
  for (const heading of targets) {
    const idx = cleaned.indexOf(heading);
    if (idx !== -1 && (insertAt === null || idx < insertAt)) {
      insertAt = idx;
    }
  }

  if (insertAt !== null) {
    const before = cleaned.slice(0, insertAt).replace(/[ \t]*\n+$/, '');
    const after = cleaned.slice(insertAt).replace(/^\s+/, '');
    return `${before}\n\n${section}\n\n${after}`.replace(/\n{3,}/g, '\n\n') + '\n';
  }

  // 3. No `## 摘要` / `## 要点` / `## 正文` — insert after the `> **来源**`
  //    quote line if present.
  const quoteMatch = cleaned.match(/^> \*\*来源\*\*[^\n]*\n?/m);
  if (quoteMatch && quoteMatch.index !== undefined) {
    const splitAt = quoteMatch.index + quoteMatch[0].length;
    const before = cleaned.slice(0, splitAt).replace(/[ \t]*\n+$/, '');
    const after = cleaned.slice(splitAt).replace(/^\s+/, '');
    return `${before}\n\n${section}\n\n${after}`.replace(/\n{3,}/g, '\n\n') + '\n';
  }

  // 4. Nothing else — append at end.
  const trimmed = cleaned.replace(/\s+$/, '');
  return `${trimmed}\n\n${section}\n`;
}
