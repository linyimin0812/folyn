import { useEffect, useRef, useCallback } from 'react';
import { useSearchStore, type SearchResult } from '@/store/searchStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import * as editorIoService from '@/services/editorIoService';
import { useTranslation } from 'react-i18next';

export function GlobalSearchPanel() {
  const { t } = useTranslation();
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
    editorIoService.openFile(result.filePath, result.fileName).then(() => {
      setTimeout(() => {
        useEditorViewStateStore.getState().setCursorPosition(result.lineNumber, 1);
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
    <div className="gs-overlay fixed inset-0 z-[950] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-20 animate-[fadeIn_.12s]" onClick={() => useSearchStore.getState().closePanel()}>
      <div className="gs-panel w-[600px] max-w-[92vw] max-h-[500px] bg-panel border border-brd rounded-xl shadow-[0_16px_48px_rgba(0,0,0,.2)] flex flex-col overflow-hidden animate-[slideUp_.15s_ease]" onClick={(e) => e.stopPropagation()}>
        {/* Search input row */}
        <div className="flex items-center gap-1.5 py-3 px-3.5 border-b border-brd shrink-0">
          <div className="flex-1 relative flex items-center">
            <svg className="absolute left-2.5 text-t3 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              className="w-full py-2 pr-2.5 pl-8 rounded-md border border-brd bg-inp text-t1 text-[13px] font-ui outline-none transition-[border-color] duration-150 focus:border-acc placeholder:text-t3"
              type="text"
              placeholder={t('search:placeholder')}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
            />
          </div>
          <button
            className={`py-[5px] px-2 rounded-[5px] text-xs font-semibold border cursor-pointer transition-all duration-100 font-mono shrink-0 ${caseSensitive ? 'bg-accdim border-acc text-acc' : 'text-t3 bg-transparent border-brd hover:bg-hov hover:text-t2'}`}
            onClick={() => useSearchStore.getState().toggleCaseSensitive()}
            title={t('search:caseSensitive')}
          >
            Aa
          </button>
          <button
            className={`py-[5px] px-2 rounded-[5px] text-xs font-semibold border cursor-pointer transition-all duration-100 font-mono shrink-0 ${useRegex ? 'bg-accdim border-acc text-acc' : 'text-t3 bg-transparent border-brd hover:bg-hov hover:text-t2'}`}
            onClick={() => useSearchStore.getState().toggleUseRegex()}
            title={t('search:useRegex')}
          >
            .*
          </button>
        </div>

        {/* Results area */}
        <div className="gs-results flex-1 overflow-y-auto py-2 scrollbar-thin">
          {isSearching && (
            <div className="py-6 px-4 text-center text-t3 text-[13px]">{t('search:searching')}</div>
          )}
          {!isSearching && query.trim() && results.length === 0 && (
            <div className="py-6 px-4 text-center text-t3 text-[13px]">{t('search:noResults')}</div>
          )}
          {!isSearching && !query.trim() && (
            <div className="py-6 px-4 text-center text-t3 text-[13px]">{t('search:typeToSearch')}</div>
          )}
          {!isSearching && results.length > 0 && (
            <div className="flex flex-col">
              {Object.entries(grouped).map(([filePath, fileResults]) => (
                <div key={filePath} className="py-1">
                  <div className="gs-file-name py-1.5 px-3.5 text-xs font-semibold text-t1 font-mono sticky top-0 bg-panel z-[1]">{fileResults[0].fileName}</div>
                  {fileResults.map((result, idx) => (
                    <div
                      key={`${filePath}:${result.lineNumber}:${idx}`}
                      className="flex items-baseline gap-2 py-1 pr-3.5 pl-6 cursor-pointer transition-[background] duration-100 text-xs leading-normal hover:bg-hov"
                      onClick={() => handleResultClick(result)}
                    >
                      <span className="gs-line-num shrink-0 min-w-[28px] text-right text-t3 font-mono text-[11px]">{result.lineNumber}</span>
                      <span className="gs-line-content flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-t2 font-mono text-xs">
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
      <mark className="bg-yellow-400/40 text-inherit rounded-sm px-px">{match}</mark>
      {contextAfter}
    </>
  );
}
