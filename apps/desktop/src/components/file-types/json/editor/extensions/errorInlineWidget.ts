/**
 * errorInlineWidget — CM6 extension that marks the JSON parse error LINE
 * with a whole-line red background (PR7+).
 *
 * Replaces the top red banner in `JsonFileViewerPreview.tsx`: the error
 * line itself is highlighted, always visible (not just on hover like the
 * linter's squiggle tooltip).
 *
 * Reuses `ensureJson5` + `diagnosticsFromError` from `json5Linter.ts`
 * so the parse + error-line-extraction logic is shared. The linter
 * still emits its `Diagnostic` (squiggle + hover tooltip); this line
 * decoration is an additional, always-on rendering of the same error.
 *
 * Pattern: a `StateField` holds the `DecorationSet`; a `ViewPlugin`
 * debounces re-parses on doc change and dispatches a `StateEffect` to
 * update the field. The line decoration is placed at the error line's
 * start position (`diag.from` from `diagnosticsFromError`).
 */
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
} from '@codemirror/view';
import {
  ensureJson5,
  json5ParseSync,
  diagnosticsFromError,
} from './json5Linter';

const REPARSE_DEBOUNCE_MS = 300;

/** Effect used to push a new decoration set into the state field. */
const setErrorDecorations = StateEffect.define<DecorationSet>();

const errorDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorDecorations)) {
        deco = e.value;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Re-parse the doc and dispatch the updated error line decoration. */
async function reparseAndSetDecorations(view: EditorView): Promise<void> {
  const content = view.state.doc.toString();
  if (content.trim().length === 0) {
    view.dispatch({ effects: setErrorDecorations.of(Decoration.none) });
    return;
  }
  await ensureJson5();
  if (json5ParseSync === null) {
    // json5 failed to load — no error to show.
    return;
  }
  let lineStart: number | null = null;
  try {
    json5ParseSync(content);
  } catch (err) {
    const diags = diagnosticsFromError(content, err, view.state.doc.lines);
    if (diags.length > 0) {
      // `diagnosticsFromError` sets `from` = lineStart (the start of the
      // error line). Decoration.line requires `from` at a line start.
      lineStart = diags[0].from;
    }
  }
  if (lineStart === null) {
    view.dispatch({ effects: setErrorDecorations.of(Decoration.none) });
    return;
  }
  const lineDeco = Decoration.line({
    class: 'json-err-line',
  });
  const deco = Decoration.set([lineDeco.range(lineStart)], true);
  view.dispatch({ effects: setErrorDecorations.of(deco) });
}

const reparsePlugin = ViewPlugin.fromClass(
  class {
    timer: number | null = null;

    constructor(view: EditorView) {
      void this.schedule(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        void this.schedule(update.view);
      }
    }

    schedule(view: EditorView) {
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
      }
      this.timer = window.setTimeout(() => {
        this.timer = null;
        void reparseAndSetDecorations(view);
      }, REPARSE_DEBOUNCE_MS);
    }

    destroy() {
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
      }
    }
  },
);

export const errorInlineWidgetExtension: Extension = [
  errorDecorationsField,
  reparsePlugin,
];
