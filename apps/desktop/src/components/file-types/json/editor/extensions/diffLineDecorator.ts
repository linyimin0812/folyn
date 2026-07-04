/**
 * diffLineDecorator — CM6 extension that renders a line-level diff between
 * a baseline string and the editor's current doc as colored line backgrounds.
 *
 * Used by the JSON viewer's Diff tab (DiffPane.tsx) to render the diff inline
 * in the right-side editor. The baseline is the formatted left-side value
 * (`JSON.stringify(left, null, 2)`); the editor's doc is the user's raw
 * `rightInput`. Only "added" parts (lines present in the doc but not in the
 * baseline) are highlighted — "removed" parts have no position in the doc
 * and are silently skipped.
 *
 * Pattern mirrors `errorInlineWidget.ts`:
 *   - A `StateField<DecorationSet>` holds the line decorations.
 *   - A `ViewPlugin` debounces (300ms) recompute on doc change OR when the
 *     baseline is updated via the `setDiffBaseline` helper.
 *   - `diffLines` from the `diff` npm package (v9) computes the line-level
 *     delta; each `part.added` range is converted to `Decoration.line` ranges
 *     at every line start within the added text.
 *
 * The current baseline is held in a closure-captured mutable field on the
 * plugin instance so the ViewPlugin can read it without re-creating the
 * extension.
 */
import {
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  type DecorationSet,
  EditorView,
} from '@codemirror/view';
import { diffLines } from 'diff';

const RECOMPUTE_DEBOUNCE_MS = 300;

/** Effect used to push a new decoration set into the state field. */
const setDiffDecorations = StateEffect.define<DecorationSet>();

/** Effect used to update the baseline text from outside the plugin. */
const setDiffBaselineEffect = StateEffect.define<string>();

const diffDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setDiffDecorations)) {
        deco = e.value;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Compute line decorations for "added" parts of the line-level diff between
 * `baseline` and `docText`. Returns `Decoration.none` if there is nothing to
 * highlight.
 *
 * `diffLines` returns change objects whose `value` is a run of complete lines
 * (trailing newlines included). Boundaries between parts therefore align with
 * line starts in the doc, so `Decoration.line` ranges are valid.
 */
function computeAddedLineDecorations(
  baseline: string,
  docText: string,
): DecorationSet {
  if (docText.length === 0) return Decoration.none;
  const parts = diffLines(baseline, docText);
  const lineDeco = Decoration.line({ class: 'cm-diff-added-line' });
  const ranges: ReturnType<typeof lineDeco.range>[] = [];
  let docPos = 0;
  for (const part of parts) {
    const len = part.value.length;
    if (part.added) {
      // Walk the added text and place a line decoration at every line start.
      // `lineStart` always points to a position at a line boundary in the doc
      // (either 0 or right after a '\n' in the previous part).
      let lineStart = docPos;
      for (let i = 0; i < len; i++) {
        if (part.value[i] === '\n') {
          ranges.push(lineDeco.range(lineStart));
          lineStart = docPos + i + 1;
        }
      }
      // If the added text doesn't end with '\n', the trailing segment is a
      // final added line — decorate it. If it does end with '\n', the next
      // part starts on a new line that belongs to a different (non-added)
      // run, so we must NOT decorate that line.
      const trailingLen = docPos + len - lineStart;
      if (trailingLen > 0) {
        ranges.push(lineDeco.range(lineStart));
      }
    }
    if (!part.removed) {
      docPos += len;
    }
  }
  if (ranges.length === 0) return Decoration.none;
  return Decoration.set(ranges, true);
}

const diffPlugin = ViewPlugin.fromClass(
  class {
    baseline = '';
    timer: number | null = null;

    constructor(view: EditorView) {
      void this.schedule(view);
    }

    update(update: ViewUpdate) {
      let baselineChanged = false;
      for (const tr of update.transactions) {
        for (const e of tr.effects) {
          if (e.is(setDiffBaselineEffect)) {
            this.baseline = e.value;
            baselineChanged = true;
          }
        }
      }
      if (update.docChanged || baselineChanged) {
        void this.schedule(update.view);
      }
    }

    schedule(view: EditorView) {
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
      }
      this.timer = window.setTimeout(() => {
        this.timer = null;
        const deco = computeAddedLineDecorations(
          this.baseline,
          view.state.doc.toString(),
        );
        view.dispatch({ effects: setDiffDecorations.of(deco) });
      }, RECOMPUTE_DEBOUNCE_MS);
    }

    destroy() {
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
      }
    }
  },
);

export const diffLineDecoratorExtension: Extension = [
  diffDecorationsField,
  diffPlugin,
];

/**
 * Push a new baseline text into the extension. Triggers a debounced recompute
 * of the line decorations. Safe to call before the plugin has been mounted
 * (the dispatch is a no-op in that case).
 */
export function setDiffBaseline(view: EditorView, text: string): void {
  view.dispatch({ effects: setDiffBaselineEffect.of(text) });
}
