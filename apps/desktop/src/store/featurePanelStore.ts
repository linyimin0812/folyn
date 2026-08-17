/**
 * Feature panel state (the data-driven sidebar/activity-bar registry).
 *
 * Each entry (`PanelEntry`) is a sidebar panel — one of the 5 built-ins
 * (files/wiki/clips/analyze/calendar, registered in PR2) or a plugin panel
 * registered via `featureAdapter.ts`. The store is reactive so `ActivityBar`
 * and `Sidebar` re-render when plugins activate/deactivate at runtime.
 *
 * Built-in ids reserved: `files`, `wiki`, `clips`, `analyze`, `calendar`.
 * Registering an existing id is refused with a console.warn (collision guard).
 *
 * State management conventions (see .trellis/spec/desktop/frontend/state-
 * management.md): granular selectors via the named hooks below, `getState()`
 * for imperative code (the adapter, fallback effects). No persistence in PR1
 * — `activePanelId` persistence currently lives in `editorStore` and is
 * reconciled in PR2 (TODO marker below).
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ComponentType, ReactNode } from 'react';

export interface PanelEntry {
  id: string;
  title: string;
  /** Inline SVG / ThemeIcon ReactNode — resolved by the adapter at register time. */
  icon: ReactNode;
  /** The React component rendered inside `PanelErrorBoundary` when active. */
  component: ComponentType;
  /** Sort key. Built-ins: files=0, wiki=10, clips=20, analyze=30, calendar=40. */
  order: number;
  /** Optional badge shown as a small text dot. */
  badge?: string | number;
  /** False = hidden from ActivityBar + Sidebar falls back to files. */
  visible: boolean;
  /** True for the 5 built-in panels (reserved ids). */
  builtin?: boolean;
}

interface FeaturePanelState {
  panels: PanelEntry[];
  activePanelId: string | null;

  /** Register a panel. Refuses (warn + no-op) on id collision. */
  register: (entry: PanelEntry) => void;
  /** Unregister a panel by id. If it was active, caller (adapter) is responsible for fallback. */
  unregister: (id: string) => void;
  /** Set the active panel by id. Pass null to clear (no active panel). */
  setActive: (id: string | null) => void;
  /** Toggle a panel's visibility (used by appearanceStore enable-flags in PR2). */
  setVisible: (id: string, visible: boolean) => void;
  /** Update a panel's sort key. Used by registerBuiltinPanels to re-sort
   *  Wiki/Clips/Analyze by enable timestamp when their flag flips on. */
  setOrder: (id: string, order: number) => void;
}

export const useFeaturePanelStore = create<FeaturePanelState>((set, get) => ({
  panels: [],
  activePanelId: null,

  register: (entry) => {
    const exists = get().panels.some((p) => p.id === entry.id);
    if (exists) {
      console.warn(
        `[featurePanelStore] panel id "${entry.id}" already registered — refusing re-registration`,
      );
      return;
    }
    // ponytail: array index = registration sequence (register only appends,
    // unregister preserves relative order). Used as sort tie-break. No separate
    // counter field needed; upgrade to an explicit seq field if panels ever
    // reorder in place.
    set({ panels: [...get().panels, entry] });
  },

  unregister: (id) => {
    set({ panels: get().panels.filter((p) => p.id !== id) });
  },

  setActive: (id) => set({ activePanelId: id }),

  setVisible: (id, visible) =>
    set({
      panels: get().panels.map((p) => (p.id === id ? { ...p, visible } : p)),
    }),

  setOrder: (id, order) =>
    set({
      panels: get().panels.map((p) => (p.id === id ? { ...p, order } : p)),
    }),
}));

// ── Selectors ────────────────────────────────────────────────────────────────
//
// Named hook selectors per state-management.md. `useVisiblePanels` returns a
// derived array; per the spec's "Selector return values MUST be referentially
// stable" rule, a fresh `.filter().sort()` result on every render would trip
// `useSyncExternalStore`'s `Object.is` check and re-render forever. We wrap it
// in `useShallow` so a shallow-equal result (same item refs, same order)
// returns the cached array — only an actual content change re-renders.

const EMPTY_PANELS: PanelEntry[] = [];

function sortPanels(panels: PanelEntry[]): PanelEntry[] {
  // Sort by (order asc, original index asc). Index = registration sequence
  // because `register` only appends and `unregister` preserves relative order.
  return panels
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => a.p.order - b.p.order || a.idx - b.idx)
    .map((x) => x.p);
}

/** Panels sorted by (order, registration seq), filtered by `visible`. */
export function useVisiblePanels(): PanelEntry[] {
  return useFeaturePanelStore(
    useShallow((s) => {
      const visible = s.panels.filter((p) => p.visible);
      if (visible.length === 0) return EMPTY_PANELS;
      return sortPanels(visible);
    }),
  );
}

/** Currently active panel id (null until PR2 seeds the built-ins). */
export function useActivePanelId(): string | null {
  return useFeaturePanelStore((s) => s.activePanelId);
}

// PR2 reconciliation: `activePanelId` mirrors `editorStore.activePanel` (the
// persisted source of truth + the field WorkArea reads to filter tabs by
// `t.activity`). The mirror is a one-way editorStore → featurePanelStore
// subscription set up in `registerBuiltinPanels.tsx`; `setActive` stays a pure
// setter (no editorStore coupling) so this store and its PR1 tests stay
// leaf-testable. Startup validation: if editorStore.activePanel isn't a
// registered+visible panel (e.g. an uninstalled plugin's panel id),
// `registerBuiltinPanels` re-routes to 'files'.
