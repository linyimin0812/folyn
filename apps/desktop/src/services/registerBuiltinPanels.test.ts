/**
 * Tests for the built-in panel registration + visibility/active sync.
 *
 * Covers the contract that `registerBuiltinPanels` fulfills:
 * - 3 built-in panels registered with correct id + order.
 * - editorStore.activePanel → featurePanelStore.activePanelId mirror.
 * - Persisted-invalid-id fallback (active points at an unregistered panel →
 *   re-route to 'files').
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerBuiltinPanels } from './registerBuiltinPanels';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { useEditorStore } from '@/store/editorStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { storageClient } from '@/utils/storageClient';

function resetStores() {
  useFeaturePanelStore.setState({ panels: [], activePanelId: null });
  useEditorStore.setState({ activePanel: 'files', activeTabId: null, tabs: [] });
  // Explicit flag reset — setState({}) merges nothing, so a flag flipped in a
  // test would leak into the next one.
  useAppearanceStore.setState({
    enableActivityPanel: true,
    enableTranslationPanel: true,
    enableSessionsPanel: true,
    enableKnowledgePanel: true,
  });
  // Cancel any persist debounce scheduled by setEnableSessionsPanel.
  storageClient.__resetForTesting();
}

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  resetStores();
});

describe('registerBuiltinPanels: built-in registration', () => {
  it('registers exactly the 3 built-in panels', () => {
    const dispose = registerBuiltinPanels();
    const ids = useFeaturePanelStore.getState().panels.map((p) => p.id);
    expect(ids).toEqual(['files', 'knowledge', 'sessions']);
    dispose();
  });

  it('assigns the spec-mandated order values', () => {
    const dispose = registerBuiltinPanels();
    const byId = Object.fromEntries(
      useFeaturePanelStore.getState().panels.map((p) => [p.id, p.order]),
    );
    expect(byId).toEqual({
      files: 0,
      knowledge: 10,
      sessions: 20,
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
    expect(useFeaturePanelStore.getState().panels).toHaveLength(3);
    dispose2();
    // The second dispose is a no-op — panels still present until dispose1.
    expect(useFeaturePanelStore.getState().panels).toHaveLength(3);
    dispose1();
  });
});

describe('registerBuiltinPanels: sessions enable-flag wiring', () => {
  it('registers sessions hidden when the flag is off at register time', () => {
    useAppearanceStore.setState({ enableSessionsPanel: false });
    const dispose = registerBuiltinPanels();
    const sessions = useFeaturePanelStore.getState().panels.find((p) => p.id === 'sessions');
    expect(sessions?.visible).toBe(false);
    dispose();
  });

  it('toggling the flag off hides the panel and re-routes an active sessions panel to files', () => {
    const dispose = registerBuiltinPanels();
    useEditorStore.getState().setActivePanel('sessions');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('sessions');

    useAppearanceStore.getState().setEnableSessionsPanel(false);
    const sessions = useFeaturePanelStore.getState().panels.find((p) => p.id === 'sessions');
    expect(sessions?.visible).toBe(false);
    expect(useEditorStore.getState().activePanel).toBe('files');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    dispose();
  });

  it('toggling the flag back on restores visibility', () => {
    const dispose = registerBuiltinPanels();
    useAppearanceStore.getState().setEnableSessionsPanel(false);
    useAppearanceStore.getState().setEnableSessionsPanel(true);
    const sessions = useFeaturePanelStore.getState().panels.find((p) => p.id === 'sessions');
    expect(sessions?.visible).toBe(true);
    dispose();
  });

  it('hiding sessions while another panel is active does not change the active panel', () => {
    const dispose = registerBuiltinPanels();
    useEditorStore.getState().setActivePanel('files');
    useAppearanceStore.getState().setEnableSessionsPanel(false);
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    dispose();
  });

  it('hydrate (persisted flag off) hides the panel after registration', () => {
    const dispose = registerBuiltinPanels();
    useAppearanceStore.getState().hydrate({ enableSessionsPanel: false });
    const sessions = useFeaturePanelStore.getState().panels.find((p) => p.id === 'sessions');
    expect(sessions?.visible).toBe(false);
    dispose();
  });
});

describe('registerBuiltinPanels: knowledge enable-flag wiring', () => {
  it('registers knowledge hidden when the flag is off at register time', () => {
    useAppearanceStore.setState({ enableKnowledgePanel: false });
    const dispose = registerBuiltinPanels();
    const knowledge = useFeaturePanelStore.getState().panels.find((p) => p.id === 'knowledge');
    expect(knowledge?.visible).toBe(false);
    dispose();
  });

  it('toggling the flag off hides the panel and re-routes an active knowledge panel to files', () => {
    const dispose = registerBuiltinPanels();
    useEditorStore.getState().setActivePanel('knowledge');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('knowledge');

    useAppearanceStore.getState().setEnableKnowledgePanel(false);
    const knowledge = useFeaturePanelStore.getState().panels.find((p) => p.id === 'knowledge');
    expect(knowledge?.visible).toBe(false);
    expect(useEditorStore.getState().activePanel).toBe('files');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    dispose();
  });

  it('toggling the flag back on restores visibility', () => {
    const dispose = registerBuiltinPanels();
    useAppearanceStore.getState().setEnableKnowledgePanel(false);
    useAppearanceStore.getState().setEnableKnowledgePanel(true);
    const knowledge = useFeaturePanelStore.getState().panels.find((p) => p.id === 'knowledge');
    expect(knowledge?.visible).toBe(true);
    dispose();
  });

  it('hiding knowledge while another panel is active does not change the active panel', () => {
    const dispose = registerBuiltinPanels();
    useEditorStore.getState().setActivePanel('files');
    useAppearanceStore.getState().setEnableKnowledgePanel(false);
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    dispose();
  });

  it('hydrate (persisted flag off) hides the panel after registration', () => {
    const dispose = registerBuiltinPanels();
    useAppearanceStore.getState().hydrate({ enableKnowledgePanel: false });
    const knowledge = useFeaturePanelStore.getState().panels.find((p) => p.id === 'knowledge');
    expect(knowledge?.visible).toBe(false);
    dispose();
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
