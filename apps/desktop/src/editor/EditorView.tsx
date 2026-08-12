import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  tooltips,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, selectAll } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
  LanguageDescription,
  LanguageSupport,
} from '@codemirror/language';
import { quillHighlighting } from './highlightStyle';
import { registerBuiltinCodeContributions } from '@/services/registerBuiltinCodeContributions';
import { listEditorLanguages } from '@/services/plugin-host/editorLanguageAdapter';

registerBuiltinCodeContributions();

// ponytail: build markdown codeLanguages at module load. Reads the editorLanguageRegistry
// (mermaid builtin + any plugin-registered languages loaded before this module) and falls
// back to @codemirror/language-data. Open editors do NOT live-migrate on later plugin load —
// MVP; affects newly-opened editors only.
function buildCodeLanguages(): LanguageDescription[] {
  const registryDescs = listEditorLanguages().map((entry) =>
    LanguageDescription.of({
      name: entry.canonical,
      alias: entry.aliases,
      // Extensions come from the same registry that drives markdown code
      // fences, so standalone files (.puml/.pu/.dot/.gv/...) get the same
      // CodeMirror highlighting as ```plantuml / ```dot blocks.
      extensions: entry.extensions,
      load: async () => entry.factory() as LanguageSupport,
    }),
  );
  return [...registryDescs, ...languages];
}
const codeLanguages = buildCodeLanguages();
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap, linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { EditorSearchBar } from '@/components/editor/EditorSearchBar';
import { useSearchPanelState, buildSearchExtensions } from '@/components/editor/searchPanelState';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useEditorPrefsStore } from '@/store/editorPrefsStore';
import { usePrefsStore, type ShortcutItem } from '@/store/prefsStore';
import {
  computeSlashMenuState,
  type SlashMenuState,
} from './extensions/SlashCommandExtension';
import {
  codeBlockExtension,
  codeBlockMenuField,
  type CodeBlockMenuState,
} from './extensions/CodeBlockExtension';
import { createFilePreviewSrcCompletion, filePreviewSrcSearchBox } from './extensions/FilePreviewSrcExtension';
import { orderedListExtension } from './extensions/OrderedListExtension';
import { inlineDiffExtension } from './extensions/InlineDiffExtension';
import { json as jsonLanguage } from '@codemirror/lang-json';

/** JSON linter: validates JSON syntax and highlights only the error line */
function jsonLintSource(view: EditorView): Diagnostic[] {
  const content = view.state.doc.toString();
  if (!content.trim()) return [];
  try {
    JSON.parse(content);
    return [];
  } catch (err) {
    const message = err instanceof SyntaxError ? err.message : 'Invalid JSON';
    // Try to extract position from error message (e.g. "at position 42")
    const posMatch = message.match(/position\s+(\d+)/i);
    let errorPos = 0;
    if (posMatch) {
      errorPos = Math.min(parseInt(posMatch[1], 10), content.length);
    } else {
      // Fallback: try to extract line number (e.g. "line 5 column 3")
      const lineMatch = message.match(/line\s+(\d+)/i);
      if (lineMatch) {
        const lineNum = Math.min(parseInt(lineMatch[1], 10), view.state.doc.lines);
        errorPos = view.state.doc.line(lineNum).from;
      }
    }
    // Always highlight only the single error line
    const errorLine = view.state.doc.lineAt(errorPos);
    return [{ from: errorLine.from, to: errorLine.to, message, severity: 'error' }];
  }
}

/** Convert display key symbols (⌘, Shift, etc.) to CodeMirror key format (Mod-Shift-s) */
function shortcutToCmKey(keys: string[]): string {
  const modMap: Record<string, string> = { '⌘': 'Mod', Ctrl: 'Ctrl', '⌥': 'Alt', Shift: 'Shift' };
  const mods: string[] = [];
  let mainKey = '';
  for (const k of keys) {
    if (modMap[k]) {
      mods.push(modMap[k]);
    } else {
      mainKey = k.toLowerCase();
    }
  }
  return [...mods, mainKey].join('-');
}

