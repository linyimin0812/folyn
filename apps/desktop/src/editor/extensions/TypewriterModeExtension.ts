import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/**
 * Typewriter mode: keeps the cursor line centered in the editor viewport on
 * every selection change or document change.
 *
 * Directly sets scrollDOM.scrollTop after the editor's own layout pass
 * (requestAnimationFrame) so it wins any race against the editor's default
 * edge-scroll behavior. scrollIntoView with y:'center' was tried first but
 * WKWebView's native scroll reconciliation overrode it on every keystroke.
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
      requestAnimationFrame(() => {
        const v = update.view;
        if (v.compositionStarted) return;
        const coords = v.coordsAtPos(pos);
        if (!coords) return;
        const scroller = v.scrollDOM;
        const scrollerRect = scroller.getBoundingClientRect();
        const cursorY = coords.top - scrollerRect.top;
        const target = scroller.scrollTop + cursorY - scrollerRect.height / 2;
        scroller.scrollTop = target;
      });
    }
  },
);

export const typewriterModeExtension = [typewriterPlugin];
