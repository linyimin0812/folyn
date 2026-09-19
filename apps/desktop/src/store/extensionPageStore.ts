/**
 * Extension page state — the data-driven full-page registry.
 *
 * Each entry (`PageEntry`) is an extension-contributed page registered via
 * `pageAdapter.tsx` (trusted-tier `contributes.pages[]`). The nav id is
 * `ext:<extensionId>.<pageId>` (navStore `currentPage`), rendered as an
 * ActivityBar page-nav button + a full-page component in App.tsx (same
 * composition as the built-in translation page).
 *
 * Active-page state is NOT here — navStore `currentPage` owns it. This store
 * is only the registry (register/unregister), so it stays leaf-testable.
 *
 * State management conventions (see .trellis/spec/desktop/frontend/state-
 * management.md): granular selectors via the named hooks below, `getState()`
 * for imperative code (the adapter). No persistence — currentPage is not
 * persisted either, so a stale id degrades to the null render in
 * `ExtensionPageView`.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ComponentType, ReactNode } from 'react';

export interface PageEntry {
  /** Nav id: `ext:<extensionId>.<pageId>` (the navStore currentPage value). */
  id: string;
  title: string;
  /** Inline SVG / ThemeIcon ReactNode — resolved by the adapter at register time. */
  icon: ReactNode;
  /** The page component, already wrapped in `withExtensionBoundary`. */
  component: ComponentType;
  /** Sort key among extension page-nav buttons. */
  order: number;
}

interface ExtensionPageState {
  pages: PageEntry[];

  /** Register a page. Refuses (warn + no-op) on id collision. */
  register: (entry: PageEntry) => void;
  /** Unregister a page by id. If it was the current page, the adapter falls back to 'editor'. */
  unregister: (id: string) => void;
}

export const useExtensionPageStore = create<ExtensionPageState>((set, get) => ({
  pages: [],

  register: (entry) => {
    const exists = get().pages.some((p) => p.id === entry.id);
    if (exists) {
      console.warn(
        `[extensionPageStore] page id "${entry.id}" already registered — refusing re-registration`,
      );
      return;
    }
    // ponytail: array index = registration sequence (register only appends,
    // unregister preserves relative order). Used as sort tie-break.
    set({ pages: [...get().pages, entry] });
  },

  unregister: (id) => {
    set({ pages: get().pages.filter((p) => p.id !== id) });
  },
}));

// ── Selectors ────────────────────────────────────────────────────────────────

const EMPTY_PAGES: PageEntry[] = [];

/** Pages sorted by (order asc, registration seq asc). */
export function useVisiblePages(): PageEntry[] {
  return useExtensionPageStore(
    useShallow((s) => {
      if (s.pages.length === 0) return EMPTY_PAGES;
      return s.pages
        .map((p, idx) => ({ p, idx }))
        .sort((a, b) => a.p.order - b.p.order || a.idx - b.idx)
        .map((x) => x.p);
    }),
  );
}