/** Build CodeMirror keymap entries from shortcut settings */
function buildMarkdownKeymap(
  shortcuts: ShortcutItem[],
  onSaveRef: React.MutableRefObject<(() => void) | undefined>,
): { key: string; run: (v: EditorView) => boolean }[] {
  const actionMap: Record<string, (v: EditorView) => boolean> = {
    save: () => { onSaveRef.current?.(); return true; },
    bold: (v) => {
      const { from, to } = v.state.selection.main;
      const sel = v.state.sliceDoc(from, to) || '文本';
      v.dispatch({ changes: { from, to, insert: `**${sel}**` }, selection: { anchor: from + 2, head: from + 2 + sel.length } });
      return true;
    },
    italic: (v) => {
      const { from, to } = v.state.selection.main;
      const sel = v.state.sliceDoc(from, to) || '文本';
      v.dispatch({ changes: { from, to, insert: `*${sel}*` }, selection: { anchor: from + 1, head: from + 1 + sel.length } });
      return true;
    },
    strikethrough: (v) => {
      const { from, to } = v.state.selection.main;
      const sel = v.state.sliceDoc(from, to) || '文本';
      v.dispatch({ changes: { from, to, insert: `~~${sel}~~` }, selection: { anchor: from + 2, head: from + 2 + sel.length } });
      return true;
    },
    code: (v) => {
      const { from, to } = v.state.selection.main;
      const sel = v.state.sliceDoc(from, to) || '代码';
      v.dispatch({ changes: { from, to, insert: `\`${sel}\`` }, selection: { anchor: from + 1, head: from + 1 + sel.length } });
      return true;
    },
    link: (v) => {
      const { from, to } = v.state.selection.main;
      const sel = v.state.sliceDoc(from, to) || '链接文本';
      v.dispatch({ changes: { from, to, insert: `[${sel}](url)` }, selection: { anchor: from + sel.length + 3, head: from + sel.length + 6 } });
      return true;
    },
  };

  return shortcuts
    .filter((s) => actionMap[s.id])
    .map((s) => ({ key: shortcutToCmKey(s.keys), run: actionMap[s.id] }));
}

export interface QuillEditorHandle {
  getView: () => EditorView | null;
  getScrollDOM: () => HTMLElement | null;
  replaceContent: (content: string) => void;
}

interface QuillEditorProps {
  initialContent?: string;
  filePath?: string;
  /** Initial cursor line (1-based) to restore on mount */
  initialCursorLine?: number;
  /** Initial cursor column (1-based) to restore on mount */
  initialCursorCol?: number;
  onChange?: (content: string) => void;
  onSlashMenuChange?: (state: SlashMenuState) => void;
  onCodeBlockMenuChange?: (state: CodeBlockMenuState) => void;
  onSave?: () => void;
  onImagePaste?: (file: File, previewUrl: string) => void;
  /** ponytail: read-only mode — `EditorState.readOnly.of(true)` blocks doc-modifying
   *  transactions but keeps the cursor + selection + scroll, so the version-history
   *  snapshot view can show real CodeMirror highlighting with full text selection. */
  readOnly?: boolean;
}

