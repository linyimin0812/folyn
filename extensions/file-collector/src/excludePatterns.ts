/**
 * The collector's own file filters, kept in `config.excludePatterns` as a
 * newline-separated list (the format of the host's 过滤文件/文件夹 setting,
 * which seeds it). Pure, tested.
 */

/** Stored value → patterns: trimmed, blank lines and `#` comments dropped. */
export function parsePatterns(raw: unknown): string[] {
  return String(raw ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'));
}

/** Append one pattern to the stored value. */
export function addPattern(raw: unknown, pattern: string): string {
  const current = String(raw ?? '');
  return current.trim() ? `${current.trimEnd()}\n${pattern}` : pattern;
}

/** Drop every line equal to `pattern` from the stored value. */
export function removePattern(raw: unknown, pattern: string): string {
  return String(raw ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== pattern)
    .join('\n');
}
