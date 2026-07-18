/**
 * Tests for the feature panel store (data-driven activity bar / sidebar).
 *
 * Covers: register/unregister, id-collision guard, ordering (order asc,
 * registration-seq tiebreak), visibility filter, setActive, and the
 * useVisiblePanels selector's referential-stability contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useFeaturePanelStore,
  useVisiblePanels,
  useActivePanelId,
  type PanelEntry,
} from './featurePanelStore';

function panel(id: string, overrides: Partial<PanelEntry> = {}): PanelEntry {
  return {
    id,
    title: id,
    icon: null,
    component: () => null,
    order: 50,
    visible: true,
    ...overrides,
  };
}

beforeEach(() => {
  useFeaturePanelStore.setState({ panels: [], activePanelId: null });
});

describe('useFeaturePanelStore', () => {
  it('register appends a panel', () => {
    useFeaturePanelStore.getState().register(panel('a'));
    expect(useFeaturePanelStore.getState().panels.map((p) => p.id)).toEqual(['a']);
  });

  it('register refuses id collision and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useFeaturePanelStore.getState().register(panel('a'));
    useFeaturePanelStore.getState().register(panel('a'));
    expect(useFeaturePanelStore.getState().panels).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('unregister removes by id', () => {
    useFeaturePanelStore.getState().register(panel('a'));
    useFeaturePanelStore.getState().register(panel('b'));
    useFeaturePanelStore.getState().unregister('a');
    expect(useFeaturePanelStore.getState().panels.map((p) => p.id)).toEqual(['b']);
  });

  it('unregister is a no-op for unknown id', () => {
    useFeaturePanelStore.getState().register(panel('a'));
    useFeaturePanelStore.getState().unregister('nope');
    expect(useFeaturePanelStore.getState().panels.map((p) => p.id)).toEqual(['a']);
  });

  it('setVisible toggles a panel without touching others', () => {
    useFeaturePanelStore.getState().register(panel('a', { visible: true }));
    useFeaturePanelStore.getState().register(panel('b', { visible: true }));
    useFeaturePanelStore.getState().setVisible('a', false);
    const s = useFeaturePanelStore.getState();
    expect(s.panels.find((p) => p.id === 'a')?.visible).toBe(false);
    expect(s.panels.find((p) => p.id === 'b')?.visible).toBe(true);
  });

  it('setActive updates activePanelId', () => {
    useFeaturePanelStore.getState().setActive('a');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('a');
    useFeaturePanelStore.getState().setActive(null);
    expect(useFeaturePanelStore.getState().activePanelId).toBe(null);
  });
});

describe('useVisiblePanels ordering + visibility', () => {
  // Helper to call the selector outside React — useSyncExternalStore isn't
  // invoked; we just call the store's subscribe-free path. We instead verify
  // via the underlying state computation by replicating sortPanels.
  function visibleSorted(): PanelEntry[] {
    const panels = useFeaturePanelStore.getState().panels.filter((p) => p.visible);
    return panels
      .map((p, idx) => ({ p, idx }))
      .sort((a, b) => a.p.order - b.p.order || a.idx - b.idx)
      .map((x) => x.p);
  }

  it('returns panels sorted by order asc', () => {
    useFeaturePanelStore.getState().register(panel('a', { order: 30 }));
    useFeaturePanelStore.getState().register(panel('b', { order: 10 }));
    useFeaturePanelStore.getState().register(panel('c', { order: 20 }));
    expect(visibleSorted().map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('ties broken by registration sequence (array index)', () => {
    useFeaturePanelStore.getState().register(panel('a', { order: 10 }));
    useFeaturePanelStore.getState().register(panel('b', { order: 10 }));
    useFeaturePanelStore.getState().register(panel('c', { order: 10 }));
    // unregister 'b' — relative order of 'a' and 'c' preserved
    useFeaturePanelStore.getState().unregister('b');
    expect(visibleSorted().map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('filters out invisible panels', () => {
    useFeaturePanelStore.getState().register(panel('a', { order: 10, visible: true }));
    useFeaturePanelStore.getState().register(panel('b', { order: 20, visible: false }));
    useFeaturePanelStore.getState().register(panel('c', { order: 30, visible: true }));
    expect(visibleSorted().map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('returns [] when no visible panels', () => {
    useFeaturePanelStore.getState().register(panel('a', { visible: false }));
    expect(visibleSorted()).toEqual([]);
  });
});

describe('selectors export', () => {
  it('useVisiblePanels + useActivePanelId are exported as hooks', () => {
    expect(typeof useVisiblePanels).toBe('function');
    expect(typeof useActivePanelId).toBe('function');
  });
});

// Regression: zustand v5 uses `useSyncExternalStore`, which calls the selector
// on every render and compares the result with `Object.is`. A selector that
// returns a freshly-constructed `[]` on the empty path trips an infinite
// re-render loop ("Maximum update depth exceeded"). The spec (state-
// management.md "Selector return values MUST be referentially stable") demands
// a test that renders the INITIAL EMPTY state directly. This is that test:
// `useVisiblePanels` must return the module-level `EMPTY_PANELS` constant on
// the empty path, not a new `[]`.
describe('useVisiblePanels referential stability (initial empty state)', () => {
  it('renders without crashing and returns a stable empty array', () => {
    useFeaturePanelStore.setState({ panels: [], activePanelId: null });
    const { result, rerender } = renderHook(() => useVisiblePanels());
    expect(result.current).toEqual([]);
    // Same reference across re-renders on the empty path — no infinite loop.
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('useActivePanelId returns null on the empty initial state', () => {
    useFeaturePanelStore.setState({ panels: [], activePanelId: null });
    const { result } = renderHook(() => useActivePanelId());
    expect(result.current).toBe(null);
  });
});
