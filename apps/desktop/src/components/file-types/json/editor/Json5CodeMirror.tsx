/**
 * Json5CodeMirror — slim CodeMirror 6 editor for the JSON viewer's left
 * pane (PR7). Replaces the PR3 `<textarea>` placeholder.
 *
 * Setup is a trimmed version of `EditorView.tsx` (no markdown / slash /
 * code-block / diff extensions). Adds:
 *   - `@codemirror/lang-json` for syntax highlighting (JSON5's unquoted
 *     keys / comments render as plain identifiers / no-ops, but the
 *     highlighter still colors the JSON structure; accepted trade-off
 *     per PRD R8).
 *   - JSON5-aware linter (lazy-loads `json5` for validation).
 *   - Custom `CompletionSource` walking the parsed AST.
 *
 * No line-number / fold / lint gutters and no minimap — the editor is
 * gutter-free by design.
 *
 * Controlled: the parent owns `value` and is notified via `onChange`.
 * External `value` changes (e.g. file switch) re-dispatch the doc into
 * the existing view (no remount) unless `key` changes (handled by parent).
 *
 * Theme: follows the system via the `dark` class on the editor's wrapper
 * div. The CM theme reconfigures on `prefers-color-scheme` change.
 */
import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
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
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap, linter } from '@codemirror/lint';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { json5LintSource } from './extensions/json5Linter';
import { jsonAutocomplete } from './extensions/jsonAutocomplete';

export interface Json5CodeMirrorProps {
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
}

export function Json5CodeMirror({ value, onChange, onSave }: Json5CodeMirrorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  // Keep latest callbacks without re-creating the editor.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Mount-once: build the editor + extensions.
  useEffect(() => {
    if (!hostRef.current) return;
    const themeCompartment = new Compartment();
    const langCompartment = new Compartment();

    const isDark =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    const baseTheme = EditorView.theme({
      '&': {
        fontSize: '13px',
        height: '100%',
        backgroundColor: 'var(--panel, #fff)',
        color: 'var(--t1, #111)',
      },
      '.cm-scroller': {
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-foldPlaceholder': { color: 'var(--t3, #999)' },
      '&.cm-focused': { outline: 'none' },
      '.cm-lint-marker-error': { color: '#ef4444' },
    });

    const darkTheme = EditorView.theme(
      {
        '&': { backgroundColor: '#1a1a1a', color: '#ddd' },
      },
      { dark: true },
    );

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: value,
      extensions: [
        drawSelection(),
        history(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        EditorState.tabSize.of(2),
        indentUnit.of('  '),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ override: [jsonAutocomplete] }),
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
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        saveKeymap,
        EditorView.lineWrapping,
        updateListener,
        themeCompartment.of(isDark ? darkTheme : baseTheme),
        langCompartment.of([
          jsonLanguage(),
          linter(json5LintSource, { delay: 300 }),
        ]),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    // Reconfigure theme on system theme change.
    let mq: MediaQueryList | null = null;
    const handleThemeChange = () => {
      const dark =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      view.dispatch({
        effects: themeCompartment.reconfigure(dark ? darkTheme : baseTheme),
      });
    };
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', handleThemeChange);
    }

    return () => {
      if (mq) mq.removeEventListener('change', handleThemeChange);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value sync: when parent's `value` differs from the editor's
  // current doc, dispatch a replace. Skipped on user edits (the editor's
  // doc is already up to date via the updateListener).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      className="json5-cm-host min-h-0 flex-1 overflow-hidden bg-panel text-t1"
    />
  );
}
