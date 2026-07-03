/**
 * QueryBar — toolbar for the JSON viewer's Query tab.
 *
 * Layout:
 *   [jq | JSONPath]  [expr input...]  [Run]
 *   <error line>
 *
 * Calls `onResult(value)` when a query succeeds. The parent renders the
 * result in a `JsonTree`. Errors are surfaced both via `onError` (so the
 * parent can clear the tree) and via a red error line under the input.
 *
 * The Run button and Enter key both fire `onRun`. The parent debounces /
 * aborts stale queries via an AbortController passed through `onRun`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryLang } from '../lib/query';

export interface QueryBarProps {
  value: unknown;
  onRun: (lang: QueryLang, expr: string) => void;
  onResult: (value: unknown) => void;
  onError: (message: string) => void;
  loading: boolean;
  error: string | null;
  defaultLang?: QueryLang;
  defaultExpr?: string;
}

export function QueryBar({
  value,
  onRun,
  onResult,
  onError,
  loading,
  error,
  defaultLang = 'jq',
  defaultExpr = '',
}: QueryBarProps) {
  const [lang, setLang] = useState<QueryLang>(defaultLang);
  const [expr, setExpr] = useState(defaultExpr);
  const lastRunRef = useRef<{ lang: QueryLang; expr: string } | null>(null);

  // Keep latest `value` in a ref so the run handler always sees the newest
  // parsed input without re-binding on every parse.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const handleRun = useCallback(() => {
    const trimmed = expr.trim();
    if (trimmed.length === 0) {
      onError('请输入查询表达式');
      onResult(null);
      return;
    }
    lastRunRef.current = { lang, expr: trimmed };
    onRun(lang, trimmed);
  }, [expr, lang, onRun, onResult, onError]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRun();
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-px border-b border-brd bg-surf">
      <div className="flex items-center gap-2 px-2 py-1">
        {/* Language toggle (segmented control) */}
        <div className="flex items-center rounded border border-brd bg-panel">
          <LangButton
            label="jq"
            active={lang === 'jq'}
            onClick={() => setLang('jq')}
          />
          <LangButton
            label="JSONPath"
            active={lang === 'jsonpath'}
            onClick={() => setLang('jsonpath')}
          />
        </div>

        <input
          type="text"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          placeholder={lang === 'jq' ? '例如 .users[].name' : '例如 $.users[*].name'}
          className="min-w-0 flex-1 rounded border border-brd bg-panel px-2 py-0.5 font-mono text-[12px] text-t1 outline-none focus:border-acc"
        />
        <button
          type="button"
          onClick={handleRun}
          disabled={loading}
          className={`shrink-0 rounded border px-3 py-0.5 text-[11px] font-medium ${
            loading
              ? 'border-brd bg-surf text-t3 opacity-60'
              : 'border-acc/40 bg-accdim text-acc hover:bg-acc hover:text-white'
          }`}
        >
          {loading ? '运行中…' : '运行'}
        </button>
      </div>
      {error !== null && (
        <div className="px-2 py-0.5 text-[11px] text-rose-700 dark:text-rose-300">
          <span className="font-medium">错误: </span>
          <span className="break-all font-mono">{error}</span>
        </div>
      )}
    </div>
  );
}

function LangButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const cls = active
    ? 'bg-accdim text-acc'
    : 'bg-panel text-t3 hover:bg-hov hover:text-t1';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </button>
  );
}
