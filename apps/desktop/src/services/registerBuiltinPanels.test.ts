/**
 * Tests for the PR2 built-in panel registration + visibility/active sync.
 *
 * Covers the contract that `registerBuiltinPanels` fulfills:
 * - 1 built-in panel registered with correct id + order.
 * - editorStore.activePanel → featurePanelStore.activePanelId mirror.
 * - Persisted-invalid-id fallback (active points at an unregistered panel →
 *   re-route to 'files').
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerBuiltinPanels } from './registerBuiltinPanels';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { useEditorStore } from '@/store/editorStore';
import { useAppearanceStore } from '@/store/appearanceStore';

function resetStores() {
  useFeaturePanelStore.setState({ panels: [], activePanelId: null });
  useEditorStore.setState({ activePanel: 'files', activeTabId: null, tabs: [] });
  useAppearanceStore.setState({});
}

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  resetStores();
});

describe('registerBuiltinPanels: built-in registration', () => {
  it('registers exactly the 1 built-in panel', () => {
    const dispose = registerBuiltinPanels();
    const ids = useFeaturePanelStore.getState().panels.map((p) => p.id);
    expect(ids).toEqual(['files']);
    dispose();
  });

  it('assigns the spec-mandated order value (0)', () => {
    const dispose = registerBuiltinPanels();
    const byId = Object.fromEntries(
      useFeaturePanelStore.getState().panels.map((p) => [p.id, p.order]),
    );
    expect(byId).toEqual({
      files: 0,
    });
    dispose();
  });

  it('marks the panel as builtin', () => {
    const dispose = registerBuiltinPanels();
    const allBuiltin = useFeaturePanelStore
      .getState()
      .panels.filter((p) => p.id === 'files')
      .every((p) => p.builtin === true);
    expect(allBuiltin).toBe(true);
    dispose();
  });

  it('files is always visible', () => {
    const dispose = registerBuiltinPanels();
    const visible = Object.fromEntries(
      useFeaturePanelStore.getState().panels.map((p) => [p.id, p.visible]),
    );
    expect(visible.files).toBe(true);
    dispose();
  });

  it('is idempotent — a second call is a no-op (wired guard)', () => {
    const dispose1 = registerBuiltinPanels();
    const dispose2 = registerBuiltinPanels(); // no-op, returns disposer that does nothing
    expect(useFeaturePanelStore.getState().panels).toHaveLength(1);
    dispose2();
    // The second dispose is a no-op — panels still present until dispose1.
    expect(useFeaturePanelStore.getState().panels).toHaveLength(1);
    dispose1();
  });
});

describe('registerBuiltinPanels: active-panel mirror + persisted-invalid fallback', () => {
  it('mirrors editorStore.activePanel → featurePanelStore.activePanelId', () => {
    const dispose = registerBuiltinPanels();
    useEditorStore.getState().setActivePanel('files');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    dispose();
  });

  it('persisted-invalid id (uninstalled extension panel) falls back to files', () => {
    // Simulate a persisted active panel id that no longer exists (e.g. a
    // extension panel from an uninstalled extension). Register with that id
    // already set as editorStore.activePanel — the initial sync should
    // re-route to 'files'.
    useEditorStore.setState({ activePanel: 'oldextension.panel' });
    const dispose = registerBuiltinPanels();
    expect(useEditorStore.getState().activePanel).toBe('files');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    dispose();
  });

  it('initial sync picks up editorStore.activePanel when it is a registered visible panel', () => {
    useEditorStore.setState({ activePanel: 'files' });
    const dispose = registerBuiltinPanels();
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    dispose();
  });
});
