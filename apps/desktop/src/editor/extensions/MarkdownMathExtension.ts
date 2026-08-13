import { ViewPlugin, ViewUpdate, Decoration, type DecorationSet, type EditorView } from '@codemirror/view';
import { RangeSet, type Extension, type EditorState } from '@codemirror/state';
import { foldService } from '@codemirror/language';
import { findMathSegments } from '@/services/markdown/renderMarkdown';

/**
 * CodeMirror 6 extension: syntax-highlight math segments and treat
 * `$$..$$` / `\[..\]` as foldable.
 *
 * ponytail: `@codemirror/lang-markdown`'s lezer parser doesn't recognize
 * math, and writing a lezer InlineParser is overkill for our needs. We
 * scan the doc with the same segment scanner as the render pipeline and
 * apply `Decoration.mark` to each math range. Folding uses `foldService`
 * to return the inner range of a `$$..$$` / `\[..\]` block on demand.
 *
 * Code blocks and inline code are skipped (the scanner doesn't return
 * math ranges inside code). `\$` is left to remark-parse at render time;
 * in the editor, a literal `\$` followed by `$x$` would still highlight
 * the second `$x$` as math — acceptable, since the editor is just hinting
 * intent, the render pipeline makes the final call.
 */

const inlineMark = Decoration.mark({ class: 'tok-math-inline' });
const displayMark = Decoration.mark({ class: 'tok-math-display' });

function buildDecorations(text: string): DecorationSet {
  const ranges = findMathSegments(text).map((seg) =>
    (seg.kind === 'display' ? displayMark : inlineMark).range(seg.from, seg.to),
  );
  return RangeSet.of(ranges, true);
}

const mathHighlightPlugin = ViewPlugin.fromClass(
  class MathHighlight {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state.doc.toString());
    }
    update(u: ViewUpdate) {
      if (u.docChanged) {
        this.decorations = buildDecorations(u.state.doc.toString());
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Fold service: when the cursor is inside a `$$..$$` or `\[..\]` block,
 * return the inner range (between the opening and closing markers) so
 * CodeMirror's fold command collapses it.
 *
 * ponytail: simplest correct inner range — seg.from + 2 to seg.to - 2
 * works for both `$$..$$` and `\[..\]` (both have 2-char opening/closing
 * markers). Inline `$..$` is skipped (kind filter); multi-line `$$..$$`
 * is supported because findMathSegments spans newlines for `[\s\S]*?`.
 */
const mathFoldService = foldService.of((state: EditorState, lineStart: number, lineEnd: number) => {
  const text = state.doc.toString();
  const pos = state.selection.main.head;
  if (pos < lineStart || pos > lineEnd) return null;
  for (const seg of findMathSegments(text)) {
    if (seg.kind !== 'display') continue;
    if (pos >= seg.from && pos <= seg.to) {
      if (seg.to - seg.from <= 4) return null;
      return { from: seg.from + 2, to: seg.to - 2 };
    }
  }
  return null;
});

export const mathExtension: Extension[] = [mathHighlightPlugin, mathFoldService];
