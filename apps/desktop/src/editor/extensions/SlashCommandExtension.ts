import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';

export interface SlashMenuState {
  visible: boolean;
  pos: number;
  filter: string;
}

const setSlashMenu = StateEffect.define<SlashMenuState>();

export const slashMenuField = StateField.define<SlashMenuState>({
  create: () => ({ visible: false, pos: 0, filter: '' }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSlashMenu)) return effect.value;
    }
    return value;
  },
});

export function showSlashMenu(view: EditorView, pos: number) {
  view.dispatch({
    effects: setSlashMenu.of({ visible: true, pos, filter: '' }),
  });
}

export function hideSlashMenu(view: EditorView) {
  view.dispatch({
    effects: setSlashMenu.of({ visible: false, pos: 0, filter: '' }),
  });
}

export function updateSlashFilter(view: EditorView, pos: number, filter: string) {
  view.dispatch({
    effects: setSlashMenu.of({ visible: true, pos, filter }),
  });
}

export const slashCommandPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      // Let the IME own the document during composition (pinyin/Chinese
      // input). Dispatching transactions here — even effect-only — makes
      // WKWebView commit the composition early at a segment boundary and
      // drop the uncommitted pinyin (e.g. "wenjian" → "wen"). The commit
      // transaction arrives after compositionend (compositionStarted=false),
      // so the menu still re-evaluates once the text is finalized.
      if (update.view.compositionStarted) return;

      const state = update.state;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      const textBefore = state.doc.sliceString(line.from, pos);
      const menuState = state.field(slashMenuField);

      // Find the last '/' in the line text before cursor
      const slashIdx = textBefore.lastIndexOf('/');

      if (slashIdx !== -1) {
        const afterSlash = textBefore.slice(slashIdx + 1);
        // Only trigger if '/' is at line start or preceded by whitespace,
        // and not part of a self-closing HTML tag (e.g. "/>")
        const charBeforeSlash = slashIdx > 0 ? textBefore[slashIdx - 1] : ' ';
        const charAfterSlash = afterSlash.length > 0 ? afterSlash[0] : '';
        if ((charBeforeSlash === ' ' || charBeforeSlash === '\t' || slashIdx === 0) && charAfterSlash !== '>') {
          if (afterSlash.length === 0 && !menuState.visible) {
            // Just typed '/', show menu
            const viewRef = update.view;
            setTimeout(() => showSlashMenu(viewRef, pos), 0);
          } else if (afterSlash.length > 0 && !/\s/.test(afterSlash)) {
            // Typing filter text after '/'
            const viewRef = update.view;
            setTimeout(() => updateSlashFilter(viewRef, pos, afterSlash), 0);
          } else if (menuState.visible) {
            const viewRef = update.view;
            setTimeout(() => hideSlashMenu(viewRef), 0);
          }
          return;
        }
      }

      // No slash context — hide menu if visible
      if (menuState.visible) {
        const viewRef = update.view;
        setTimeout(() => hideSlashMenu(viewRef), 0);
      }
    }
  },
);

export const slashCommandExtension = [slashMenuField, slashCommandPlugin];
