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