export const QuillEditor = forwardRef<QuillEditorHandle, QuillEditorProps>(
  function QuillEditor({ initialContent = '', filePath = '', initialCursorLine, initialCursorCol, onChange, onSlashMenuChange, onCodeBlockMenuChange, onSave, onImagePaste, readOnly }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [view, setView] = useState<EditorView | null>(null);
    const sp = useSearchPanelState();
    const tabSizeCompartment = useRef(new Compartment());
    const markdownKeymapCompartment = useRef(new Compartment());
    const langCompartment = useRef(new Compartment());
    const setCursorPosition = useEditorViewStateStore((s) => s.setCursorPosition);
    const setWordCount = useEditorViewStateStore((s) => s.setWordCount);
    const editorFont = useEditorPrefsStore((s) => s.editorFont);
    const editorFontSize = useEditorPrefsStore((s) => s.editorFontSize);
    const showLineNumbers = useEditorPrefsStore((s) => s.showLineNumbers);
    const settingsTabSize = useEditorPrefsStore((s) => s.tabSize);
    const shortcuts = usePrefsStore((s) => s.shortcuts);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onSlashMenuChangeRef = useRef(onSlashMenuChange);
    onSlashMenuChangeRef.current = onSlashMenuChange;
    const onCodeBlockMenuChangeRef = useRef(onCodeBlockMenuChange);
    onCodeBlockMenuChangeRef.current = onCodeBlockMenuChange;
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const onImagePasteRef = useRef(onImagePaste);
    onImagePasteRef.current = onImagePaste;

    useImperativeHandle(ref, () => ({
      getView: () => viewRef.current,
      getScrollDOM: () => viewRef.current?.scrollDOM ?? null,
      replaceContent: (content: string) => {
        const view = viewRef.current;
        if (!view) return;
        const currentContent = view.state.doc.toString();
        if (currentContent === content) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
        });
      },
    }));

    const handleUpdate = useCallback(
      (update: any) => {
        try {
          if (update.docChanged || update.selectionSet) {
            sp.setViewTick((t) => (t + 1) % 1_000_000);
          }
          if (update.docChanged) {
            const content = update.state.doc.toString();
            onChangeRef.current?.(content);
            const words = content.trim().split(/\s+/).filter(Boolean).length;
            setWordCount(words);
          }
          if (update.selectionSet) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            setCursorPosition(line.number, pos - line.from + 1);
          }
          // Notify parent about slash menu state changes. Derived purely from
          // the document + cursor (no CodeMirror transaction, no state field),
          // so IME composition is never disturbed and the menu filters live —
          // deterministically, for both plain typing and pinyin input.
          onSlashMenuChangeRef.current?.(computeSlashMenuState(update.state));
          // Notify parent about code block menu state changes
          const cbMenuState = update.state.field(codeBlockMenuField);
          onCodeBlockMenuChangeRef.current?.(cbMenuState);
        } catch {
          // Ignore errors during rapid edits (e.g. coordsAtPos with invalid position)
        }
      },
      [setCursorPosition, setWordCount, sp.setViewTick],
    );

    useEffect(() => {
      if (!editorRef.current) return;

      const isMarkdown = !filePath || /\.(md|markdown|mdx)$/i.test(filePath);

      // Common extensions shared by all file types
      const commonExtensions = [
        EditorView.theme({
          '&': { fontSize: `${editorFontSize}px` },
          '.cm-scroller': { fontFamily: editorFont },
        }),
        ...(showLineNumbers ? [lineNumbers()] : []),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        foldGutter(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        // ponytail: read-only snapshot mode blocks doc modifications but keeps
        // selection + scroll so the version-history view is a real CodeMirror
        // surface, not a static <pre>.
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
        tabSizeCompartment.current.of([
          EditorState.tabSize.of(settingsTabSize),
          indentUnit.of(' '.repeat(settingsTabSize)),
        ]),
        indentOnInput(),
        quillHighlighting(),
        bracketMatching(),
        closeBrackets(),
        // closeOnBlur: false — the src dropdown hosts its own search input;
        // focusing it must not dismiss the dropdown. The search-box plugin
        // closes the completion when focus leaves the editor entirely.
        // interactionDelay: 0 — the default 75ms swallows accept/arrow keys
        // right after the popup opens; a swallowed Enter falls through to the
        // editor's default keymap and inserts a newline into the src string.
        autocompletion({
          override: [createFilePreviewSrcCompletion(filePath)],
          closeOnBlur: false,
          interactionDelay: 0,
        }),
        filePreviewSrcSearchBox(),
        // Render tooltips on <body> (fixed position): inside the editor they
        // get clipped by .cm-wrapper's overflow:hidden and slide under the
        // preview pane on the right.
        tooltips({ parent: document.body }),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        indentationMarkers(),
        ...buildSearchExtensions(sp.toggleRef, sp.toggleReplaceRef),
        ...inlineDiffExtension,
        keymap.of([
          { key: 'Mod-a', run: selectAll },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of(handleUpdate),
        langCompartment.current.of([]),
      ];

      // Markdown-specific extensions
      const markdownExtensions = isMarkdown ? [
        markdownKeymapCompartment.current.of(
          keymap.of(buildMarkdownKeymap(shortcuts, onSaveRef)),
        ),
        markdown({ base: markdownLanguage, codeLanguages }),
        ...codeBlockExtension,
        ...orderedListExtension,
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          paste(event) {
            const items = event.clipboardData?.items;
            if (!items) return false;
            for (const item of Array.from(items)) {
              if (item.type.startsWith('image/')) {
                event.preventDefault();
                const file = item.getAsFile();
                if (file) {
                  const previewUrl = URL.createObjectURL(file);
                  onImagePasteRef.current?.(file, previewUrl);
                }
                return true;
              }
            }
            return false;
          },
        }),
      ] : [];

      const state = EditorState.create({
        doc: initialContent,
        extensions: [...commonExtensions, ...markdownExtensions],
      });

      const view = new EditorView({
        state,
        parent: editorRef.current,
      });

      viewRef.current = view;
      setView(view);

      // Restore cursor position if provided
      if (initialCursorLine && initialCursorLine > 0) {
        const lineCount = view.state.doc.lines;
        const targetLine = Math.min(initialCursorLine, lineCount);
        const lineInfo = view.state.doc.line(targetLine);
        const col = Math.min((initialCursorCol ?? 1) - 1, lineInfo.length);
        const cursorPos = lineInfo.from + col;
        view.dispatch({
          selection: { anchor: cursorPos },
          scrollIntoView: true,
        });
      }

      // For code files, dynamically load the matching language support
      if (!isMarkdown && filePath) {
        const isJson = /\.json$/i.test(filePath);
        const isDbml = /\.dbml$/i.test(filePath);
        if (isJson) {
          // JSON files: use dedicated language support + lint
          view.dispatch({
            effects: langCompartment.current.reconfigure([
              jsonLanguage(),
              lintGutter(),
              linter(jsonLintSource, { delay: 300 }),
            ]),
          });
        } else if (isDbml) {
          // DBML has no dedicated CodeMirror language; reuse SQL highlighting
          // (via @codemirror/language-data's SQL LanguageDescription) as a
          // close-enough fallback for keywords/types/strings/comments.
          const sqlDesc = languages.find((l) => l.name === 'SQL');
          if (sqlDesc) {
            sqlDesc.load().then((langSupport) => {
              view.dispatch({
                effects: langCompartment.current.reconfigure(langSupport),
              });
            });
          }
        } else {
          // ponytail: codeLanguages merges listEditorLanguages() (plantuml/graphviz builtin
          // + plugin-contributed) with @codemirror/language-data fallback, so .puml/.gv
          // files match their registered StreamLanguage instead of falling through to plain-text.
          // Lowercase to match file-type detection (detectFileType) and the
          // lowercase extensions registered in the language registry — Foo.PUML
          // should highlight the same as foo.puml.
          const langDesc = LanguageDescription.matchFilename(codeLanguages, filePath.toLowerCase());
          if (langDesc) {
            langDesc.load().then((langSupport) => {
              view.dispatch({
                effects: langCompartment.current.reconfigure(langSupport),
              });
            });
          }
        }
      }

      // Initial word count
      const words = initialContent.trim().split(/\s+/).filter(Boolean).length;
      setWordCount(words);

      return () => {
        view.destroy();
        viewRef.current = null;
        setView(null);
      };
    }, []);

    // Dynamically update tabSize when settings change
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: tabSizeCompartment.current.reconfigure([
          EditorState.tabSize.of(settingsTabSize),
          indentUnit.of(' '.repeat(settingsTabSize)),
        ]),
      });
    }, [settingsTabSize]);

    // Dynamically update markdown shortcuts when settings change
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: markdownKeymapCompartment.current.reconfigure(
          keymap.of(buildMarkdownKeymap(shortcuts, onSaveRef)),
        ),
      });
    }, [shortcuts]);

    return (
      <div
        ref={editorRef}
        className="cm-wrapper"
        style={{ fontFamily: editorFont, fontSize: `${editorFontSize}px` }}
      >
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
  },
);
