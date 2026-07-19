import { useRef, useEffect, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorSearchBar } from '@/components/editor/EditorSearchBar';
import { useSearchPanelState, buildSearchExtensions } from '@/components/editor/searchPanelState';

interface SourceEditCanvasProps {
  content: string;
  onChange: (content: string) => void;
}

export function SourceEditCanvas({ content, onChange }: SourceEditCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const sp = useSearchPanelState();
  const onChangeRef = useRef(onChange);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isExternalUpdate = useRef(false);

  onChangeRef.current = onChange;

  // Initialize CodeMirror
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet) {
        sp.setViewTick((t) => (t + 1) % 1_000_000);
      }
      if (update.docChanged && !isExternalUpdate.current) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          onChangeRef.current(update.view.state.doc.toString());
        }, 300);
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        highlightSelectionMatches(),
        ...buildSearchExtensions(sp.toggleRef, sp.toggleReplaceRef),
        history(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        foldGutter(),
        indentOnInput(),
        indentUnit.of('  '),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        html(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.lineWrapping,
        updateListener,
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
          '.cm-content': { padding: '8px 0' },
          '.cm-gutters': { borderRight: '1px solid var(--brd, #dde2f0)', background: 'var(--panel, #fff)' },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    setView(view);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      view.destroy();
      viewRef.current = null;
      setView(null);
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync content when it changes externally (e.g., mode switch)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      isExternalUpdate.current = true;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      });
      isExternalUpdate.current = false;
    }
  }, [content]);

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden relative">
      <EditorSearchBar
        view={view}
        visible={sp.visible}
        replaceOpen={sp.replaceOpen}
        viewTick={sp.viewTick}
        onClose={() => sp.setVisible(false)}
        onToggleReplace={() => sp.setReplaceOpen((v) => !v)}
      />
    </div>
  );
}
