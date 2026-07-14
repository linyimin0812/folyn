// ponytail: hand-rolled line parser instead of a markdown lib — the source
// format is mind-elixir plaintext (`- text\n  - child`), 2-space indent per
// depth. The OutlineEditor works on a flat list of {text, depth} rows rather
// than a nested tree: hierarchy is implicit in depth, fold is a range-hide
// over subsequent deeper rows. If per-node metadata (color/link/note) ever
// needs persisting, swap this for a real tree + a richer source format.

export interface OutlineLine {
  text: string;
  depth: number;
}

const FALLBACK: OutlineLine[] = [{ text: 'Root', depth: 0 }];

/**
 * Parse mind-elixir plaintext (`- Root\n  - Child`) into a flat list of
 * outline rows. Empty/whitespace-only lines are dropped. If the input has no
 * non-empty lines, returns a single root placeholder (the canvas needs at
 * least one node to init).
 */
export function parseOutline(content: string): OutlineLine[] {
  if (!content) return FALLBACK.slice();
  const lines = content.split('\n');
  const result: OutlineLine[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = raw.match(/^(\s*)(?:-\s+)?(.*)$/);
    const spaces = m?.[1].length ?? 0;
    const parsedDepth = Math.floor(spaces / 2);
    const text = m?.[2] ?? '';
    // ponytail: single-root invariant — the first non-empty line is always
    // the root (depth 0); every subsequent non-empty line MUST be a
    // descendant (depth >= 1). Without this, sibling-of-root lines parse
    // at depth 0 and render bullet-less (bullets are gated on depth > 0),
    // breaking the outliner contract. Source files with multiple depth-0
    // lines (e.g. `- A\n- B`) are normalized: B is bumped to depth 1.
    const depth = result.length === 0 ? 0 : Math.max(parsedDepth, 1);
    result.push({ text, depth });
  }
  if (result.length === 0) return FALLBACK.slice();
  return result;
}

/**
 * Serialize a flat list of outline rows back to mind-elixir plaintext.
 * Each row becomes `<2*depth spaces>- <text>`.
 */
export function serializeOutline(lines: OutlineLine[]): string {
  return lines.map((l) => '  '.repeat(l.depth) + '- ' + l.text).join('\n');
}
