import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';

/**
 * Typewriter mode: keeps the cursor line centered in the editor viewport on
 * every selection change or document change.
 *
 * Uses CodeMirror's scrollIntoView with y: 'center' so the editor's scroller
 * itself does the work — no manual scrollDOM manipulation that could fight
 * the editor's own scroll reconciliation.
 *
 * Disabled during IME composition (compositionStarted) to avoid jitter while
 * the candidate window is open.
 */
const typewriterPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.selectionSet && !update.docChanged) return;
      if (update.view.compositionStarted) return;
      const pos = update.state.selection.main.head;
      // Defer to the next microtask so the editor has finished its own
      // layout pass — scrolling into view before layout settles causes a
      // visible jump in WKWebView.
      queueMicrotask(() => {
        const v = update.view;
        if (v.compositionStarted) return;
        v.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
      });
    }
  },
);

export const typewriterModeExtension = [typewriterPlugin];
