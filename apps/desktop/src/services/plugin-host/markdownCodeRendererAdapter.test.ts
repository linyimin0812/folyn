/**
 * Tests for the markdown-code-renderer contribution adapter.
 *
 * Covers: register resolves the `component` entry-ref and registers into the
 * module-level registry (language + aliases); missing entry-ref is skipped
 * with a warning; dispose unregisters; `getMarkdownCodeRenderer` returns the
 * component + canonical by key; first-registered-wins for collisions.
 *
 * Mirrors `exportEnhancerAdapter.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import type { PluginManifest } from '@folyn/plugin-host';
import {
  registerPluginMarkdownCodeRenderers,
  registerMarkdownCodeRenderer,
  unregisterMarkdownCodeRenderer,
  getMarkdownCodeRenderer,
  clearMarkdownCodeRenderers,
} from './markdownCodeRendererAdapter';
import type { PluginModule } from './contributionAdapters';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'renderer-test',
    name: 'Renderer Test',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      markdownCodeRenderers: [
        { language: 'plantuml', aliases: ['puml', 'pu'], component: 'PlantUmlMarkdownBlock' },
      ],
    },
    ...overrides,
  };
}

function fakeModule(): PluginModule {
  return {
    markdownCodeRenderers: {
      PlantUmlMarkdownBlock: () => createElement('div'),
    },
  } as unknown as PluginModule;
}

beforeEach(() => {
  clearMarkdownCodeRenderers();
});

afterEach(() => {
  clearMarkdownCodeRenderers();
  vi.restoreAllMocks();
});

describe('registerPluginMarkdownCodeRenderers', () => {
  it('registers renderer resolvable by language + aliases', () => {
    registerPluginMarkdownCodeRenderers(manifest(), fakeModule());
    expect(getMarkdownCodeRenderer('plantuml')).toBeDefined();
    expect(getMarkdownCodeRenderer('puml')?.canonical).toBe('plantuml');
    expect(getMarkdownCodeRenderer('pu')?.canonical).toBe('plantuml');
  });

  it('skips renderers with missing entry-ref and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = fakeModule();
    mod.markdownCodeRenderers = {}; // no PlantUmlMarkdownBlock
    registerPluginMarkdownCodeRenderers(manifest(), mod);
    expect(getMarkdownCodeRenderer('plantuml')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns no-op disposable when no markdownCodeRenderers declared', () => {
    expect(() =>
      registerPluginMarkdownCodeRenderers(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });

  it('dispose unregisters all keys', () => {
    const d = registerPluginMarkdownCodeRenderers(manifest(), fakeModule());
    expect(getMarkdownCodeRenderer('plantuml')).toBeDefined();
    expect(getMarkdownCodeRenderer('puml')).toBeDefined();
    d.dispose();
    expect(getMarkdownCodeRenderer('plantuml')).toBeUndefined();
    expect(getMarkdownCodeRenderer('puml')).toBeUndefined();
    expect(getMarkdownCodeRenderer('pu')).toBeUndefined();
  });

  it('first-registered-wins for a colliding key (ponytail)', () => {
    // ponytail: first-registered-wins; upgrade path is a per-language precedence list.
    const c1 = () => createElement('a');
    const c2 = () => createElement('b');
    registerMarkdownCodeRenderer('plugin-a', 'plantuml', 'plantuml', c1);
    registerMarkdownCodeRenderer('plugin-b', 'plantuml', 'plantuml', c2);
    expect(getMarkdownCodeRenderer('plantuml')?.component).toBe(c1);
    // plugin-b's write didn't take; its dispose should be a no-op (only plugin-a owns it).
    unregisterMarkdownCodeRenderer('plantuml', 'plugin-b');
    expect(getMarkdownCodeRenderer('plantuml')?.component).toBe(c1);
  });
});
