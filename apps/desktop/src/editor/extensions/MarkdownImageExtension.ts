import { type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { type EditorState } from '@codemirror/state';
import { buildPathCompletion } from './pathCompletion';

/**
 * Detect whether the cursor is inside the `(...)` path part of a markdown
 * image syntax `![alt](path)`.
 *
 * Matches `](` followed by path text up to the cursor, not yet closed by `)`.
 * Returns the path text and its document offset so the completion can replace
 * exactly that span.
 */
export function imagePartialAt(state: EditorState, pos: number): { start: number; text: string } | null {
  const windowStart = Math.max(0, pos - 500);
  const before = state.sliceDoc(windowStart, pos);
  // `](` starts the URL — then anything up to the cursor that isn't `)` or whitespace-start.
  // We look for the last `](` before pos and ensure no `)` closed it yet.
  const m = before.match(/!\[[^\]]*\]\(([^)\s]*)$/);
  if (!m) return null;
  return { start: windowStart + (m.index ?? 0) + m[0].length - m[1].length, text: m[1] };
}

/**
 * Factory: returns a completion source for the path inside `![](...)` markdown
 * image syntax. Shows vault image files only, with directory drilling and
 * `./` `../` resolution relative to the current document — mirroring the
 * file-preview src completion UX.
 */
export function createMarkdownImageCompletion(filePath: string) {
  return async function markdownImageCompletion(ctx: CompletionContext): Promise<CompletionResult | null> {
    const found = imagePartialAt(ctx.state, ctx.pos);
    if (!found) return null;
    const result = await buildPathCompletion(found.text, found.start, ctx.pos, filePath, true);
    if (!result) return null;
    return { from: result.from, to: result.to, options: result.options, validFor: result.validFor };
  };
}
