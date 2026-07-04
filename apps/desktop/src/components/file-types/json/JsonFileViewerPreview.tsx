/**
 * JsonFileViewerPreview — main preview component for the JSON file viewer.
 *
 * Layout:
 *   ┌─────────────────── PreviewToolbar ────────────────────┐
 *   │ Input | Query | Convert | Diff | format ▾ | expand… │ toggles │
 *   ├──────────────────────────────┬─────────────────────────┤
 *   │                              │  Tab-dependent content:  │
 *   │  <Json5CodeMirror> (PR7)     │  - Input → JsonTree      │
 *   │                              │  - Query → QueryBar+Tree │
 *   │                              │  - Convert → ConvertPanel│
 *   │                              │  - Diff → DiffPane       │
 *   └──────────────────────────────┴─────────────────────────┘
 *
 * Owns state per PR3 spec: parsedValue, inputMode, activeTab, autoSort,
 * autoCopy, parseError, search. Local-only — no Zustand store (per PRD
 * technical notes).
 *
 * Pipeline:
 *   content prop → inputContent state (editor value)
 *      → debounced 300ms → parseInput(text, mode)
 *      → if autoSort, sortKeysDeep → parsedValue
 *      → parseError on failure (last valid parsedValue retained)
 *
 * Clipboard: clicking a key path / value in the tree calls `handleCopy`,
 * which dynamically imports `@tauri-apps/plugin-clipboard-manager`'s
 * `writeText` and shows a transient toast.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { PreviewProps } from '../types';
import { parseInput, type InputMode } from './lib/parseInput';
import { sortKeysDeep } from './lib/sortKeysDeep';
import { runQuery, type QueryLang } from './lib/query';
import { JsonTree } from './components/JsonTree';
import { PreviewToolbar, type PreviewTab } from './components/PreviewToolbar';
import { QueryBar } from './components/QueryBar';
import { ConvertPanel } from './components/ConvertPanel';
import { DiffPane } from './components/DiffPane';
import { Json5CodeMirror } from './editor/Json5CodeMirror';

const PARSE_DEBOUNCE_MS = 300;
const TOAST_DURATION_MS = 1500;
const QUERY_DEBOUNCE_MS = 200;

export function JsonFileViewerPreview({ content, filePath }: PreviewProps) {
  const [inputContent, setInputContent] = useState(content ?? '');
  const [parsedValue, setParsedValue] = useState<unknown>(null);
  const [parsedValueVersion, setParsedValueVersion] = useState(0);
  const [inputMode, setInputMode] = useState<InputMode>('auto');
  const [activeTab, setActiveTab] = useState<PreviewTab>('input');
  const [autoSort, setAutoSort] = useState(false);
  const [autoCopy, setAutoCopy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandAllKey, setExpandAllKey] = useState(0);
  const [collapseAllKey, setCollapseAllKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [hasParsed, setHasParsed] = useState(false);

  // Query tab state (PR4)
  const [queryLang] = useState<QueryLang>('jq');
  const [queryResult, setQueryResult] = useState<unknown>(null);
  const [queryResultVersion, setQueryResultVersion] = useState(0);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const queryAbortRef = useRef<AbortController | null>(null);

  // Diff tab state (PR6)
  const [diffInput, setDiffInput] = useState('');
  const [diffValue, setDiffValue] = useState<unknown>(null);
  const [sortBeforeDiff, setSortBeforeDiff] = useState(false);

  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  // parse: runs parseInput (async due to dynamic-import of heavy parsers),
  // applies auto-sort if enabled, updates parsedValue / parseError.
  const parse = useCallback(
    async (text: string, mode: InputMode, sort: boolean) => {
      if (text.length === 0) {
        setParsedValue(null);
        setParseError(null);
        setHasParsed(true);
        return;
      }
      try {
        const value = await parseInput(text, mode);
        const finalValue = sort ? sortKeysDeep(value) : value;
        setParsedValue(finalValue);
        setParsedValueVersion((v) => v + 1);
        setParseError(null);
        setHasParsed(true);
        // PR8: auto-copy on parse (only when auto-copy is on AND content
        // is non-empty). Skip copying null/primitive results is fine —
        // copying a stringified value is still useful.
        if (autoCopy) {
          try {
            const mod = await import('@tauri-apps/plugin-clipboard-manager');
            await mod.writeText(JSON.stringify(finalValue, null, 2));
            showToast('已自动复制解析结果');
          } catch {
            /* clipboard unavailable — silent */
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setParseError(msg);
        setHasParsed(true);
      }
    },
    [autoCopy, showToast],
  );

  // Initial parse on mount using the file's `content` prop in auto mode.
  useEffect(() => {
    setInputContent(content ?? '');
    void parse(content ?? '', 'auto', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External content change → reset input + re-parse.
  useEffect(() => {
    setInputContent(content ?? '');
    void parse(content ?? '', 'auto', autoSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Debounced re-parse on input/mode/sort change.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void parse(inputContent, inputMode, autoSort);
    }, PARSE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [inputContent, inputMode, autoSort, parse]);

  // Cleanup toast timer + in-flight query on unmount.
  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
      }
      if (queryAbortRef.current) {
        queryAbortRef.current.abort();
      }
    };
  }, []);

  const handleCopyPath = useCallback(
    async (path: string) => {
      try {
        const mod = await import('@tauri-apps/plugin-clipboard-manager');
        await mod.writeText(path);
        showToast(`已复制路径: ${path}`);
      } catch {
        showToast('复制失败');
      }
    },
    [showToast],
  );

  const handleCopyValue = useCallback(
    async (value: string) => {
      try {
        const mod = await import('@tauri-apps/plugin-clipboard-manager');
        await mod.writeText(value);
        const preview = value.length > 40 ? `${value.slice(0, 40)}…` : value;
        showToast(`已复制: ${preview}`);
      } catch {
        showToast('复制失败');
      }
    },
    [showToast],
  );

  // PR8: auto-copy helper for query/convert outputs.
  const autoCopyIfEnabled = useCallback(
    async (text: string, label: string) => {
      if (!autoCopy) return;
      try {
        const mod = await import('@tauri-apps/plugin-clipboard-manager');
        await mod.writeText(text);
        showToast(`已自动复制${label}`);
      } catch {
        /* silent */
      }
    },
    [autoCopy, showToast],
  );

  // PR4: query runner — debounced + abortable.
  const handleQueryRun = useCallback(
    (lang: QueryLang, expr: string) => {
      // Abort any in-flight query.
      if (queryAbortRef.current) {
        queryAbortRef.current.abort();
      }
      const controller = new AbortController();
      queryAbortRef.current = controller;

      // Debounce so rapid keystrokes don't fire multiple jq/wasm loads.
      window.setTimeout(() => {
        if (controller.signal.aborted) return;
        setQueryLoading(true);
        setQueryError(null);
        runQuery(lang, parsedValue, expr)
          .then((result) => {
            if (controller.signal.aborted) return;
            setQueryResult(result);
            setQueryResultVersion((v) => v + 1);
            setQueryLoading(false);
            // PR8: auto-copy query result.
            const resultStr = result === null ? 'null' : JSON.stringify(result, null, 2);
            void autoCopyIfEnabled(resultStr, '查询结果');
          })
          .catch((err: unknown) => {
            if (controller.signal.aborted) return;
            const msg = err instanceof Error ? err.message : String(err);
            setQueryError(msg);
            setQueryResult(null);
            setQueryLoading(false);
          });
      }, QUERY_DEBOUNCE_MS);
    },
    [parsedValue, autoCopyIfEnabled],
  );

  const handleQueryResult = useCallback((value: unknown) => {
    setQueryResult(value);
    setQueryResultVersion((v) => v + 1);
  }, []);

  const handleQueryError = useCallback((message: string) => {
    setQueryError(message);
    setQueryResult(null);
  }, []);

  // PR5: convert output handler — auto-copy if enabled.
  const handleConvertOutput = useCallback(
    (text: string, mime?: string) => {
      void autoCopyIfEnabled(text, mime ? '转换结果' : '转换结果');
    },
    [autoCopyIfEnabled],
  );

  // PR6: diff input handlers.
  const handleDiffInputChange = useCallback((text: string) => {
    setDiffInput(text);
  }, []);

  const handleDiffValueChange = useCallback((value: unknown) => {
    setDiffValue(value);
  }, []);

  // Persist queryLang across re-renders for QueryBar's default.
  const queryBarKey = `${queryLang}-${parsedValueVersion}`;

  const name = filePath.split('/').pop() || 'data.json';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-panel text-t1">
      <PreviewToolbar
        activeTab={activeTab}
        inputMode={inputMode}
        autoSort={autoSort}
        autoCopy={autoCopy}
        onTabChange={setActiveTab}
        onInputModeChange={setInputMode}
        onToggleAutoSort={() => setAutoSort((v) => !v)}
        onToggleAutoCopy={() => setAutoCopy((v) => !v)}
        onExpandAll={() => setExpandAllKey((k) => k + 1)}
        onCollapseAll={() => setCollapseAllKey((k) => k + 1)}
        // PR4-6: enable all tabs.
        enableAllTabs
        // PR6: sort-before-diff toggle is rendered inside DiffPane; toolbar
        // doesn't need a slot for it.
      />

      {parseError !== null && (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-[12px] text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300">
          <span className="font-medium">解析失败: </span>
          <span className="break-all font-mono">{parseError}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2">
        {/* Left: CodeMirror JSON5 editor (PR7). */}
        <div className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-brd bg-surf px-2 py-0.5 text-[11px] text-t3">
            <span className="truncate">{name}</span>
            <span>{inputContent.length} chars</span>
          </div>
          <Json5CodeMirror
            key={`editor-${filePath}`}
            value={inputContent}
            onChange={setInputContent}
          />
        </div>

        {/* Right: tab-dependent content. */}
        <div className="flex min-h-0 flex-col">
          {activeTab === 'input' ? (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-brd bg-surf px-2 py-0.5">
                <span className="text-[11px] text-t3">搜索</span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="键或值…"
                  className="min-w-0 flex-1 rounded border border-brd bg-panel px-1.5 py-0.5 text-[11px] text-t1 outline-none focus:border-acc"
                />
              </div>
              <div className="min-h-0 flex-1">
                {hasParsed && parsedValue === null && parseError === null ? (
                  <div className="px-3 py-2 text-[12px] text-t3 italic">无内容</div>
                ) : (
                  <JsonTree
                    key={parsedValueVersion}
                    value={parsedValue}
                    search={search}
                    expandAllKey={expandAllKey}
                    collapseAllKey={collapseAllKey}
                    onCopyPath={handleCopyPath}
                    onCopyValue={handleCopyValue}
                  />
                )}
              </div>
            </>
          ) : activeTab === 'query' ? (
            <>
              <QueryBar
                key={queryBarKey}
                value={parsedValue}
                loading={queryLoading}
                error={queryError}
                defaultLang={queryLang}
                onRun={handleQueryRun}
                onResult={handleQueryResult}
                onError={handleQueryError}
              />
              <div className="min-h-0 flex-1">
                <JsonTree
                  key={queryResultVersion}
                  value={queryResult}
                  expandAllKey={expandAllKey}
                  collapseAllKey={collapseAllKey}
                  onCopyPath={handleCopyPath}
                  onCopyValue={handleCopyValue}
                />
              </div>
            </>
          ) : activeTab === 'convert' ? (
            <ConvertPanel
              value={parsedValue}
              onOutput={handleConvertOutput}
              onCopyValue={handleCopyValue}
            />
          ) : (
            <DiffPane
              left={parsedValue}
              rightInput={diffInput}
              right={diffValue}
              sortBoth={sortBeforeDiff}
              onRightInputChange={handleDiffInputChange}
              onRightValueChange={handleDiffValueChange}
              onToggleSortBoth={() => setSortBeforeDiff((v) => !v)}
              onCopyValue={handleCopyValue}
            />
          )}
        </div>
      </div>

      {/* Toast */}
      {toast !== null && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-surf2 border border-brd px-3 py-1.5 text-[12px] text-t1 shadow-md">
          {toast}
        </div>
      )}
    </div>
  );
}
