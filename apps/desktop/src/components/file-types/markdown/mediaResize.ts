const MIN_MEDIA_WIDTH = 40;

/**
 * Calculates a media width for a resize gesture without exceeding the
 * available container width.
 */
export function getResizedMediaWidth(startWidth: number, deltaX: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(MIN_MEDIA_WIDTH, Math.round(startWidth + deltaX)));
}

/** Returns the tightest width constraint from media's local and visible roots. */
export function getMaxMediaWidth(parentWidth: number, previewWidth: number): number {
  return Math.min(parentWidth, previewWidth);
}
