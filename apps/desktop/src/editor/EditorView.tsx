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
  syntaxTree,
} from '@codemirror/language';
import { folynHighlighting } from './highlightStyle';
import { registerBuiltinCodeContributions } from '@/services/registerBuiltinCodeContributions';
import { listEditorLanguages } from '@/services/extension-host/editorLanguageAdapter';
import { extractImgSrcFromHtml } from '@/services/clipboardFiles';
import { detectMarkdownTable, markdownTableToMarkdown, detectTsvTable, tsvTableToMarkdown, detectCsvTable, csvTableToMarkdown } from '@folyn/extension-rich-text/src/markdownTable';
import { TableConvertDialog, type TableConvertChoice } from '@/components/editor/TableConvertDialog';
import { useEditorPrefsStore } from '@/store/editorPrefsStore';
import { debounce } from '@/utils/debounce';
registerBuiltinCodeContributions();

// ponytail: build markdown codeLanguages at module load. Reads the editorLanguageRegistry
// (mermaid builtin + any extension-registered languages loaded before this module) and falls
// ponytail: lezer-markdown block node names — the blocks remark stamps with
// data-source-line. The deepest one containing the cursor is the anchor the
// preview's cursor-sync targets; nodes outside the set walk up, Document →
// no anchor (blank line / non-markdown) → offset 0.
const MD_BLOCK_NODES = new Set([
  'Paragraph', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4',
  'ATXHeading5', 'ATXHeading6', 'SetextHeading1', 'SetextHeading2',
  'FencedCode', 'CodeBlock', 'BulletList', 'OrderedList', 'ListItem',
  'Blockquote', 'HTMLBlock', 'HorizontalRule', 'Table', 'LinkReference',
]);

// back to @codemirror/language-data. Open editors do NOT live-migrate on later extension load —
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
import { useEditorStore } from '@/store/editorStore';
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
import { createMarkdownImageCompletion } from './extensions/MarkdownImageExtension';
import { orderedListExtension } from './extensions/OrderedListExtension';
import { inlineDiffExtension } from './extensions/InlineDiffExtension';
import { mathExtension } from './extensions/MarkdownMathExtension';
import { listEnterExtension } from './extensions/ListEnterExtension';
import { listTabExtension } from './extensions/ListTabExtension';
import { escExitExtension } from './extensions/EscExitExtension';
import { headingFoldExtension } from './extensions/headingFoldExtension';
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

