/**
 * Tests for the PR2 built-in panel registration + visibility/active sync.
 *
 * Covers the contract that `registerBuiltinPanels` fulfills:
 * - 5 built-in panels registered with correct ids + order.
 * - Visibility bound to appearanceStore enable flags at registration time.
 * - appearanceStore flag toggle → setVisible + active-panel-fallback.
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
  useAppearanceStore.setState({
    enableWikiPanel: true,
    enableClipsPanel: true,
    enableAnalyzePanel: true,
    enableDailyPanel: true,
  });
}

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  resetStores();
});

describe('registerBuiltinPanels: built-in registration', () => {
  it('registers exactly the 5 built-in panels', () => {
    const dispose = registerBuiltinPanels();
    const ids = useFeaturePanelStore.getState().panels.map((p) => p.id);
    expect(ids).toEqual(['files', 'wiki', 'clips', 'analyze', 'calendar']);
    dispose();
  });

  it('assigns the spec-mandated order values (0/10/20/30/40)', () => {
    const dispose = registerBuiltinPanels();
    const byId = Object.fromEntries(
      useFeaturePanelStore.getState().panels.map((p) => [p.id, p.order]),
    );
    expect(byId).toEqual({
      files: 0,
      wiki: 10,
      clips: 20,
      analyze: 30,
      calendar: 40,
    });
    dispose();
  });

  it('marks all 5 as builtin', () => {
    const dispose = registerBuiltinPanels();
    const allBuiltin = useFeaturePanelStore
      .getState()
      .panels.filter((p) => p.id === 'files' || p.id === 'wiki' || p.id === 'clips' || p.id === 'analyze' || p.id === 'calendar')
      .every((p) => p.builtin === true);
    expect(allBuiltin).toBe(true);
    dispose();
  });

  it('files is always visible; others bind to appearance flags at registration', () => {
    useAppearanceStore.setState({
      enableWikiPanel: false,
      enableClipsPanel: true,
      enableAnalyzePanel: false,
      enableDailyPanel: true,
    });
    const dispose = registerBuiltinPanels();
    const visible = Object.fromEntries(
      useFeaturePanelStore.getState().panels.map((p) => [p.id, p.visible]),
    );
    expect(visible.files).toBe(true);
    expect(visible.wiki).toBe(false);
    expect(visible.clips).toBe(true);
    expect(visible.analyze).toBe(false);
    expect(visible.calendar).toBe(true);
    dispose();
  });

  it('is idempotent — a second call is a no-op (wired guard)', () => {
    const dispose1 = registerBuiltinPanels();
    const dispose2 = registerBuiltinPanels(); // no-op, returns disposer that does nothing
    expect(useFeaturePanelStore.getState().panels).toHaveLength(5);
    dispose2();
    // The second dispose is a no-op — panels still present until dispose1.
    expect(useFeaturePanelStore.getState().panels).toHaveLength(5);
    dispose1();
  });
});

describe('registerBuiltinPanels: appearance flag → visibility sync', () => {
  it('toggling enableWikiPanel to false hides wiki in the store', () => {
    const dispose = registerBuiltinPanels();
    useAppearanceStore.setState({ enableWikiPanel: false });
    const wiki = useFeaturePanelStore.getState().panels.find((p) => p.id === 'wiki');
    expect(wiki?.visible).toBe(false);
    dispose();
  });

  it('toggling enableClipsPanel to true shows clips', () => {
    useAppearanceStore.setState({ enableClipsPanel: false });
    const dispose = registerBuiltinPanels();
    expect(
      useFeaturePanelStore.getState().panels.find((p) => p.id === 'clips')?.visible,
    ).toBe(false);
    useAppearanceStore.setState({ enableClipsPanel: true });
    expect(
      useFeaturePanelStore.getState().panels.find((p) => p.id === 'clips')?.visible,
    ).toBe(true);
    dispose();
  });
});

describe('registerBuiltinPanels: active-panel fallback', () => {
  it('falls back to files when the active panel becomes invisible', () => {
    const dispose = registerBuiltinPanels();
    useEditorStore.getState().setActivePanel('wiki');
    // mirror fires → activePanelId becomes 'wiki'
    expect(useFeaturePanelStore.getState().activePanelId).toBe('wiki');
    // hide wiki → fallback to files
    useAppearanceStore.setState({ enableWikiPanel: false });
    expect(useEditorStore.getState().activePanel).toBe('files');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    dispose();
  });

  it('does not fall back when a non-active panel becomes invisible', () => {
    const dispose = registerBuiltinPanels();
    useEditorStore.getState().setActivePanel('wiki');
    // hiding clips (not active) does not change the active panel
    useAppearanceStore.setState({ enableClipsPanel: false });
    expect(useEditorStore.getState().activePanel).toBe('wiki');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('wiki');
    dispose();
  });
});

describe('registerBuiltinPanels: active-panel mirror + persisted-invalid fallback', () => {
  it('mirrors editorStore.activePanel → featurePanelStore.activePanelId', () => {
    const dispose = registerBuiltinPanels();
    useEditorStore.getState().setActivePanel('analyze');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('analyze');
    useEditorStore.getState().setActivePanel('calendar');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('calendar');
    dispose();
  });

  it('persisted-invalid id (uninstalled plugin panel) falls back to files', () => {
    // Simulate a persisted active panel id that no longer exists (e.g. a
    // plugin panel from an uninstalled plugin). Register with that id
    // already set as editorStore.activePanel — the initial sync should
    // re-route to 'files'.
    useEditorStore.setState({ activePanel: 'oldplugin.panel' });
    const dispose = registerBuiltinPanels();
    expect(useEditorStore.getState().activePanel).toBe('files');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    dispose();
  });

  it('initial sync picks up editorStore.activePanel when it is a registered visible panel', () => {
    useEditorStore.setState({ activePanel: 'wiki' });
    const dispose = registerBuiltinPanels();
    expect(useFeaturePanelStore.getState().activePanelId).toBe('wiki');
    dispose();
  });

  it('initial sync falls back when editorStore.activePanel is registered but invisible', () => {
    useAppearanceStore.setState({ enableWikiPanel: false });
    useEditorStore.setState({ activePanel: 'wiki' });
    const dispose = registerBuiltinPanels();
    expect(useEditorStore.getState().activePanel).toBe('files');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    dispose();
  });
});
