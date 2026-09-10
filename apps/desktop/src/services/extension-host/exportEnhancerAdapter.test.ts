/**
 * Tests for the export-enhancer contribution adapter.
 *
 * Covers: register resolves the `run` entry-ref and registers into the
 * module-level registry; missing entry-ref is skipped with a warning;
 * dispose unregisters; `getEnhancer` returns the handler by key.
 *
 * Mirrors `exporterAdapter.test.ts`'s mocking style.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ExtensionManifest } from '@folyn/extension-host';
import {
  registerExtensionExportEnhancers,
  getEnhancer,
  registerEnhancer,
  unregisterEnhancer,
  clearExportEnhancers,
} from './exportEnhancerAdapter';
import type { ExtensionModule } from './contributionAdapters';

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'enhancer-test',
    name: 'Enhancer Test',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      exportEnhancers: [
        { name: 'quote', run: 'enhance-quote' },
        { name: 'canvas', run: 'enhance-canvas' },
      ],
    },
    ...overrides,
  };
}

function fakeModule(): ExtensionModule {
  return {
    exportEnhancers: {
      'enhance-quote': async () => {},
      'enhance-canvas': async () => {},
    },
  };
}

beforeEach(() => {
  clearExportEnhancers();
});

afterEach(() => {
  clearExportEnhancers();
  vi.restoreAllMocks();
});

describe('registerExtensionExportEnhancers', () => {
  it('registers enhancers resolvable by name', () => {
    registerExtensionExportEnhancers(manifest(), fakeModule());
    expect(getEnhancer('quote')).toBeTypeOf('function');
    expect(getEnhancer('canvas')).toBeTypeOf('function');
  });

  it('skips enhancers with missing entry-ref and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = fakeModule();
    mod.exportEnhancers = { 'enhance-quote': async () => {} }; // no enhance-canvas
    registerExtensionExportEnhancers(manifest(), mod);
    expect(getEnhancer('quote')).toBeTypeOf('function');
    expect(getEnhancer('canvas')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns no-op disposable when no exportEnhancers declared', () => {
    expect(() =>
      registerExtensionExportEnhancers(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });

  it('dispose unregisters all enhancers', () => {
    const d = registerExtensionExportEnhancers(manifest(), fakeModule());
    expect(getEnhancer('quote')).toBeTypeOf('function');
    expect(getEnhancer('canvas')).toBeTypeOf('function');
    d.dispose();
    expect(getEnhancer('quote')).toBeUndefined();
    expect(getEnhancer('canvas')).toBeUndefined();
  });

  it('last-registered-wins for a colliding key (ponytail)', () => {
    // ponytail: last-registered-wins; upgrade path is a per-extension precedence list.
    const h1 = vi.fn();
    const h2 = vi.fn();
    registerEnhancer('extension-a', 'quote', h1);
    registerEnhancer('extension-b', 'quote', h2);
    expect(getEnhancer('quote')).toBe(h2);
    unregisterEnhancer('quote', 'extension-b');
    // After extension-b unregisters, extension-a is NOT restored (last-wins is not
    // a stack — the slot is just cleared). This is the documented ceiling.
    expect(getEnhancer('quote')).toBeUndefined();
  });
});
