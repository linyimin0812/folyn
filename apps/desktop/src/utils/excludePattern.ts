/**
 * Pattern matching for the file-panel exclude list, shared between
 * `vaultStore.refreshFileTree` (filtering entries) and `GitPanel` (deciding
 * which changed-file rows get an "Add to .gitignore" button).
 *
 * ponytail: pure module — no IO, no React, trivially testable. The IO shell
 * around these lives in `services/gitService.ensureGitignoreEntries`.
 */

/** Convert a glob-like pattern to a RegExp for matching file/folder names. */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** Check if a file/folder name matches any of the exclude patterns. */
export function matchesAnyPattern(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.includes('*') || pattern.includes('?')) {
      return patternToRegExp(pattern).test(name);
    }
    return name === pattern;
  });
}

/**
 * Find the first exclude pattern that matches any segment of `filePath`.
 * Returns the matched pattern string (the thing to append to .gitignore) or
 * null. Splits on `/` so a path like `__wiki__/sub/foo.md` matches the
 * `__wiki__` pattern — same recursion behavior as `refreshFileTree`.
 */
export function findMatchedPattern(filePath: string, patterns: string[]): string | null {
  const segments = filePath.split('/').filter(Boolean);
  for (const seg of segments) {
    for (const p of patterns) {
      const isWildcard = p.includes('*') || p.includes('?');
      if (isWildcard ? patternToRegExp(p).test(seg) : seg === p) {
        return p;
      }
    }
  }
  return null;
}

/**
 * Merge `entries` into `existing` .gitignore content. Append-only: existing
 * lines (including comments) are preserved verbatim; only entries not already
 * present as literal lines are appended. Returns `{ changed, content }`.
 *
 * ponytail: comment lines (`#`) are preserved but skipped from the "have"
 * set — a `# __wiki__` comment doesn't count as already having `__wiki__`,
 * so the real entry still gets added.
 */
export function mergeGitignoreEntries(
  existing: string,
  entries: string[],
): { changed: boolean; content: string } {
  const have = new Set(
    existing
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#')),
  );
  const missing = entries
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && !e.startsWith('#') && !have.has(e));
  if (missing.length === 0) {
    return { changed: false, content: existing };
  }
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing;
  return { changed: true, content: `${prefix}${missing.join('\n')}\n` };
}
