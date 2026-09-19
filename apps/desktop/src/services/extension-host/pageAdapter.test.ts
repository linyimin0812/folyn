/**
 * Tests for the page contribution adapter (trusted-tier full pages).
 *
 * Covers: register an extension's pages, nav id namespacing
 * (`ext:<extensionId>.<pageId>`), skip missing component entry-ref, skip
 * missing icon, boundary wrapping, dispose unregisters + falls back to the
 * editor page when the disposed page was current. Same contract style as
 * featureAdapter.test.ts: register → store has the entry; dispose → it
 * doesn't.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import type { ExtensionManifest } from '@folyn/extension-host';
import type { ExtensionModule } from './contributionAdapters';
import { registerExtensionPages } from './pageAdapter';
import { useExtensionPageStore } from '@/store/extensionPageStore';
import { useNavStore } from '@/store/navStore';

const NullPage: ComponentType = () => null;

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'page-test',
    name: 'Page Test',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      pages: [
        {
          id: 'my-page',
          component: 'page',
          icon: '<svg><circle/></svg>',
          title: 'My Page',
        },
      ],
    },
    ...overrides,
  };
}

function fakeModule(): ExtensionModule {
  return {
    pages: { page: NullPage },
  };
}

beforeEach(() => {
  useExtensionPageStore.setState({ pages: [] });
  useNavStore.setState({ currentPage: 'editor' });
});

afterEach(() => {
  useExtensionPageStore.setState({ pages: [] });
  useNavStore.setState({ currentPage: 'editor' });
  vi.restoreAllMocks();
});

describe('registerExtensionPages', () => {
  it('registers a page into the store under the ext: namespaced id', () => {
    registerExtensionPages(manifest(), fakeModule());
    const ids = useExtensionPageStore.getState().pages.map((p) => p.id);
    expect(ids).toEqual(['ext:page-test.my-page']);
  });

  it('resolves the component via module.pages entry-ref, boundary-wrapped', () => {
    const mod = fakeModule();
    registerExtensionPages(manifest(), mod);
    const entry = useExtensionPageStore.getState().pages[0];
    // withExtensionBoundary returns a distinct wrapper component — not the raw
    // one, but it renders it. Assert wrapped-not-raw plus renderability.
    expect(entry.component).not.toBe(mod.pages!['page']);
    expect(typeof entry.component).toBe('function');
  });

  it('uses manifest title and defaults when absent', () => {
    registerExtensionPages(manifest(), fakeModule());
    expect(useExtensionPageStore.getState().pages[0].title).toBe('My Page');

    registerExtensionPages(
      manifest({
        id: 'page-test-2',
        contributes: { pages: [{ id: 't', component: 'page', icon: '<svg/>' }] },
      }),
      fakeModule(),
    );
    expect(useExtensionPageStore.getState().pages[1].title).toBe('page-test-2/t');
  });

  it('skips a page with missing component entry-ref and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = fakeModule();
    mod.pages = {}; // no 'page' entry
    registerExtensionPages(manifest(), mod);
    expect(useExtensionPageStore.getState().pages).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips a page with missing icon and warns (icon required)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerExtensionPages(
      manifest({
        contributes: { pages: [{ id: 'no-icon', component: 'page', icon: '' }] },
      }),
      fakeModule(),
    );
    expect(useExtensionPageStore.getState().pages).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('assigns extension order incrementing per unordered page (>= 100)', () => {
    registerExtensionPages(
      manifest({
        contributes: {
          pages: [
            { id: 'p1', component: 'page', icon: '<svg/>' },
            { id: 'p2', component: 'page', icon: '<svg/>' },
          ],
        },
      }),
      fakeModule(),
    );
    const pages = useExtensionPageStore.getState().pages;
    const o1 = pages.find((p) => p.id.endsWith('p1'))!.order;
    const o2 = pages.find((p) => p.id.endsWith('p2'))!.order;
    // Module-level counter persists across tests in this file — assert the
    // relative increment, not absolute values.
    expect(o1).toBeGreaterThanOrEqual(100);
    expect(o2).toBe(o1 + 1);
  });

  it('uses manifest-declared order when present', () => {
    registerExtensionPages(
      manifest({
        contributes: { pages: [{ id: 'p1', component: 'page', icon: '<svg/>', order: 5 }] },
      }),
      fakeModule(),
    );
    expect(useExtensionPageStore.getState().pages[0].order).toBe(5);
  });

  it('dispose unregisters the page', () => {
    const d = registerExtensionPages(manifest(), fakeModule());
    expect(useExtensionPageStore.getState().pages).toHaveLength(1);
    d.dispose();
    expect(useExtensionPageStore.getState().pages).toHaveLength(0);
  });

  it('dispose falls back to the editor page when the disposed page was current', () => {
    const d = registerExtensionPages(manifest(), fakeModule());
    useNavStore.setState({ currentPage: 'ext:page-test.my-page' });
    d.dispose();
    expect(useNavStore.getState().currentPage).toBe('editor');
  });

  it('dispose does not change currentPage when the disposed page was NOT current', () => {
    useNavStore.setState({ currentPage: 'vault' });
    const d = registerExtensionPages(manifest(), fakeModule());
    d.dispose();
    expect(useNavStore.getState().currentPage).toBe('vault');
  });

  it('returns no-op disposable when no pages are contributed', () => {
    expect(() =>
      registerExtensionPages(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });
});
