// Shared clip-markdown parsing utilities for the clips feature.
//
// Used by both `clipService` (data layer) and `ClipCardView` (render layer,
// rewired in PR2) so neither depends on the other for parsing. Pure
// functions, no React / store deps — safe to import from services.
//
// Clip markdown structure:
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
//   ## 摘要
//   ...
//   ## 要点
//   - ...
//   ## 信息图
//   ```json
//   { "version": 1, "blocks": [...] }
//   ```

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
  /** Parsed `## 信息图` section; null when absent or invalid. */
  infographic: InfographicDoc | null;
}

/**
 * Parse clip markdown into structured data. Tolerant: missing frontmatter or
 * sections yield safe defaults rather than throwing. Mirrors the parsing the
 * render layer (ClipCardView) historically did inline, now shared.
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

  // Extract summary (up to the next ## section or EOF).
  let summary = '';
  const summaryMatch = body.match(/## 摘要\s*\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (summaryMatch) summary = summaryMatch[1].trim();

  // Extract key points.
  let keyPoints: string[] = [];
  const pointsMatch = body.match(/## 要点\s*\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (pointsMatch) {
    keyPoints = pointsMatch[1]
      .split('\n')
      .map((l) => l.replace(/^-\s*/, '').trim())
      .filter(Boolean);
  }

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
 * after frontmatter.
 */
export function parseInfographic(content: string): InfographicDoc | null {
  // Match the `## 信息图` section up to the next `## ` heading or EOF.
  const sectionMatch = content.match(/## 信息图\s*\n([\s\S]*?)(?=\n## [^\n]|\n$|$)/);
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
 * Exported so `clipService.generateInfographic` reuses the same validation
 * instead of duplicating the logic.
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
 * - If a `## 信息图` section already exists, it is replaced in-place.
 * - If not, the new section is appended at the end of the document.
 */
export function writeInfographicSection(content: string, doc: InfographicDoc): string {
  const section = serializeInfographicSection(doc);
  // Matches `## 信息图` heading through to the next `## ` heading or EOF.
  const existing = content.match(/## 信息图\s*\n[\s\S]*?(?=\n## [^\n]|\n$|$)/);
  if (existing && existing.index !== undefined) {
    // Replace the matched section. Preserve trailing newline structure by
    // matching up to (but not consuming) the next heading / EOF.
    return content.slice(0, existing.index) + section + content.slice(existing.index + existing[0].length);
  }
  // Append: ensure exactly one blank line between the previous content and
  // the new section, and a trailing newline at EOF.
  const trimmed = content.replace(/\s+$/, '');
  return `${trimmed}\n\n${section}\n`;
}
