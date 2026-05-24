import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
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
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, selectAll } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
  LanguageDescription,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap, linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  slashCommandExtension,
  slashMenuField,
  type SlashMenuState,
} from './extensions/SlashCommandPlugin';
import {
  codeBlockExtension,
  codeBlockMenuField,
  type CodeBlockMenuState,
} from './extensions/CodeBlockExtension';
import { orderedListExtension } from './extensions/OrderedListPlugin';
import { inlineDiffExtension, dispatchDiffs } from './extensions/InlineDiffExtension';
import { json as jsonLanguage } from '@codemirror/lang-json';
import type { FileChange } from '@quill/cli-adapter';
import type { ShortcutItem } from '@/store/settingsStore';

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
  setDiffs: (changes: FileChange[]) => void;
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
}

export const QuillEditor = forwardRef<QuillEditorHandle, QuillEditorProps>(
  function QuillEditor({ initialContent = '', filePath = '', initialCursorLine, initialCursorCol, onChange, onSlashMenuChange, onCodeBlockMenuChange, onSave, onImagePaste }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const tabSizeCompartment = useRef(new Compartment());
    const markdownKeymapCompartment = useRef(new Compartment());
    const langCompartment = useRef(new Compartment());
    const setCursorPosition = useEditorStore((s) => s.setCursorPosition);
    const setWordCount = useEditorStore((s) => s.setWordCount);
    const editorFont = useSettingsStore((s) => s.editorFont);
    const editorFontSize = useSettingsStore((s) => s.editorFontSize);
    const showLineNumbers = useSettingsStore((s) => s.showLineNumbers);
    const settingsTabSize = useSettingsStore((s) => s.tabSize);
    const shortcuts = useSettingsStore((s) => s.shortcuts);
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
      setDiffs: (changes: FileChange[]) => {
        const view = viewRef.current;
        if (!view) return;
        dispatchDiffs(view, changes);
      },
    }));

    const handleUpdate = useCallback(
      (update: any) => {
        try {
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
          // Notify parent about slash menu state changes
          const menuState = update.state.field(slashMenuField);
          onSlashMenuChangeRef.current?.(menuState);
          // Notify parent about code block menu state changes
          const cbMenuState = update.state.field(codeBlockMenuField);
          onCodeBlockMenuChangeRef.current?.(cbMenuState);
        } catch {
          // Ignore errors during rapid edits (e.g. coordsAtPos with invalid position)
        }
      },
      [setCursorPosition, setWordCount],
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
        tabSizeCompartment.current.of([
          EditorState.tabSize.of(settingsTabSize),
          indentUnit.of(' '.repeat(settingsTabSize)),
        ]),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        indentationMarkers(),
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
        ...inlineDiffExtension,
      ];

      // Markdown-specific extensions
      const markdownExtensions = isMarkdown ? [
        markdownKeymapCompartment.current.of(
          keymap.of(buildMarkdownKeymap(shortcuts, onSaveRef)),
        ),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        ...slashCommandExtension,
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
        if (isJson) {
          // JSON files: use dedicated language support + lint
          view.dispatch({
            effects: langCompartment.current.reconfigure([
              jsonLanguage(),
              lintGutter(),
              linter(jsonLintSource, { delay: 300 }),
            ]),
          });
        } else {
          const langDesc = LanguageDescription.matchFilename(languages, filePath);
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
      />
    );
  },
);
