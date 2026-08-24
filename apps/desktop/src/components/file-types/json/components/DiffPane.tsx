/**
 * DiffPane — two-editor CodeMirror 6 merge view for the JSON viewer's Diff
 * tab.
 *
 * Layout (full-row — JsonFileViewerPreview hides the editor pane while Diff
 * tab is selected):
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  +N -M                                                     │
 *   │ ─────────────────────────────────────────────────────────── │
 *   │ <MergeView>                                                │
 *   │   editor a (left, init = formatted file) | editor b (right) │
 *   │   char-level inline diff highlighting, scroll-synced         │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Both editors are editable. Left is scratch (file switch overwrites).
 * Right is fully local state. Neither persists across tab switches.
 *
 * Stats (+N -M) computed from `diff` package's diffLines over leftText /
 * rightText — same approach as the previous DiffPane iteration.
 *
 * CM6 mount pattern mirrors Json5CodeMirror.tsx (useRef + mount-once
 * useEffect + external value sync via dispatch with guard).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLines } from 'diff';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  highlightActiveLine,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { json as jsonLanguage } from '@codemirror/lang-json';
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap, linter } from '@codemirror/lint';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { MergeView } from '@codemirror/merge';
import { useAppearanceStore } from '@/store/appearanceStore';
import { mochiHighlighting } from '@/editor/highlightStyle';
import { json5LintSource } from '../editor/extensions/json5Linter';
import { errorInlineWidgetExtension } from '../editor/extensions/errorInlineWidget';

export interface DiffPaneProps {
  left: unknown;
}

const lightTheme: Extension = EditorView.theme({
  '&': {
    fontSize: '13px',
    height: '100%',
    backgroundColor: 'var(--panel, #fff)',
    color: 'var(--t1, #111)',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-lint-marker-error': { color: '#ef4444' },
  '.json-err-line': { backgroundColor: 'rgba(254, 226, 226, 0.5)' },
});

const darkTheme: Extension = EditorView.theme(
  {
    '&': { backgroundColor: '#1a1a1a', color: '#ddd' },
    '.json-err-line': { backgroundColor: 'rgba(127, 29, 29, 0.3)' },
  },
  { dark: true },
);

// ponytail: bare CM6 extension set for the merge editors — history, bracket
// matching, indent, json lang + json5 linter (covers the "error highlight
// on invalid input" requirement). Dropped autocomplete + search panel from
// Json5CodeMirror — diff editors are paste/compare surfaces, not author
// surfaces. Add back if users report needing them here.
function buildEditorExtensions(
  themeCompartment: Compartment,
  isDark: boolean,
  onDocChange: (text: string, view: EditorView) => void,
): Extension[] {
  return [
    drawSelection(),
    history(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(2),
    indentUnit.of('  '),
    indentOnInput(),
    mochiHighlighting(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    indentationMarkers(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onDocChange(update.state.doc.toString(), update.view);
      }
    }),
    jsonLanguage(),
    linter(json5LintSource, { delay: 300 }),
    errorInlineWidgetExtension,
    themeCompartment.of(isDark ? darkTheme : lightTheme),
  ];
}

export function DiffPane({ left }: DiffPaneProps) {
  const theme = useAppearanceStore((s) => s.theme);
  // ponytail: only 2 callers of resolved-diff-theme, inline for now.
  // Extract useResolvedDiffTheme() when a 3rd surfaces.
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  const isDark = resolvedTheme === 'dark';

  const [leftText, setLeftText] = useState(() => JSON.stringify(left, null, 2));
  const [rightText, setRightText] = useState('');

  // Reset left when the `left` prop changes (file switch / external content
  // change). Right is fully local — never reset by prop.
  useEffect(() => {
    setLeftText(JSON.stringify(left, null, 2));
  }, [left]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const mvRef = useRef<MergeView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  // ponytail: ref holds latest doc-change handler so the mount-once effect's
  // updateListener closure stays stable without re-running on every render.
  const onDocChangeRef = useRef<(text: string, side: 'a' | 'b') => void>(() => {});
  useEffect(() => {
    onDocChangeRef.current = (text, side) => {
      if (side === 'a') setLeftText(text);
      else setRightText(text);
    };
  }, []);

  // Mount-once: build MergeView with both editors.
  useEffect(() => {
    if (!hostRef.current) return;
    const themeCompartment = themeCompartmentRef.current;

    // onDocChange figures out which side fired by comparing the view to
    // mvRef.current.a / .b. mvRef.current is set right after construction,
    // so by the time the listener fires for real user input it's populated.
    const onDocChange = (text: string, view: EditorView) => {
      const mv = mvRef.current;
      if (!mv) return;
      const side = view === mv.a ? 'a' : 'b';
      onDocChangeRef.current(text, side);
    };

    const extensions = buildEditorExtensions(themeCompartment, isDark, onDocChange);

    const mv = new MergeView({
      a: { doc: leftText, extensions },
      b: { doc: rightText, extensions },
      parent: hostRef.current,
    });
    mvRef.current = mv;
    mv.dom.style.height = '100%';
    mv.dom.classList.add('min-h-0');

    return () => {
      mv.destroy();
      mvRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value sync: when leftText changes due to the `left` prop reset,
  // dispatch the new doc into editor a (guard skips when the editor is
  // already up to date, e.g. when the change originated from user typing).
  useEffect(() => {
    const mv = mvRef.current;
    if (!mv) return;
    const current = mv.a.state.doc.toString();
    if (current !== leftText) {
      mv.a.dispatch({ changes: { from: 0, to: current.length, insert: leftText } });
    }
  }, [leftText]);

  useEffect(() => {
    const mv = mvRef.current;
    if (!mv) return;
    const current = mv.b.state.doc.toString();
    if (current !== rightText) {
      mv.b.dispatch({ changes: { from: 0, to: current.length, insert: rightText } });
    }
  }, [rightText]);

  // Theme reconfigure on resolvedTheme change.
  useEffect(() => {
    const mv = mvRef.current;
    if (!mv) return;
    const compartment = themeCompartmentRef.current;
    mv.a.dispatch({ effects: compartment.reconfigure(isDark ? darkTheme : lightTheme) });
    mv.b.dispatch({ effects: compartment.reconfigure(isDark ? darkTheme : lightTheme) });
  }, [isDark]);

  // +N -M stats from `diff` package's diffLines over the two editors' text.
  const { adds, dels } = useMemo(() => {
    const parts = diffLines(leftText, rightText);
    let a = 0;
    let d = 0;
    for (const part of parts) {
      if (part.added) a += part.count;
      else if (part.removed) d += part.count;
    }
    return { adds: a, dels: d };
  }, [leftText, rightText]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar — stats only (dropped sort-both + split/unified from prev
          iter: MergeView is inherently side-by-side; sort semantics are
          unclear for two editable scratch editors). */}
      <div className="flex h-[28px] shrink-0 items-center gap-3 border-b border-brd bg-surf px-2 text-[11px]">
        <span className="flex items-center gap-2 font-mono">
          <span className="text-[#22c55e]">+{adds}</span>
          <span className="text-[#ef4444]">-{dels}</span>
        </span>
      </div>

      {/* MergeView host — fills remaining space. */}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-auto bg-panel" />
    </div>
  );
}
