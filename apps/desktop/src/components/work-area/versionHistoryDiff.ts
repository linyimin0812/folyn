// ponytail: pure diff-classifier extracted from VersionHistoryPanel so the
// editorViewState store can import the DiffLine type without pulling a .tsx
// (which would cycle through the panel → store). Zero React deps. The panel
// re-exports parsePatchLines for test backwards-compat.

export interface DiffLine {
  text: string;
  kind: 'context' | 'add' | 'del' | 'hunk' | 'meta';
}

// ponytail: parse the unified-diff patch string into a flat list of lines with
// kind tags. Cheaper than tokenising via the `diff` package's structuredPatch
// (we render line-level only — per-character diff is Out of Scope per PRD).
// Ceiling: this won't surface intra-line edits; upgrade to structuredPatch if
// per-character granularity becomes a real need.
export function parsePatchLines(patch: string): DiffLine[] {
  const lines = patch.split('\n');
  return lines.map((line) => {
    if (line.startsWith('@@')) return { text: line, kind: 'hunk' as const };
    if (line.startsWith('+++') || line.startsWith('---')) return { text: line, kind: 'meta' as const };
    if (line.startsWith('+')) return { text: line.slice(1), kind: 'add' as const };
    if (line.startsWith('-')) return { text: line.slice(1), kind: 'del' as const };
    if (line.startsWith(' ')) return { text: line.slice(1), kind: 'context' as const };
    if (line.startsWith('\\')) return { text: line, kind: 'meta' as const };
    return { text: line, kind: 'context' as const };
  });
}
