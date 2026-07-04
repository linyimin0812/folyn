/**
 * JSON5-aware linter for the JSON5 CodeMirror editor (PR7).
 *
 * Uses `json5.parse` for validation (accepts comments, unquoted keys,
 * trailing commas). Lazy-imports `json5` so the linter doesn't pull the
 * parser into the initial bundle — the parse runs only when the user
 * edits the doc.
 *
 * On parse error, returns a single `Diagnostic` covering the error line.
 * `json5`'s error doesn't include a character position, so we fall back
 * to line-number extraction from the message (e.g. "at line 5, column 3")
 * — same pattern as `EditorView.tsx`'s `jsonLintSource`.
 */
import type { Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';

/**
 * Shared json5 parse function. Set by `ensureJson5()` after first load.
 * Both the linter and the autocomplete source read from this so the
 * heavy `json5` module is loaded once across the editor.
 */
export let json5ParseSync: ((text: string) => unknown) | null = null;
let json5LoadPromise: Promise<void> | null = null;

export function ensureJson5(): Promise<void> {
  if (json5ParseSync !== null) return Promise.resolve();
  if (json5LoadPromise === null) {
    json5LoadPromise = import('json5').then((mod) => {
      const parse = mod.parse ?? (mod.default as { parse?: (s: string) => unknown })?.parse;
      if (typeof parse === 'function') {
        json5ParseSync = parse;
      }
    });
  }
  return json5LoadPromise;
}

/**
 * Build the linter Diagnostic array for a given doc + parse error.
 * Exported so unit tests can verify the error-line extraction without
 * waiting for CodeMirror's async linter pipeline.
 */
export function diagnosticsFromError(
  content: string,
  err: unknown,
  lineCount: number,
): Diagnostic[] {
  const message = err instanceof Error ? err.message : String(err);
  let errorPos = 0;
  const posMatch = message.match(/(?:position|char)\s+(\d+)/i);
  if (posMatch) {
    errorPos = Math.min(parseInt(posMatch[1], 10), content.length);
  } else {
    const lineMatch = message.match(/line\s+(\d+)/i);
    if (lineMatch) {
      const lineNum = Math.min(parseInt(lineMatch[1], 10), lineCount);
      errorPos = lineNum > 0
        ? content.split('\n').slice(0, lineNum - 1).join('\n').length + 1
        : 0;
    }
  }
  // Split content into lines so we can compute the error line's range.
  const lines = content.split('\n');
  let errorLine = 0;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineEnd = acc + lines[i].length;
    if (errorPos <= lineEnd) {
      errorLine = i;
      break;
    }
    acc = lineEnd + 1; // +1 for the \n
    errorLine = i + 1;
  }
  // Fallback: if errorPos pointed past the end, use last line.
  if (errorLine >= lines.length) errorLine = Math.max(0, lines.length - 1);
  const lineStart = errorLine === 0
    ? 0
    : lines.slice(0, errorLine).join('\n').length + 1;
  const lineText = lines[errorLine] ?? '';
  return [
    {
      from: lineStart,
      to: lineStart + lineText.length,
      message,
      severity: 'error',
    },
  ];
}

/**
 * CodeMirror async linter. The `linter()` wrapper expects a function
 * returning `Diagnostic[] | Promise<Diagnostic[]>`. We lazy-load json5
 * on first call, then re-parse on every doc change (debounced by
 * `linter({ delay })`).
 */
export async function json5LintSource(view: EditorView): Promise<Diagnostic[]> {
  const content = view.state.doc.toString();
  if (content.trim().length === 0) return [];
  await ensureJson5();
  if (json5ParseSync === null) return []; // json5 failed to load; no diagnostics
  try {
    json5ParseSync(content);
    return [];
  } catch (err) {
    return diagnosticsFromError(content, err, view.state.doc.lines);
  }
}
