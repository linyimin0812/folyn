/**
 * EditorSearchBar — VS Code-style search/replace panel for CodeMirror 6
 * editors. Mounts as a sibling of the editor; reads/writes the CM search
 * query via `getSearchQuery`/`setSearchQuery` and triggers built-in
 * `findNext`/`findPrevious`/`replaceNext`/`replaceAll` commands.
 *
 * Visibility + replace-row state is owned by the parent (which also wires
 * the Cmd+F / Cmd+Alt+F keymap to toggle). The parent bumps `viewTick` on
 * doc/selection changes so the count + current index recompute.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from '@codemirror/search';

interface EditorSearchBarProps {
  view: EditorView | null;
  visible: boolean;
  replaceOpen: boolean;
  viewTick: number;
  onClose: () => void;
  onToggleReplace: () => void;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchRegex(q: SearchQuery): RegExp | null {
  if (!q.search || !q.valid) return null;
  let pattern: string;
  if (q.regexp) {
    pattern = q.search;
  } else {
    pattern = escapeRegex(q.search);
    if (q.wholeWord) pattern = `\\b${pattern}\\b`;
  }
  const flags = q.caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function countMatches(view: EditorView, q: SearchQuery): { count: number; currentIdx: number } {
  const re = buildSearchRegex(q);
  if (!re) return { count: 0, currentIdx: 0 };
  const text = view.state.doc.toString();
  const sel = view.state.selection.main.head;
  let n = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const from = m.index;
    const to = m.index + m[0].length;
    if (from <= sel && sel < to) idx = n;
    n++;
    if (m[0].length === 0) re.lastIndex++;
  }
  return { count: n, currentIdx: n === 0 ? 0 : idx };
}

export function EditorSearchBar({
  view,
  visible,
  replaceOpen,
  viewTick,
  onClose,
  onToggleReplace,
}: EditorSearchBarProps) {
  const [queryText, setQueryText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [count, setCount] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Pull initial state from CM when panel opens.
  useEffect(() => {
    if (!view || !visible) return;
    const q = getSearchQuery(view.state);
    setQueryText(q.search);
    setReplaceText(q.replace);
    setCaseSensitive(q.caseSensitive);
    setRegexp(q.regexp);
    setWholeWord(q.wholeWord);
    requestAnimationFrame(() => findInputRef.current?.focus());
  }, [view, visible]);

  const dispatchQuery = useCallback(
    (patch: { search?: string; replace?: string; caseSensitive?: boolean; regexp?: boolean; wholeWord?: boolean }) => {
      if (!view) return;
      const cur = getSearchQuery(view.state);
      const next = new SearchQuery({
        search: patch.search ?? cur.search,
        replace: patch.replace ?? cur.replace,
        caseSensitive: patch.caseSensitive ?? cur.caseSensitive,
        regexp: patch.regexp ?? cur.regexp,
        wholeWord: patch.wholeWord ?? cur.wholeWord,
        literal: false,
      });
      view.dispatch({ effects: setSearchQuery.of(next) });
    },
    [view],
  );

  // Recount matches + locate current whenever query/options/view/tick change.
  useEffect(() => {
    if (!view || !queryText) {
      setCount(0);
      setCurrentIdx(0);
      return;
    }
    let q: SearchQuery;
    try {
      q = new SearchQuery({
        search: queryText,
        caseSensitive,
        regexp,
        wholeWord,
        literal: false,
      });
    } catch {
      setCount(0);
      setCurrentIdx(0);
      return;
    }
    const { count, currentIdx } = countMatches(view, q);
    setCount(count);
    setCurrentIdx(currentIdx);
  }, [view, queryText, caseSensitive, regexp, wholeWord, viewTick]);

  if (!visible || !view) return null;

  const onFindKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? findPrevious(view) : findNext(view);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
  const onReplaceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? replaceAll(view) : replaceNext(view);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="ed-search-panel" role="dialog" aria-label="Find and replace">
      <button
        className="ed-search-toggle-replace"
        onClick={onToggleReplace}
        title={replaceOpen ? 'Hide replace' : 'Show replace'}
        aria-expanded={replaceOpen}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          {replaceOpen
            ? <path d="M4 6l4 4 4-4" />
            : <path d="M4 10l4-4 4 4" />}
        </svg>
      </button>
      <div className="ed-search-rows">
        <div className="ed-search-row">
          <input
            ref={findInputRef}
            className="ed-search-input"
            value={queryText}
            placeholder="Find"
            spellCheck={false}
            onChange={(e) => {
              setQueryText(e.target.value);
              dispatchQuery({ search: e.target.value });
            }}
            onKeyDown={onFindKeyDown}
          />
          <div className="ed-search-toggles">
            <button
              className={`ed-search-toggle${caseSensitive ? ' active' : ''}`}
              onClick={() => { const v = !caseSensitive; setCaseSensitive(v); dispatchQuery({ caseSensitive: v }); }}
              title="Match case"
            >Aa</button>
            <button
              className={`ed-search-toggle${wholeWord ? ' active' : ''}`}
              onClick={() => { const v = !wholeWord; setWholeWord(v); dispatchQuery({ wholeWord: v }); }}
              title="Whole word"
            >ab</button>
            <button
              className={`ed-search-toggle${regexp ? ' active' : ''}`}
              onClick={() => { const v = !regexp; setRegexp(v); dispatchQuery({ regexp: v }); }}
              title="Regular expression"
            >.*</button>
          </div>
          <span className="ed-search-count">
            {count === 0 ? '0 results' : `${currentIdx + 1} of ${count}`}
          </span>
          <div className="ed-search-nav">
            <button onClick={() => findPrevious(view)} title="Previous (Shift-Cmd-G)" disabled={count === 0}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M13 10L8 5 3 10" />
              </svg>
            </button>
            <button onClick={() => findNext(view)} title="Next (Cmd-G)" disabled={count === 0}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M3 6L8 11 13 6" />
              </svg>
            </button>
            <button className="ed-search-close" onClick={onClose} title="Close (Esc)">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>
        {replaceOpen && (
          <div className="ed-search-row">
            <input
              className="ed-search-input"
              value={replaceText}
              placeholder="Replace"
              spellCheck={false}
              onChange={(e) => {
                setReplaceText(e.target.value);
                dispatchQuery({ replace: e.target.value });
              }}
              onKeyDown={onReplaceKeyDown}
            />
            <div className="ed-search-nav">
              <button onClick={() => replaceNext(view)} title="Replace next" disabled={count === 0}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M2 8h7M7 4l3 4-3 4M12 5v6" />
                </svg>
              </button>
              <button onClick={() => replaceAll(view)} title="Replace all" disabled={count === 0}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M2 5h6M5 2l3 3-3 3M2 11h6M5 8l3 3-3 3" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
