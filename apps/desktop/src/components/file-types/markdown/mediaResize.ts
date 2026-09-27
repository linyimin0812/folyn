const MIN_MEDIA_WIDTH = 40;

/**
 * Calculates a media width for a resize gesture without exceeding the
 * available container width.
 */
export function getResizedMediaWidth(startWidth: number, deltaX: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(MIN_MEDIA_WIDTH, Math.round(startWidth + deltaX)));
}

/** Returns the tightest width constraint from media's ancestor layout chain. */
export function getMaxMediaWidth(...ancestorWidths: number[]): number {
  return Math.min(...ancestorWidths);
}

/**
 * Regex for the non-standard `=WxH` image-size suffix that drag-resize writes
 * back into markdown (`![alt](url =166x)`). `W` and `H` are each optional
 * (e.g. `=166x` sets width only). A leading space is required so a URL that
 * legitimately contains `=166x` without a space is left alone.
 */
const IMG_SIZE_SUFFIX_RE = /(!\[[^\]]*\]\([^)\s]+)(?:\s+=\d*x\d*)?(\))/g;

/**
 * Strip the `=WxH` size suffix from every markdown image URL in `md`.
 *
 * remark-parse can't parse `![alt](url =166x)` — it fails the inline image
 * grammar (the ` =166x` is not a valid link title) and emits a literal text
 * node, so a drag-resized image vanishes from the preview. Stripping the
 * suffix before parsing lets remark-parse render a proper <img>. The width
 * is re-applied visually by ResizableMedia, which reads the un-stripped
 * source line via readSourceWidth().
 */
export function stripImageSize(md: string): string {
  return md.replace(IMG_SIZE_SUFFIX_RE, '$1$2');
}

// ponytail: regex read/write on the source line, no AST writeback. Image
// resize uses an HTML comment `<!-- width=N -->` placed right after `![alt](url)`
// so the source remains valid CommonMark — other markdown compilers ignore
// the comment and still render the image. Code fences keep `width=N` after
// the lang word (fence info-string allows arbitrary text).
// Ceiling: only matches when the comment sits immediately after `)` (img)
// or the width sits right after the lang word (fence). Upgrade to AST
// writeback only if a real author puts the marker elsewhere.
const IMG_COMMENT_WIDTH_RE = /(!\[[^\]]*\]\([^)\s]+\))(?:<!--\s*width=(\d+)\s*-->)?/;
const IMG_COMMENT_STRIP_RE = /<!--\s*width=\d+\s*-->/g;
const FENCE_WIDTH_RE = /(```\w+)(?:\s+width=\d+)?/;
const FENCE_LINE_WIDTH_RE = /```(\w+)(?:\s+width=(\d+))?/;

export function applyImageSize(content: string, sourceLine: number, w: number | null): string {
  const lines = content.split('\n');
  const idx = sourceLine - 1;
  if (idx < 0 || idx >= lines.length) return content;
  const before = lines[idx];
  const stripped = before.replace(IMG_COMMENT_STRIP_RE, '');
  const next = w != null ? stripped.replace(IMG_COMMENT_WIDTH_RE, `$1<!-- width=${w} -->`) : stripped;
  if (next === before) return content;
  lines[idx] = next;
  return lines.join('\n');
}

export function applyFenceWidth(content: string, sourceLine: number, w: number | null): string {
  const lines = content.split('\n');
  const idx = sourceLine - 1;
  if (idx < 0 || idx >= lines.length) return content;
  const before = lines[idx];
  const stripped = before.replace(FENCE_WIDTH_RE, '$1');
  const next = w != null ? stripped.replace(FENCE_WIDTH_RE, `$1 width=${w}`) : stripped;
  if (next === before) return content;
  lines[idx] = next;
  return lines.join('\n');
}

/** Read the persisted width marker from the source line for an <img> or fence. */
export function readSourceWidth(kind: 'img' | 'fence', content: string | undefined, sourceLine: number | undefined): number | null {
  if (!content || sourceLine == null) return null;
  const line = content.split('\n')[sourceLine - 1];
  if (!line) return null;
  if (kind === 'img') {
    const m = line.match(IMG_COMMENT_WIDTH_RE);
    return m?.[2] ? Number(m[2]) : null;
  }
  const m = line.match(FENCE_LINE_WIDTH_RE);
  return m?.[2] ? Number(m[2]) : null;
}