/** Convert display key symbols (⌘, Ctrl, ⌥, Alt, Win, Shift) to CodeMirror key format (Mod-s, Ctrl-b, …) */
function shortcutToCmKey(keys: string[]): string {
  const modMap: Record<string, string> = {
    '⌘': 'Mod',   // macOS Command → platform primary (Cmd on mac, Ctrl elsewhere)
    Ctrl: 'Ctrl', // explicit Control key on both platforms
    '⌥': 'Alt',   // macOS Option
    Alt: 'Alt',   // Windows/Linux Alt
    Win: 'Meta',  // Windows logo key → CodeMirror Meta
    Shift: 'Shift',
  };
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

export interface FolynEditorHandle {
  getView: () => EditorView | null;
  getScrollDOM: () => HTMLElement | null;
  replaceContent: (content: string) => void;
}

interface FolynEditorProps {
  initialContent?: string;
  filePath?: string;
  /** Initial cursor line (1-based) to restore on mount */
  initialCursorLine?: number;
  /** Initial cursor column (1-based) to restore on mount */
  initialCursorCol?: number;
  /** Initial editor scroll top (px) to restore on mount — preserves the
   *  exact viewport across tab switches + restart, not just cursorLine's
   *  scrollIntoView center. */
  initialScrollTop?: number;
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

export const FolynEditor = forwardRef<FolynEditorHandle, FolynEditorProps>(
  function FolynEditor({ initialContent = '', filePath = '', initialCursorLine, initialCursorCol, initialScrollTop, onChange, onSlashMenuChange, onCodeBlockMenuChange, onSave, onImagePaste, readOnly }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [view, setView] = useState<EditorView | null>(null);
    const sp = useSearchPanelState();
    const tabSizeCompartment = useRef(new Compartment());
    const markdownKeymapCompartment = useRef(new Compartment());
    const langCompartment = useRef(new Compartment());
    const setCursorPosition = useEditorViewStateStore((s) => s.setCursorPosition);
    const setWordCount = useEditorViewStateStore((s) => s.setWordCount);
    const setCursorViewportY = useEditorViewStateStore((s) => s.setCursorViewportY);
    const setHasSelection = useEditorViewStateStore((s) => s.setHasSelection);
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
    // ponytail: swapRef guards handleUpdate during an in-place doc swap
    //  (view.setState on tab switch). setState fires an update with
    //  docChanged=true → without the guard, onChangeRef would fire and mark
    //  the just-switched-to tab dirty. Cleared on the tick after setState +
    //  cursor/scroll restore.
    const swapRef = useRef(false);
    // ponytail: tab-switch effect runs once on mount; mount effect already
    //  built the view, so skip the first [filePath] run to avoid a redundant
    //  setState.
    const firstRunRef = useRef(true);
    // ponytail: throttle scrollTop persistence onto the active tab — scroll
    //  fires every frame; persisting per-frame would storm the store + disk.
    //  Trailing 200ms debounce coalesces a scroll burst into one write.
    //  Captures the activeTabId at SCHEDULE time (not flush time) so a tab
    //  switch between schedule and flush writes to the tab the user was
    //  scrolling, not the new active one (the race that lost scroll position
    //  on tab return).
    const setEditorScrollTopForTab = useEditorViewStateStore((s) => s.setEditorScrollTopForTab);
    const persistScrollTopRef = useRef<((top: number, tabId: string) => void) | null>(null);
    if (persistScrollTopRef.current === null) {
      persistScrollTopRef.current = debounce((top: number, tabId: string) => setEditorScrollTopForTab(tabId, top), 200);
    }
    // ponytail: smart paste → table convert dialog. When a table is detected
    // on paste and the user hasn't suppressed the prompt, show a confirmation
    // modal before converting. The pending insert is held in a ref so the
    // async dialog resolution can replay it into the CodeMirror view.
    const tablePasteMode = useEditorPrefsStore((s) => s.tablePasteMode);
    const setTablePasteMode = useEditorPrefsStore((s) => s.setTablePasteMode);
    const [tableConvert, setTableConvert] = useState<{ visible: boolean; summary: string; insertText: string; rawText: string }>({
      visible: false,
      summary: '',
      insertText: '',
      rawText: '',
    });
    // ponytail: keep a ref of the latest paste mode so the paste handler
    // (created once during setup) reads the current preference instead of a
    // stale closure value. Mirrors the onChangeRef/onImagePasteRef pattern.
    const tablePasteModeRef = useRef(tablePasteMode);
    tablePasteModeRef.current = tablePasteMode;
    // ponytail: insert text at the current cursor — used by the dialog
    // resolve path to replay a held table paste once the user confirms.
    const insertTextAtCursor = (text: string) => {
      const view = viewRef.current;
      if (!view) return;
      const pos = view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, to: pos, insert: text },
        selection: { anchor: pos + text.length },
      });
    };
    // ponytail: resolve the convert dialog — convert or paste-as-text, and
    // persist the choice when "remember" is checked. preventDefault was
    // already called in the paste handler, so both paths replay text here.
    const resolveTableConvert = (choice: TableConvertChoice) => {
      insertTextAtCursor(choice.convert ? tableConvert.insertText : tableConvert.rawText);
      if (choice.remember) {
        setTablePasteMode(choice.convert ? 'convert' : 'text');
      }
      setTableConvert({ visible: false, summary: '', insertText: '', rawText: '' });
    };

    useImperativeHandle(ref, () => ({
      getView: () => viewRef.current,
      getScrollDOM: () => viewRef.current?.scrollDOM ?? null,
      replaceContent: (content: string) => {
        const view = viewRef.current;
        if (!view) return;
        const currentContent = view.state.doc.toString();
        if (currentContent === content) return;
        // ponytail: surgical diff instead of full-doc replace. A full-doc
        // replace (from:0, to:len) invalidates CodeMirror's viewport
        // measurements and resets scroll to top on drag-resize writeback
        // (which goes through setContentExternal → externalContentVersion
        // bump → this method). Computing the common prefix/suffix and
        // dispatching only the changed middle range preserves scroll,
        // cursor, and viewport state for free.
        const oldLen = currentContent.length;
        const newLen = content.length;
        let prefix = 0;
        const maxPrefix = Math.min(oldLen, newLen);
        while (prefix < maxPrefix && currentContent[prefix] === content[prefix]) prefix++;
        let suffix = 0;
        const maxSuffix = Math.min(oldLen - prefix, newLen - prefix);
        while (suffix < maxSuffix && currentContent[oldLen - 1 - suffix] === content[newLen - 1 - suffix]) suffix++;
        view.dispatch({
          changes: { from: prefix, to: oldLen - suffix, insert: content.slice(prefix, newLen - suffix) },
        });
      },
    }));

    const handleUpdate = useCallback(
      (update: any) => {
        try {
          // ponytail: an in-place doc swap (view.setState on tab switch)
          //  fires this listener with docChanged/selectionSet/viewportChanged
          //  all true. Skip it entirely: onChange would mark the new tab
          //  dirty (its content just landed), cursor/scroll writeback would
          //  clobber the values we're about to restore. swapRef is cleared on
          //  the tick after setState + restore.
          if (swapRef.current) return;
          if (update.docChanged || update.selectionSet) {
            sp.setViewTick((t) => (t + 1) % 1_000_000);
          }
          if (update.viewportChanged) {
            // ponytail: persist the editor scroll top so switching files +
            //  restart restore the exact viewport (cursorLine alone only
            //  scrollIntoView's to the cursor). Throttled by persistScrollTopRef.
            //  Capture activeTabId HERE (schedule time) — the trailing debounce
            //  flushes up to 200ms later; by then a tab switch may have changed
            //  activeTabId, so writing to the flushed-time active tab would
            //  divert this scroll onto the wrong tab and leave the scrolled
            //  tab's editorScrollTop stale (wrong viewport on return).
            const sd = update.view.scrollDOM;
            const tabId = useEditorStore.getState().activeTabId;
            if (sd && tabId) persistScrollTopRef.current?.(sd.scrollTop, tabId);
          }
          if (update.docChanged) {
            const content = update.state.doc.toString();
            onChangeRef.current?.(content);
            const words = content.trim().split(/\s+/).filter(Boolean).length;
            setWordCount(words);
          }
          if (update.selectionSet) {
            const sel = update.state.selection.main;
            // Skip cursor-sync entirely when the user has an active
            // selection (drag select, multi-line select) — the sync is
            // for single-cursor navigation only; selection moves cause
            // rapid preview jitter. Cursor position (status bar) still
            // updates so the user sees where they are.
            const pos = sel.head;
            const line = update.state.doc.lineAt(pos);
            setCursorPosition(line.number, pos - line.from + 1);
            setHasSelection(sel.from !== sel.to);
            if (sel.from === sel.to) {
              const v = update.view;
              const sd = v.scrollDOM;
              if (sd) {
                const coords = v.coordsAtPos(pos);
                if (coords) {
                  const r = sd.getBoundingClientRect();
                  // ponytail: lineFrac = the cursor's vertical position
                  // within its SOURCE line's soft-wrapped block (0 at the
                  // first visual line, 1 at the last). A long single-line
                  // paragraph soft-wraps in the editor into N visual lines;
                  // as the cursor moves down the wraps, its screen Y drops,
                  // but the preview renders one block — top-aligning it
                  // (blockLineSpan=1) left the preview stuck at the block top
                  // while the cursor drifted down, one visual line per wrap
                  // (the reported soft-wrap drift). lineFrac maps the
                  // cursor's wrap position onto the preview block height so
                  // the preview tracks it. Unwrapped lines: the cursor stays
                  // on the only visual line → lineFrac≈0 → top-align (no
                  // horizontal drift either, since left/right movement on a
                  // single visual line never changes coords.top).
                  let lineFrac = 0;
                  const startCoords = v.coordsAtPos(line.from);
                  const endCoords = v.coordsAtPos(line.to);
                  if (startCoords && endCoords) {
                    const span = endCoords.bottom - startCoords.top;
                    if (span > 0) {
                      lineFrac = Math.min(1, Math.max(0, (coords.top - startCoords.top) / span));
                    }
                  }
                  // ponytail: the cursor's measured Y offset below the top
                  // of the FIRST line of its containing markdown BLOCK (the
                  // same block the preview's cursor-sync targets). Measured,
                  // so it includes the soft-wrap rows of every earlier line
                  // (line arithmetic missed those and drifted the preview
                  // down one line per wrap). Anchored via the syntax tree's
                  // block node, NOT a blank-line run scan: a paragraph
                  // directly after a code fence / list / blockquote (no
                  // blank line) shares a run with the taller block above,
                  // and the run scan misattributed that whole block's
                  // editor height to the paragraph's offset — the preview
                  // pinned the paragraph far ABOVE the cursor (the reported
                  // 从代码块移到段落预览偏上). Resolve TWICE: a pos at a
                  // block EDGE falls between nodes — side -1 anchors the
                  // block ENDING there (cursor at a line END, e.g. the
                  // paragraph's last line — the common typing position;
                  // +1 alone resolved Document there → offset 0 → the
                  // block dropped to the cursor: the reported 非首行
                  // 整体往下偏移，行尾对不齐、行中又对齐), and falls back
                  // to +1 when -1 lands on Document (pos at a block's
                  // FIRST char, e.g. after Home). Mid-line pos resolves
                  // inside the block with either side.
                  let blockOffsetY = 0;
                  // any: SyntaxNode isn't exported by this @codemirror/language version;
                  // the loop's null guard keeps the walk safe.
                  let blockNode: any = syntaxTree(v.state).resolveInner(pos, -1);
                  if (blockNode && blockNode.name === 'Document') {
                    blockNode = syntaxTree(v.state).resolveInner(pos, 1);
                  }
                  while (blockNode && blockNode.name !== 'Document' && !MD_BLOCK_NODES.has(blockNode.name)) {
                    blockNode = blockNode.parent;
                  }
                  if (blockNode && blockNode.name !== 'Document') {
                    const blockLine = v.state.doc.lineAt(blockNode.from);
                    if (blockLine.number < line.number) {
                      const blockTop = v.coordsAtPos(blockLine.from);
                      if (blockTop) blockOffsetY = Math.max(0, coords.top - blockTop.top);
                    }
                  }
                  setCursorViewportY(coords.top - r.top, r.top, pos - line.from, coords.bottom - coords.top, lineFrac, blockOffsetY);
                }
              }
            }
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
      [setCursorPosition, setCursorViewportY, setHasSelection, setWordCount, sp.setViewTick],
    );

    // Build a fresh EditorState for the given doc + file path. Shared by
    // the mount effect (initial create) and the tab-switch effect (in-place
    // setState on filePath change). Extensions close over current refs so a
    // tab switch picks up the latest handleUpdate / shortcuts / prefs.
    const buildState = useCallback((doc: string, path: string): EditorState => {
      const isMarkdown = !path || /\.(md|markdown|mdx|markmap)$/i.test(path);
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
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
        tabSizeCompartment.current.of([
          EditorState.tabSize.of(settingsTabSize),
          indentUnit.of(' '.repeat(settingsTabSize)),
        ]),
        indentOnInput(),
        folynHighlighting(),
        bracketMatching(),
        EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', "'", '"', '$'] } }]),
        closeBrackets(),
        autocompletion({
          override: [createFilePreviewSrcCompletion(path), createMarkdownImageCompletion(path)],
          closeOnBlur: false,
          interactionDelay: 0,
        }),
        filePreviewSrcSearchBox(),
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
      const markdownExtensions = isMarkdown ? [
        markdownKeymapCompartment.current.of(
          keymap.of(buildMarkdownKeymap(shortcuts, onSaveRef)),
        ),
        markdown({ base: markdownLanguage, codeLanguages }),
        ...codeBlockExtension,
        ...orderedListExtension,
        ...listEnterExtension,
        ...listTabExtension,
        ...escExitExtension,
        ...headingFoldExtension,
        ...mathExtension,
        EditorView.lineWrapping,
        EditorView.inputHandler.of((view, from, to, text) => {
          if (text !== '`' || from === to) return false;
          const sel = view.state.sliceDoc(from, to);
          view.dispatch({
            changes: { from, to, insert: `\`${sel}\`` },
            selection: { anchor: from + 1, head: from + 1 + sel.length },
          });
          return true;
        }),
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
            const html = event.clipboardData?.getData('text/html');
            const imgSrc = html ? extractImgSrcFromHtml(html) : null;
            if (imgSrc) {
              event.preventDefault();
              const view = viewRef.current;
              if (view) {
                const pos = view.state.selection.main.head;
                const md = `![](${imgSrc})`;
                view.dispatch({
                  changes: { from: pos, to: pos, insert: md },
                  selection: { anchor: pos + md.length },
                });
              }
              return true;
            }
            const plain = event.clipboardData?.getData('text/plain') ?? '';
            if (plain) {
              const mdTable = detectMarkdownTable(plain);
              if (mdTable.matched && mdTable.table) {
                event.preventDefault();
                const view = viewRef.current;
                if (view) {
                  const pos = view.state.selection.main.head;
                  const md = markdownTableToMarkdown(mdTable.table);
                  view.dispatch({
                    changes: { from: pos, to: pos, insert: md },
                    selection: { anchor: pos + md.length },
                  });
                }
                return true;
              }
              const tsv = detectTsvTable(plain);
              if (tsv) {
                const insertMd = tsvTableToMarkdown(tsv);
                const summary = `${tsv.header.length} columns × ${tsv.rows.length + 1} rows`;
                const mode = tablePasteModeRef.current;
                if (mode === 'text') {
                  return false;
                }
                if (mode === 'convert') {
                  event.preventDefault();
                  const view = viewRef.current;
                  if (view) {
                    const pos = view.state.selection.main.head;
                    view.dispatch({
                      changes: { from: pos, to: pos, insert: insertMd },
                      selection: { anchor: pos + insertMd.length },
                    });
                  }
                  return true;
                }
                event.preventDefault();
                setTableConvert({ visible: true, summary, insertText: insertMd, rawText: plain });
                return true;
              }
              const csv = detectCsvTable(plain);
              if (csv) {
                const insertMd = csvTableToMarkdown(csv);
                const summary = `${csv.header.length} columns × ${csv.rows.length + 1} rows`;
                const mode = tablePasteModeRef.current;
                if (mode === 'text') {
                  return false;
                }
                if (mode === 'convert') {
                  event.preventDefault();
                  const view = viewRef.current;
                  if (view) {
                    const pos = view.state.selection.main.head;
                    view.dispatch({
                      changes: { from: pos, to: pos, insert: insertMd },
                      selection: { anchor: pos + insertMd.length },
                    });
                  }
                  return true;
                }
                event.preventDefault();
                setTableConvert({ visible: true, summary, insertText: insertMd, rawText: plain });
                return true;
              }
            }
            return false;
          },
        }),
      ] : [];
      return EditorState.create({
        doc,
        extensions: [...commonExtensions, ...markdownExtensions],
      });
    }, [
      editorFontSize, editorFont, showLineNumbers, readOnly, settingsTabSize,
      sp.toggleRef, sp.toggleReplaceRef, handleUpdate, shortcuts, onSaveRef,
    ]);

    // Reconfigure the language compartment for a (non-markdown) file path.
    // Shared by the mount effect and the tab-switch effect.
    const loadLanguage = useCallback((view: EditorView, path: string) => {
      const isMarkdown = !path || /\.(md|markdown|mdx|markmap)$/i.test(path);
      if (isMarkdown || !path) return;
      const isJson = /\.json$/i.test(path);
      const isDbml = /\.dbml$/i.test(path);
      if (isJson) {
        view.dispatch({
          effects: langCompartment.current.reconfigure([
            jsonLanguage(),
            lintGutter(),
            linter(jsonLintSource, { delay: 300 }),
          ]),
        });
      } else if (isDbml) {
        const sqlDesc = languages.find((l) => l.name === 'SQL');
        if (sqlDesc) {
          sqlDesc.load().then((langSupport) => {
            view.dispatch({ effects: langCompartment.current.reconfigure(langSupport) });
          });
        }
      } else {
        const langDesc = LanguageDescription.matchFilename(codeLanguages, path.toLowerCase());
        if (langDesc) {
          langDesc.load().then((langSupport) => {
            view.dispatch({ effects: langCompartment.current.reconfigure(langSupport) });
          });
        }
      }
    }, []);

    // Restore cursor + scroll onto a freshly-set view state. Shared by the
    // mount effect and the tab-switch effect.
    const restoreCursorScroll = useCallback((view: EditorView) => {
      const hasSavedScroll = typeof initialScrollTop === 'number' && initialScrollTop >= 0;
      if (initialCursorLine && initialCursorLine > 0) {
        const lineCount = view.state.doc.lines;
        const targetLine = Math.min(initialCursorLine, lineCount);
        const lineInfo = view.state.doc.line(targetLine);
        const col = Math.min((initialCursorCol ?? 1) - 1, lineInfo.length);
        const cursorPos = lineInfo.from + col;
        view.dispatch({
          selection: { anchor: cursorPos },
          ...(hasSavedScroll ? {} : { scrollIntoView: true }),
        });
      }
      if (hasSavedScroll) {
        const target = initialScrollTop as number;
        const sd = view.scrollDOM;
        const apply = () => { if (sd) sd.scrollTop = target; };
        requestAnimationFrame(() => {
          apply();
          requestAnimationFrame(apply);
        });
      }
    }, [initialCursorLine, initialCursorCol, initialScrollTop]);

    useEffect(() => {
      if (!editorRef.current) return;

      const view = new EditorView({
        state: buildState(initialContent, filePath),
        parent: editorRef.current,
      });

      viewRef.current = view;
      setView(view);

      restoreCursorScroll(view);
      loadLanguage(view, filePath);

      // Initial word count
      const words = initialContent.trim().split(/\s+/).filter(Boolean).length;
      setWordCount(words);

      return () => {
        view.destroy();
        viewRef.current = null;
        setView(null);
      };
    }, []);

    // ponytail: tab switch = in-place doc swap, no view destroy/create.
    //  Dependency is [filePath] only — NOT initialContent: a user edit
    //  changes content but not path, and must NOT trigger a setState (that
    //  would destroy the current edit). filePath changes iff the active tab
    //  changed; that render's initialContent is the new tab's content.
    //  swapRef silences the updateListener setState fires (docChanged→
    //  onChange would mark the new tab dirty). First run skipped: the mount
    //  effect above already built the view.
    useEffect(() => {
      if (firstRunRef.current) { firstRunRef.current = false; return; }
      const view = viewRef.current;
      if (!view) return;
      swapRef.current = true;
      view.setState(buildState(initialContent, filePath));
      restoreCursorScroll(view);
      loadLanguage(view, filePath);
      const words = initialContent.trim().split(/\s+/).filter(Boolean).length;
      setWordCount(words);
      // Clear swap on the next tick so the setState + restore dispatches
      // (which fire updateListener synchronously) are all silenced.
      queueMicrotask(() => { swapRef.current = false; });
    }, [filePath]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <TableConvertDialog
          visible={tableConvert.visible}
          summary={tableConvert.summary}
          onResolve={resolveTableConvert}
        />
      </div>
    );
  },
);
