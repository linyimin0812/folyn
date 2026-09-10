/**
 * Tests for the feature contribution adapter (trusted-tier sidebar panels).
 *
 * Covers: register a extension's features, skip `panel !== 'left'`, skip missing
 * component entry-ref, skip missing icon, refuse reserved built-in ids,
 * dispose unregisters + falls back active panel. Doesn't render the React
 * component — the adapter's contract is: register → store has the entry;
 * dispose → store no longer has it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import type { ExtensionManifest } from '@folyn/extension-host';
import type { ExtensionModule } from './contributionAdapters';
import { registerExtensionFeatures } from './featureAdapter';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { useEditorStore } from '@/store/editorStore';

const NullPanel: ComponentType = () => null;

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'feature-test',
    name: 'Feature Test',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      features: [
        {
          id: 'my-panel',
          panel: 'left',
          component: 'panel',
          icon: '<svg><circle/></svg>',
          title: 'My Panel',
        },
      ],
    },
    ...overrides,
  };
}

function fakeModule(): ExtensionModule {
  return {
    features: { panel: NullPanel },
  };
}

beforeEach(() => {
  useFeaturePanelStore.setState({ panels: [], activePanelId: null });
  useEditorStore.setState({ activePanel: 'files' });
});

afterEach(() => {
  useFeaturePanelStore.setState({ panels: [], activePanelId: null });
  useEditorStore.setState({ activePanel: 'files' });
  vi.restoreAllMocks();
});

describe('registerExtensionFeatures', () => {
  it('registers a left panel into the store', () => {
    registerExtensionFeatures(manifest(), fakeModule());
    const ids = useFeaturePanelStore.getState().panels.map((p) => p.id);
    expect(ids).toEqual(['my-panel']);
  });

  it('resolves component via module.features entry-ref', () => {
    const mod = fakeModule();
    const expected = mod.features!['panel'];
    registerExtensionFeatures(manifest(), mod);
    const entry = useFeaturePanelStore.getState().panels[0];
    expect(entry.component).toBe(expected);
  });

  it('skips panel !== left and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerExtensionFeatures(
      manifest({
        contributes: {
          features: [
            { id: 'right-panel', panel: 'right', component: 'panel', icon: '<svg/>' },
            { id: 'bottom-panel', panel: 'bottom', component: 'panel', icon: '<svg/>' },
          ],
        },
      }),
      fakeModule(),
    );
    expect(useFeaturePanelStore.getState().panels).toHaveLength(0);
    expect(warn.mock.calls).toHaveLength(2);
    warn.mockRestore();
  });

  it('skips a feature with missing component entry-ref and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = fakeModule();
    mod.features = {}; // no 'panel' handler
    registerExtensionFeatures(manifest(), mod);
    expect(useFeaturePanelStore.getState().panels).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips a feature with missing icon and warns (icon required)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerExtensionFeatures(
      manifest({
        contributes: {
          features: [{ id: 'no-icon', panel: 'left', component: 'panel', icon: '' }],
        },
      }),
      fakeModule(),
    );
    expect(useFeaturePanelStore.getState().panels).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses a feature whose id collides with a reserved built-in', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerExtensionFeatures(
      manifest({
        contributes: {
          features: [
            { id: 'files', panel: 'left', component: 'panel', icon: '<svg/>' },
            { id: 'wiki', panel: 'left', component: 'panel', icon: '<svg/>' },
            { id: 'calendar', panel: 'left', component: 'panel', icon: '<svg/>' },
          ],
        },
      }),
      fakeModule(),
    );
    expect(useFeaturePanelStore.getState().panels).toHaveLength(0);
    expect(warn.mock.calls).toHaveLength(3);
    warn.mockRestore();
  });

  it('assigns extension order incrementing per unordered extension panel (>= 100)', () => {
    registerExtensionFeatures(
      manifest({
        contributes: {
          features: [
            { id: 'p1', panel: 'left', component: 'panel', icon: '<svg/>' },
            { id: 'p2', panel: 'left', component: 'panel', icon: '<svg/>' },
          ],
        },
      }),
      fakeModule(),
    );
    const panels = useFeaturePanelStore.getState().panels;
    const o1 = panels.find((p) => p.id === 'p1')!.order;
    const o2 = panels.find((p) => p.id === 'p2')!.order;
    // Built-in calendar is 40; unordered extension panels start at 100 so they
    // land after built-ins. The module-level counter persists across tests
    // in this file, so we assert the relative increment, not absolute values.
    expect(o1).toBeGreaterThanOrEqual(100);
    expect(o2).toBe(o1 + 1);
  });

  it('uses manifest-declared order when present', () => {
    registerExtensionFeatures(
      manifest({
        contributes: {
          features: [{ id: 'p1', panel: 'left', component: 'panel', icon: '<svg/>', order: 5 }],
        },
      }),
      fakeModule(),
    );
    expect(useFeaturePanelStore.getState().panels[0].order).toBe(5);
  });

  it('dispose unregisters the panel', () => {
    const d = registerExtensionFeatures(manifest(), fakeModule());
    expect(useFeaturePanelStore.getState().panels).toHaveLength(1);
    d.dispose();
    expect(useFeaturePanelStore.getState().panels).toHaveLength(0);
  });

  it('dispose falls back to files when the disposed panel was active (and files is registered)', () => {
    // Pre-register a fake 'files' built-in so the fallback target exists.
    useFeaturePanelStore.getState().register({
      id: 'files',
      title: 'Files',
      icon: null,
      component: () => null,
      order: 0,
      visible: true,
      builtin: true,
    });
    const d = registerExtensionFeatures(manifest(), fakeModule());
    useFeaturePanelStore.getState().setActive('my-panel');
    d.dispose();
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
  });

  it('dispose clears activePanelId when the disposed panel was active and files is NOT registered (PR1 guard)', () => {
    const d = registerExtensionFeatures(manifest(), fakeModule());
    useFeaturePanelStore.getState().setActive('my-panel');
    d.dispose();
    expect(useFeaturePanelStore.getState().activePanelId).toBe(null);
  });

  it('dispose does not change activePanelId when the disposed panel was NOT active', () => {
    useFeaturePanelStore.getState().register({
      id: 'files',
      title: 'Files',
      icon: null,
      component: () => null,
      order: 0,
      visible: true,
      builtin: true,
    });
    useFeaturePanelStore.getState().setActive('files');
    const d = registerExtensionFeatures(manifest(), fakeModule());
    d.dispose();
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
  });

  it('dispose syncs editorStore.activePanel to files when the disposed panel was active (PR3)', () => {
    // Pre-register 'files' built-in so the fallback target exists.
    useFeaturePanelStore.getState().register({
      id: 'files',
      title: 'Files',
      icon: null,
      component: () => null,
      order: 0,
      visible: true,
      builtin: true,
    });
    const d = registerExtensionFeatures(manifest(), fakeModule());
    // Simulate the user activating the extension panel: editorStore is the
    // source of truth (the mirror would normally propagate to featurePanelStore,
    // but here we set both directly to assert dispose syncs editorStore).
    useEditorStore.setState({ activePanel: 'my-panel' });
    useFeaturePanelStore.getState().setActive('my-panel');
    d.dispose();
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    expect(useEditorStore.getState().activePanel).toBe('files');
  });

  it('dispose does NOT touch editorStore when the disposed panel was NOT active', () => {
    useFeaturePanelStore.getState().register({
      id: 'files',
      title: 'Files',
      icon: null,
      component: () => null,
      order: 0,
      visible: true,
      builtin: true,
    });
    useEditorStore.setState({ activePanel: 'files' });
    useFeaturePanelStore.getState().setActive('files');
    const d = registerExtensionFeatures(manifest(), fakeModule());
    d.dispose();
    expect(useEditorStore.getState().activePanel).toBe('files');
  });

  it('returns no-op disposable when no features are contributed', () => {
    expect(() =>
      registerExtensionFeatures(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });
});
