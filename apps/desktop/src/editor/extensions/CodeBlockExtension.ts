import { EditorView, ViewPlugin, ViewUpdate, keymap } from '@codemirror/view';
import { StateField, StateEffect, Prec } from '@codemirror/state';
import hljs from 'highlight.js';

interface LanguageEntry {
  name: string;
  label: string;
}

let cachedLanguages: LanguageEntry[] | null = null;

function getAllLanguages(): LanguageEntry[] {
  if (!cachedLanguages) {
    // ponytail: mermaid isn't a highlight.js language, prepend so it shows in autocomplete
    // ponytail: html is an alias of xml in highlight.js so it's absent from listLanguages(); swap vbscript-html → html so the menu shows `html`
    const extras: LanguageEntry[] = [{ name: 'mermaid', label: 'mermaid' }, { name: 'html', label: 'html' }];
    cachedLanguages = [
      ...extras,
      ...hljs.listLanguages().sort().filter((name) => name !== 'vbscript-html').map((name) => ({ name, label: name })),
    ];
  }
  return cachedLanguages;
}

export interface CodeBlockMenuState {
  visible: boolean;
  triggerPos: number;
  blockStart: number;
  filter: string;
  selectedIndex: number;
}

const setCodeBlockMenu = StateEffect.define<CodeBlockMenuState>();
const hiddenState: CodeBlockMenuState = { visible: false, triggerPos: 0, blockStart: 0, filter: '', selectedIndex: 0 };

export const codeBlockMenuField = StateField.define<CodeBlockMenuState>({
  create: () => hiddenState,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCodeBlockMenu)) return effect.value;
    }
    return value;
  },
});

export function hideCodeBlockMenu(view: EditorView) {
  view.dispatch({ effects: setCodeBlockMenu.of(hiddenState) });
}

export function getFilteredLanguages(filter: string) {
  const languages = getAllLanguages();
  if (!filter) return languages;
  const lower = filter.toLowerCase();
  return languages.filter((lang) => lang.name.toLowerCase().includes(lower));
}

export function selectLanguage(view: EditorView, menuState: CodeBlockMenuState, langName: string) {
  const { blockStart } = menuState;
  const line = view.state.doc.lineAt(blockStart);
  const replaceEnd = line.to;
  const codeBlock = `\`\`\`${langName}\n\n\`\`\``;
  view.dispatch({
    changes: { from: blockStart, to: replaceEnd, insert: codeBlock },
    selection: { anchor: blockStart + 3 + langName.length + 1 },
    effects: setCodeBlockMenu.of(hiddenState),
  });
  view.focus();
}

export function selectPlainBlock(view: EditorView, menuState: CodeBlockMenuState) {
  const { blockStart } = menuState;
  const line = view.state.doc.lineAt(blockStart);
  const replaceEnd = line.to;
  const codeBlock = `\`\`\`\n\n\`\`\``;
  view.dispatch({
    changes: { from: blockStart, to: replaceEnd, insert: codeBlock },
    selection: { anchor: blockStart + 4 },
    effects: setCodeBlockMenu.of(hiddenState),
  });
  view.focus();
}

const codeBlockPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged) return;

      // Skip our own dispatches
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setCodeBlockMenu)) return;
        }
      }

      const state = update.state;
      const menuState = state.field(codeBlockMenuField);
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      const textBeforeCursor = state.doc.sliceString(line.from, pos);

      if (menuState.visible) {
        const filterText = textBeforeCursor.slice(menuState.triggerPos - line.from);
        if (/[\s\n]/.test(filterText) || pos < menuState.triggerPos) {
          const viewRef = update.view;
          setTimeout(() => hideCodeBlockMenu(viewRef), 0);
        } else {
          const filtered = getFilteredLanguages(filterText);
          if (filtered.length === 0) {
            const viewRef = update.view;
            setTimeout(() => hideCodeBlockMenu(viewRef), 0);
          } else {
            const viewRef = update.view;
            setTimeout(() => {
              viewRef.dispatch({
                effects: setCodeBlockMenu.of({ ...menuState, filter: filterText, selectedIndex: 0 }),
              });
            }, 0);
          }
        }
        return;
      }

      // Detect ``` at end of text before cursor
      if (textBeforeCursor.endsWith('```')) {
        const backtickStart = textBeforeCursor.length - 3;
        const charBefore = backtickStart > 0 ? textBeforeCursor[backtickStart - 1] : ' ';
        if (charBefore === ' ' || charBefore === '\t' || backtickStart === 0) {
          // Only trigger for opening fences: count ``` fences above this line
          // If odd number exist above, this is a closing fence — skip
          const docText = state.doc.sliceString(0, line.from);
          const fenceCount = (docText.match(/^[ \t]*```/gm) || []).length;
          if (fenceCount % 2 !== 0) return;

          const blockStart = line.from + backtickStart;
          const triggerPos = pos;
          const viewRef = update.view;
          setTimeout(() => {
            viewRef.dispatch({
              effects: setCodeBlockMenu.of({
                visible: true,
                triggerPos,
                blockStart,
                filter: '',
                selectedIndex: 0,
              }),
            });
          }, 0);
        }
      }
    }
  },
);

export const codeBlockKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Escape',
      run(view: EditorView) {
        const menuState = view.state.field(codeBlockMenuField);
        if (!menuState.visible) return false;
        hideCodeBlockMenu(view);
        return true;
      },
    },
    {
      key: 'Enter',
      run(view: EditorView) {
        const menuState = view.state.field(codeBlockMenuField);
        if (!menuState.visible) return false;
        const filtered = getFilteredLanguages(menuState.filter);
        if (filtered.length > 0) {
          selectLanguage(view, menuState, filtered[menuState.selectedIndex]?.name ?? filtered[0].name);
        } else {
          selectPlainBlock(view, menuState);
        }
        return true;
      },
    },
    {
      key: 'Tab',
      run(view: EditorView) {
        const menuState = view.state.field(codeBlockMenuField);
        if (!menuState.visible) return false;
        const filtered = getFilteredLanguages(menuState.filter);
        if (filtered.length > 0) {
          selectLanguage(view, menuState, filtered[menuState.selectedIndex]?.name ?? filtered[0].name);
        } else {
          selectPlainBlock(view, menuState);
        }
        return true;
      },
    },
    {
      key: 'ArrowDown',
      run(view: EditorView) {
        const menuState = view.state.field(codeBlockMenuField);
        if (!menuState.visible) return false;
        const filtered = getFilteredLanguages(menuState.filter);
        const nextIndex = Math.min(menuState.selectedIndex + 1, filtered.length - 1);
        view.dispatch({ effects: setCodeBlockMenu.of({ ...menuState, selectedIndex: nextIndex }) });
        return true;
      },
    },
    {
      key: 'ArrowUp',
      run(view: EditorView) {
        const menuState = view.state.field(codeBlockMenuField);
        if (!menuState.visible) return false;
        const prevIndex = Math.max(menuState.selectedIndex - 1, 0);
        view.dispatch({ effects: setCodeBlockMenu.of({ ...menuState, selectedIndex: prevIndex }) });
        return true;
      },
    },
  ]),
);

export const codeBlockExtension = [codeBlockMenuField, codeBlockPlugin, codeBlockKeymap];
