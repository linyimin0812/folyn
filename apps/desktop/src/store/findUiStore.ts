import { create } from 'zustand';

/**
 * In-document find-bar state (spec 5.3 + 6.2), per tab.
 *
 * The bar renders at the WorkArea level (editor and preview share it —
 * ⌘F is its only entry point), but visibility + the last query are keyed by
 * tab id: each tab keeps its own open/closed state and its own query across
 * tab switches (browser-per-tab semantics), so returning to a tab restores
 * the search the user left there. WorkArea guards rendering with its own
 * eligibility (markdown tab), so a stale `true` on a closed tab is inert.
 *
 * Not the Vault search — that is Cmd+Shift+F; this is the browser-style
 * in-page find.
 */
interface FindUiState {
  openByTab: Record<string, boolean>;
  /** Last query per tab (spec 6.2 标签页上下文 — 必要的查找状态). Restored
   *  into the input when the tab's bar re-opens; empty-string entries are
   *  pruned on close so the record doesn't grow. */
  queryByTab: Record<string, string>;
  open: (tabId: string) => void;
  close: (tabId: string) => void;
  setQuery: (tabId: string, query: string) => void;
}

function pruneQuery(queryByTab: Record<string, string>, tabId: string): Record<string, string> {
  if (!queryByTab[tabId]) return queryByTab;
  const next = { ...queryByTab };
  delete next[tabId];
  return next;
}

export const useFindUiStore = create<FindUiState>((set) => ({
  openByTab: {},
  queryByTab: {},
  open: (tabId) => set((s) => (s.openByTab[tabId] ? s : { openByTab: { ...s.openByTab, [tabId]: true } })),
  close: (tabId) => set((s) => (s.openByTab[tabId] === true
    ? { openByTab: { ...s.openByTab, [tabId]: false }, queryByTab: pruneQuery(s.queryByTab, tabId) }
    : (s.queryByTab[tabId] ? { queryByTab: pruneQuery(s.queryByTab, tabId) } : s))),
  setQuery: (tabId, query) => set((s) => {
    if (query === '') {
      // Empty queries are pruned, not stored — keeps the record sparse.
      if (!s.queryByTab[tabId]) return s;
      return { queryByTab: pruneQuery(s.queryByTab, tabId) };
    }
    return s.queryByTab[tabId] === query ? s : { queryByTab: { ...s.queryByTab, [tabId]: query } };
  }),
}));
