/**
 * Tests for the feature contribution adapter (trusted-tier sidebar panels).
 *
 * Covers: register a plugin's features, skip `panel !== 'left'`, skip missing
 * component entry-ref, skip missing icon, refuse reserved built-in ids,
 * dispose unregisters + falls back active panel. Doesn't render the React
 * component — the adapter's contract is: register → store has the entry;
 * dispose → store no longer has it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import type { PluginManifest } from '@quill/plugin-host';
import type { PluginModule } from './contributionAdapters';
import { registerPluginFeatures } from './featureAdapter';
import { useFeaturePanelStore } from '@/store/featurePanelStore';

const NullPanel: ComponentType = () => null;

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
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

function fakeModule(): PluginModule {
  return {
    features: { panel: NullPanel },
  };
}

beforeEach(() => {
  useFeaturePanelStore.setState({ panels: [], activePanelId: null });
});

afterEach(() => {
  useFeaturePanelStore.setState({ panels: [], activePanelId: null });
  vi.restoreAllMocks();
});

describe('registerPluginFeatures', () => {
  it('registers a left panel into the store', () => {
    registerPluginFeatures(manifest(), fakeModule());
    const ids = useFeaturePanelStore.getState().panels.map((p) => p.id);
    expect(ids).toEqual(['my-panel']);
  });

  it('resolves component via module.features entry-ref', () => {
    const mod = fakeModule();
    const expected = mod.features!['panel'];
    registerPluginFeatures(manifest(), mod);
    const entry = useFeaturePanelStore.getState().panels[0];
    expect(entry.component).toBe(expected);
  });

  it('skips panel !== left and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPluginFeatures(
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
    registerPluginFeatures(manifest(), mod);
    expect(useFeaturePanelStore.getState().panels).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips a feature with missing icon and warns (icon required)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPluginFeatures(
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
    registerPluginFeatures(
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

  it('assigns plugin order incrementing per unordered plugin panel (>= 100)', () => {
    registerPluginFeatures(
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
    // Built-in calendar is 40; unordered plugin panels start at 100 so they
    // land after built-ins. The module-level counter persists across tests
    // in this file, so we assert the relative increment, not absolute values.
    expect(o1).toBeGreaterThanOrEqual(100);
    expect(o2).toBe(o1 + 1);
  });

  it('uses manifest-declared order when present', () => {
    registerPluginFeatures(
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
    const d = registerPluginFeatures(manifest(), fakeModule());
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
    const d = registerPluginFeatures(manifest(), fakeModule());
    useFeaturePanelStore.getState().setActive('my-panel');
    d.dispose();
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
  });

  it('dispose clears activePanelId when the disposed panel was active and files is NOT registered (PR1 guard)', () => {
    const d = registerPluginFeatures(manifest(), fakeModule());
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
    const d = registerPluginFeatures(manifest(), fakeModule());
    d.dispose();
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
  });

  it('returns no-op disposable when no features are contributed', () => {
    expect(() =>
      registerPluginFeatures(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });
});
