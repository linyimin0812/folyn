/**
 * Pure helpers for the internal-link hover preview (refactor spec 5.2 —
 * 内部链接快速预览). Given a linked target (path + optional #fragment) and
 * the target document's source text, produce what the popover shows:
 * doc name, display path, target section title, and a bounded excerpt
 * (headings / lists / code render; container-directive markers and images
 * are dropped — a glimpse, not a second reader).
 *
 * Pure text work only — no IO, no DOM. The store/component layers live in
 * linkPreviewStore.ts / LinkPreviewPopover.tsx.
 */

/** Same slug rule HeadingWithId stamps onto h1–h6 in the preview DOM. */
export function headingSlug(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '');
}

export interface SectionMatch {
  /** 1-based source line of the matched heading (frontmatter included). */
  line: number;
  /** Heading level (1–6). */
  level: number;
  /** Heading text as written. */
  text: string;
}

/** Frontmatter (# … / --- block) shifts the body's line numbers. */
export function frontmatterLineCount(content: string): number {
  if (!content.startsWith('---')) return 0;
  const lines = content.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) return i + 1;
  }
  return 0;
}

/** Scan ATX headings; fences are skipped so `#` in code doesn't count. */
export function scanHeadings(content: string): SectionMatch[] {
  const out: SectionMatch[] = [];
  let inFence = false;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence;
    if (inFence) continue;
    const m = raw.match(/^(#{1,6})\s+(.*)$/);
    if (m) out.push({ line: i + 1, level: m[1].length, text: m[2].trim() });
  }
  return out;
}

/**
 * Resolve a `#fragment` (raw or percent-encoded) to the target document's
 * heading — the same id the preview's HeadingWithId generates, so a
 * fragment that scrolls the real preview also finds the section here.
 */
export function findSection(content: string, fragment: string | undefined): SectionMatch | null {
  if (!fragment) return null;
  let frag = fragment;
  try {
    frag = decodeURIComponent(fragment);
  } catch { /* keep raw */ }
  const wanted = headingSlug(frag);
  if (!wanted) return null;
  // Exact slug match first, then a text-equality fallback (a heading whose
  // slug-stripped text lost the exact id to punctuation).
  let textMatch: SectionMatch | null = null;
  for (const h of scanHeadings(content)) {
    if (headingSlug(h.text) === wanted) return h;
    if (h.text === frag && !textMatch) textMatch = h;
  }
  return textMatch;
}

/** Excerpt budget: enough to judge the target, never a second reader. */
export const EXCERPT_MAX_LINES = 32;

/**
 * Extract the excerpt: from the section heading (or the top of the body
 * when no fragment), forward until the next heading of the same-or-higher
 * level (a peek into that SECTION only) or the line budget runs out.
 *
 * - Directive marker lines (`:::tabs`, closing `:::`, `:::tab X`) are
 *   dropped — their panel content stays as plain paragraphs and reads fine
 *   at a glance.
 * - Image/embed lines are dropped: the popover has no asset base to
 *   resolve `pic.png` against, and a broken-image glyph is worse than
 *   nothing.
 * - A cut that lands inside a fence is repaired by appending the closing
 *   fence, so code blocks render as code.
 */
export function extractExcerpt(content: string, section: SectionMatch | null): string {
  const lines = content.split('\n');
  const fm = frontmatterLineCount(content);
  // No fragment: the document's FIRST heading anchors the excerpt (the
  // intro under the title) — same boundary rule as an explicit section.
  let sec = section;
  let start: number;
  if (sec) {
    start = sec.line + 1; // skip the heading line itself (title shown separately)
  } else {
    const first = scanHeadings(content)[0];
    if (first && first.line > fm) {
      sec = first;
      start = first.line + 1;
    } else {
      start = fm + 1;
    }
  }
  if (start > lines.length) return '';

  let fenceMarker: string | null = null;
  let fenceOpen = false;
  const kept: string[] = [];
  for (let i = start; i <= lines.length && kept.filter((l) => l !== '').length < EXCERPT_MAX_LINES; i++) {
    const raw = lines[i - 1];
    const fence = raw.match(/^\s*(```|~~~)/);
    if (fence) {
      if (!fenceOpen) {
        fenceMarker = fence[1];
        fenceOpen = true;
      } else {
        fenceMarker = null;
        fenceOpen = false;
      }
      kept.push(raw);
      continue;
    }
    if (fenceOpen) {
      kept.push(raw); // code content: never filtered, never budget-counted
      continue;
    }
    // Stop at the next heading that ends this section.
    const h = raw.match(/^(#{1,6})\s+/);
    if (h && section && h[1].length <= section.level) break;
    if (h && !section) break; // no-fragment excerpt = document intro only
    // Drop directive markers.
    if (/^\s*:::/.test(raw)) continue;
    // Drop image-only lines.
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(raw)) continue;
    kept.push(raw);
  }
  if (fenceOpen && fenceMarker) kept.push(fenceMarker);

  // Trim trailing blanks so the popover doesn't end in a grey void.
  while (kept.length && /^\s*$/.test(kept[kept.length - 1]!)) kept.pop();
  return kept.join('\n');
}

export interface LinkPreviewModel {
  /** File name with extension, e.g. `notes.md`. */
  name: string;
  /** Path as shown under the title (vault-relative or absolute as given). */
  displayPath: string;
  /** Section heading text when a #fragment resolved; else null. */
  section: string | null;
  /** Section line when resolved — lets the popover say `第 N 行`. */
  sectionLine: number | null;
  /** Markdown excerpt (may be empty for stub files). */
  excerpt: string;
}

/** Build the popover's whole data model from the target + its source text. */
export function buildLinkPreview(path: string, fragment: string | undefined, content: string): LinkPreviewModel {
  const name = path.substring(path.lastIndexOf('/') + 1) || path;
  const displayPath = path === name ? '/' : (path.substring(0, path.length - name.length - 1) || '/');
  const section = findSection(content, fragment);
  return {
    name,
    displayPath,
    section: section?.text ?? null,
    sectionLine: section ? section.line : null,
    excerpt: extractExcerpt(content, section),
  };
}

/** Only markdown text targets make sense to preview (glimpse of the doc). */
export function isPreviewableTarget(path: string): boolean {
  return /\.md$/i.test(path) || /\.markdown$/i.test(path);
}
