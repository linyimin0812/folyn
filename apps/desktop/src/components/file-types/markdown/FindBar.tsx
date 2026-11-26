/**
 * In-document find bar (refactor spec Phase 5.3 — 当前文档查找).
 *
 * Browser-style in-page find for the CURRENT document: a floating bar
 * (input + count + prev/next + results list). Matches come from the SOURCE
 * text (findInDoc) so content hidden inside inactive tab panels / closed
 * collapsibles is findable; the jump itself is delegated to the host
 * (WorkArea): preview modes reveal + scroll the preview (navigateToDocLine),
 * editor mode lands the editor cursor. Editor and preview share this one
 * bar — the old per-editor search UI is gone.
 *
 * Keyboard: Enter next · Shift+Enter prev · ↑/↓ step (live jump) · Esc
 * close (document capture, stops the global Esc handlers).
 *
 * Reading-position contract (spec: 查找不破坏当前阅读现场): opening the bar
 * never scrolls; only typing a query or stepping results jumps — exactly
 * the two moments the reader asked to move.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findInDoc, excerptParts, type DocMatch } from './findInDoc';
import { useFindUiStore } from '@/store/findUiStore';

export interface FindBarProps {
  /** Editor-absolute source of the current document. */
  content: string;
  /** Jump to a source line — routing (preview vs editor) is the host's. */
  onNavigate: (line: number) => void;
  onClose: () => void;
  /** Owning tab id (per-tab query persistence, spec 6.2). */
  tabId: string;
  /** Query restored from the tab's last session (findUiStore.queryByTab). */
  initialQuery?: string;
}

const RESULT_RENDER_LIMIT = 200;

function contextLabel(m: DocMatch): string {
  const parts = [m.heading || '文档开头', ...m.containers];
  return parts.join(' › ');
}

export function FindBar({ content, onNavigate, onClose, tabId, initialQuery }: FindBarProps) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [debounced, setDebounced] = useState(initialQuery ?? '');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const setStoredQuery = useFindUiStore((s) => s.setQuery);

  const matches = useMemo(() => findInDoc(content, debounced), [content, debounced]);

  // Esc closes the bar and wins over every other Esc handler (capture +
  // stopImmediatePropagation — same policy as FocusViewShell).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Autofocus the input on open; a restored query is preselected so typing
  // replaces it (browser behavior) while Enter re-runs the same search.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Debounce the query; recompute lands via useMemo before this effect runs.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  // Persist the query on the tab record (throttle writes to the debounce
  // cadence — every keystroke store write is fine but wasteful; the
  // debounced value is exactly what the result list will show).
  useEffect(() => {
    setStoredQuery(tabId, query);
  }, [tabId, query, setStoredQuery]);

  const jumpTo = useCallback((i: number) => {
    const m = matches[i];
    if (m) onNavigate(m.line);
  }, [matches, onNavigate]);

  // New query (or new document while open): reset to the first match and
  // jump there — find-as-you-type.
  useEffect(() => {
    setIndex(0);
    if (matches.length) jumpTo(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, content]);

  // Keep the current result scrolled into view inside the results list
  // (`scrollIntoView?.` — some hosts, jsdom included, lack it).
  useEffect(() => {
    listRef.current?.querySelector('.is-current')?.scrollIntoView?.({ block: 'nearest' });
  }, [index, matches]);

  const step = useCallback((d: number) => {
    if (!matches.length) return;
    const i = (index + d + matches.length) % matches.length;
    setIndex(i);
    jumpTo(i);
  }, [index, matches, jumpTo]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    }
  };

  const shown = matches.slice(0, RESULT_RENDER_LIMIT);

  return (
    <div className="md-find-bar" role="search">
      <div className="md-find-row">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="md-find-icon">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
        <input
          ref={inputRef}
          className="md-find-input"
          value={query}
          placeholder="查找文档内容…"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
        />
        <span className="md-find-count">
          {matches.length ? `${index + 1}/${matches.length}` : query ? '0/0' : ''}
        </span>
        <button className="md-find-btn" title="上一个 (Shift+Enter)" disabled={!matches.length} onClick={() => step(-1)}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M 3 10 L 8 5 L 13 10" />
          </svg>
        </button>
        <button className="md-find-btn" title="下一个 (Enter)" disabled={!matches.length} onClick={() => step(1)}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M 3 6 L 8 11 L 13 6" />
          </svg>
        </button>
        <button className="md-find-btn" title="关闭 (Esc)" onClick={onClose}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M 4 4 L 12 12 M 12 4 L 4 12" />
          </svg>
        </button>
      </div>

      {debounced && !matches.length && (
        <div className="md-find-empty">无匹配</div>
      )}

      {shown.length > 0 && (
        <div className="md-find-results" ref={listRef}>
          {shown.map((m, i) => {
            const [before, mid, after] = excerptParts(m);
            return (
              <button
                key={`${m.line}:${m.colStart}`}
                className={`md-find-item${i === index ? ' is-current' : ''}`}
                onClick={() => { setIndex(i); jumpTo(i); }}
              >
                <span className="md-find-ctx">
                  {contextLabel(m)} · {m.line} 行{m.inHiddenContainer ? ' · 含隐藏组件' : ''}
                </span>
                <span className="md-find-line">
                  {before.length > 42 ? `…${before.slice(-42)}` : before}
                  <mark>{mid}</mark>
                  {after.length > 90 ? `${after.slice(0, 90)}…` : after}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
