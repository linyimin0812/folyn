import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

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
        if (!coords) {
          console.log('[typewriter] no coords for pos', pos);
          return;
        }
        const scroller = v.scrollDOM;
        if (!scroller) {
          console.log('[typewriter] no scrollDOM');
          return;
        }
        const scrollerRect = scroller.getBoundingClientRect();
        const cursorY = coords.top - scrollerRect.top;
        const target = scroller.scrollTop + cursorY - scrollerRect.height / 2;
        console.log('[typewriter] scroll', {
          scrollTop: scroller.scrollTop,
          cursorY,
          height: scrollerRect.height,
          target,
        });
        scroller.scrollTop = target;
      });
    }
  },
);

export const typewriterModeExtension = [typewriterPlugin];
