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
import type { PluginManifest } from '@folyn/plugin-host';
import {
  registerPluginExportEnhancers,
  getEnhancer,
  registerEnhancer,
  unregisterEnhancer,
  clearExportEnhancers,
} from './exportEnhancerAdapter';
import type { PluginModule } from './contributionAdapters';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
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

function fakeModule(): PluginModule {
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

describe('registerPluginExportEnhancers', () => {
  it('registers enhancers resolvable by name', () => {
    registerPluginExportEnhancers(manifest(), fakeModule());
    expect(getEnhancer('quote')).toBeTypeOf('function');
    expect(getEnhancer('canvas')).toBeTypeOf('function');
  });

  it('skips enhancers with missing entry-ref and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = fakeModule();
    mod.exportEnhancers = { 'enhance-quote': async () => {} }; // no enhance-canvas
    registerPluginExportEnhancers(manifest(), mod);
    expect(getEnhancer('quote')).toBeTypeOf('function');
    expect(getEnhancer('canvas')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns no-op disposable when no exportEnhancers declared', () => {
    expect(() =>
      registerPluginExportEnhancers(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });

  it('dispose unregisters all enhancers', () => {
    const d = registerPluginExportEnhancers(manifest(), fakeModule());
    expect(getEnhancer('quote')).toBeTypeOf('function');
    expect(getEnhancer('canvas')).toBeTypeOf('function');
    d.dispose();
    expect(getEnhancer('quote')).toBeUndefined();
    expect(getEnhancer('canvas')).toBeUndefined();
  });

  it('last-registered-wins for a colliding key (ponytail)', () => {
    // ponytail: last-registered-wins; upgrade path is a per-plugin precedence list.
    const h1 = vi.fn();
    const h2 = vi.fn();
    registerEnhancer('plugin-a', 'quote', h1);
    registerEnhancer('plugin-b', 'quote', h2);
    expect(getEnhancer('quote')).toBe(h2);
    unregisterEnhancer('quote', 'plugin-b');
    // After plugin-b unregisters, plugin-a is NOT restored (last-wins is not
    // a stack — the slot is just cleared). This is the documented ceiling.
    expect(getEnhancer('quote')).toBeUndefined();
  });
});
