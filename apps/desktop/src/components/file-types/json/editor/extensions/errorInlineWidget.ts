/**
 * errorInlineWidget — CM6 extension that renders the JSON parse error
 * as a persistent inline widget at the END of the error line (PR7+).
 *
 * Replaces the top red banner in `JsonFileViewerPreview.tsx`: the error
 * is shown inline next to the offending line, always visible (not just
 * on hover like the linter's squiggle tooltip).
 *
 * Reuses `ensureJson5` + `diagnosticsFromError` from `json5Linter.ts`
 * so the parse + error-line-extraction logic is shared. The linter
 * still emits its `Diagnostic` (squiggle + hover tooltip); this widget
 * is an additional, always-on rendering of the same error message.
 *
 * Pattern: a `StateField` holds the `DecorationSet`; a `ViewPlugin`
 * debounces re-parses on doc change and dispatches a `StateEffect` to
 * update the field. The widget decoration is placed at the error line's
 * end position (`diag.to` from `diagnosticsFromError`).
 */
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import {
  ensureJson5,
  json5ParseSync,
  diagnosticsFromError,
} from './json5Linter';

const REPARSE_DEBOUNCE_MS = 300;

/** Effect used to push a new decoration set into the state field. */
const setErrorDecorations = StateEffect.define<DecorationSet>();

class ErrorWidget extends WidgetType {
  constructor(readonly message: string) {
    super();
  }
  toDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'json-err-inline';
    div.textContent = `⚠ ${this.message}`;
    div.setAttribute('aria-label', 'JSON parse error');
    return div;
  }
}

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

/** Re-parse the doc and dispatch the updated error widget decoration. */
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
  let message: string | null = null;
  let lineEnd = 0;
  try {
    json5ParseSync(content);
  } catch (err) {
    const diags = diagnosticsFromError(content, err, view.state.doc.lines);
    if (diags.length > 0) {
      const diag = diags[0];
      message = diag.message;
      // `diagnosticsFromError` sets `to` = lineStart + lineText.length,
      // i.e. the end of the error line. Clamp to doc length.
      lineEnd = Math.min(diag.to, content.length);
    }
  }
  if (message === null) {
    view.dispatch({ effects: setErrorDecorations.of(Decoration.none) });
    return;
  }
  const widget = Decoration.widget({
    widget: new ErrorWidget(message),
    side: 1, // render after the line's content.
  });
  const deco = Decoration.set([widget.range(lineEnd)], true);
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
