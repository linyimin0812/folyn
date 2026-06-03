import { useEffect, useRef, useCallback } from 'react';
import { useSearchStore, type SearchResult } from '@/store/searchStore';
import { useEditorStore } from '@/store/editorStore';

export function GlobalSearchPanel() {
  const isOpen = useSearchStore((s) => s.isOpen);
  const query = useSearchStore((s) => s.query);
  const caseSensitive = useSearchStore((s) => s.caseSensitive);
  const useRegex = useSearchStore((s) => s.useRegex);
  const results = useSearchStore((s) => s.results);
  const isSearching = useSearchStore((s) => s.isSearching);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Handle escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        useSearchStore.getState().closePanel();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  // Debounced search
  const handleQueryChange = useCallback((value: string) => {
    useSearchStore.getState().setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      useSearchStore.getState().performSearch();
    }, 300);
  }, []);

  // Re-run search when toggles change
  useEffect(() => {
    if (isOpen && query.trim()) {
      useSearchStore.getState().performSearch();
    }
  }, [caseSensitive, useRegex, isOpen, query]);

  const handleResultClick = useCallback((result: SearchResult) => {
    useSearchStore.getState().closePanel();
    const { openFile } = useEditorStore.getState();
    openFile(result.filePath, result.fileName).then(() => {
      setTimeout(() => {
        useEditorStore.getState().setCursorPosition(result.lineNumber, 1);
      }, 100);
    });
  }, []);

  if (!isOpen) return null;

  // Group results by file
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.filePath]) acc[r.filePath] = [];
    acc[r.filePath].push(r);
    return acc;
  }, {});

  return (
    <div className="gs-overlay" onClick={() => useSearchStore.getState().closePanel()}>
      <div className="gs-panel" onClick={(e) => e.stopPropagation()}>
        {/* Search input row */}
        <div className="gs-input-row">
          <div className="gs-input-wrap">
            <svg className="gs-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              className="gs-input"
              type="text"
              placeholder="Search in vault..."
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
            />
          </div>
          <button
            className={`gs-toggle ${caseSensitive ? 'active' : ''}`}
            onClick={() => useSearchStore.getState().toggleCaseSensitive()}
            title="Case Sensitive"
          >
            Aa
          </button>
          <button
            className={`gs-toggle ${useRegex ? 'active' : ''}`}
            onClick={() => useSearchStore.getState().toggleUseRegex()}
            title="Use Regex"
          >
            .*
          </button>
        </div>

        {/* Results area */}
        <div className="gs-results">
          {isSearching && (
            <div className="gs-status">Searching...</div>
          )}
          {!isSearching && query.trim() && results.length === 0 && (
            <div className="gs-status">No results found</div>
          )}
          {!isSearching && !query.trim() && (
            <div className="gs-status">Type to search across all files</div>
          )}
          {!isSearching && results.length > 0 && (
            <div className="gs-result-list">
              {Object.entries(grouped).map(([filePath, fileResults]) => (
                <div key={filePath} className="gs-file-group">
                  <div className="gs-file-name">{fileResults[0].fileName}</div>
                  {fileResults.map((result, idx) => (
                    <div
                      key={`${filePath}:${result.lineNumber}:${idx}`}
                      className="gs-result-item"
                      onClick={() => handleResultClick(result)}
                    >
                      <span className="gs-line-num">{result.lineNumber}</span>
                      <span className="gs-line-content">
                        <HighlightedLine
                          line={result.lineContent}
                          matchStart={result.matchStart}
                          matchEnd={result.matchEnd}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Renders a line with the matched portion highlighted */
function HighlightedLine({ line, matchStart, matchEnd }: { line: string; matchStart: number; matchEnd: number }) {
  const before = line.slice(0, matchStart);
  const match = line.slice(matchStart, matchEnd);
  const after = line.slice(matchEnd);

  // Trim context to keep it readable
  const contextBefore = before.length > 40 ? '...' + before.slice(-40) : before;
  const contextAfter = after.length > 60 ? after.slice(0, 60) + '...' : after;

  return (
    <>
      {contextBefore}
      <mark>{match}</mark>
      {contextAfter}
    </>
  );
}
