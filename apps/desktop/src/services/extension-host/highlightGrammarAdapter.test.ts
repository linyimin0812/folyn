/**
 * Tests for the highlight-grammar contribution adapter.
 *
 * Covers: register resolves the `entry` entry-ref and calls
 * `hljs.registerLanguage(name, fn)`; the grammar becomes resolvable by name
 * and aliases (declared inside the grammar's `aliases` field, handled by hljs
 * itself); missing entry-ref is skipped with a warning; dispose unregisters;
 * first-registered-wins for collisions; foreign-extension grammars are not
 * removed by another extension's deactivate.
 *
 * Mirrors `editorLanguageAdapter.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import hljs from 'highlight.js';
import type { ExtensionManifest } from '@folyn/extension-host';
import {
  registerExtensionHighlightGrammars,
  registerHighlightGrammar,
  unregisterHighlightGrammar,
  getHighlightGrammarOwner,
  clearHighlightGrammars,
} from './highlightGrammarAdapter';
import type { ExtensionModule } from './contributionAdapters';
import type { HighlightGrammarFn } from '@folyn/extension-host';

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'grammar-test',
    name: 'Grammar Test',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      highlightGrammars: [
        { name: 'plantuml', aliases: ['puml', 'pu'], entry: 'plantumlGrammar' },
      ],
    },
    ...overrides,
  };
}

function fakeModule(): ExtensionModule {
  const plantumlGrammar: HighlightGrammarFn = (hljs: unknown) => {
    const h = hljs as typeof import('highlight.js');
    return {
      name: 'PlantUML',
      aliases: ['puml', 'pu'],
      keywords: { keyword: 'participant actor class interface' },
      contains: [h.COMMENT("'", '$')],
    };
  };
  return { highlightGrammars: { plantumlGrammar } } as unknown as ExtensionModule;
}

beforeEach(() => {
  // Clean hljs + our tracker so tests are isolated.
  for (const name of ['plantuml', 'puml', 'pu']) {
    if (hljs.getLanguage(name)) hljs.unregisterLanguage(name);
  }
  clearHighlightGrammars();
});

afterEach(() => {
  for (const name of ['plantuml', 'puml', 'pu']) {
    if (hljs.getLanguage(name)) hljs.unregisterLanguage(name);
  }
  clearHighlightGrammars();
  vi.restoreAllMocks();
});

describe('registerExtensionHighlightGrammars', () => {
  it('registers grammar resolvable by name + aliases (via hljs)', () => {
    registerExtensionHighlightGrammars(manifest(), fakeModule());
    expect(hljs.getLanguage('plantuml')).toBeDefined();
    expect(hljs.getLanguage('puml')).toBeDefined();
    expect(hljs.getLanguage('pu')).toBeDefined();
    expect(getHighlightGrammarOwner('plantuml')).toBe('grammar-test');
  });

  it('skips grammars with missing entry-ref and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = fakeModule();
    mod.highlightGrammars = {};
    registerExtensionHighlightGrammars(manifest(), mod);
    expect(hljs.getLanguage('plantuml')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('returns no-op disposable when no highlightGrammars declared', () => {
    expect(() =>
      registerExtensionHighlightGrammars(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });

  it('dispose unregisters the grammar + aliases from hljs', () => {
    const d = registerExtensionHighlightGrammars(manifest(), fakeModule());
    expect(hljs.getLanguage('plantuml')).toBeDefined();
    d.dispose();
    expect(hljs.getLanguage('plantuml')).toBeUndefined();
    expect(hljs.getLanguage('puml')).toBeUndefined();
    expect(hljs.getLanguage('pu')).toBeUndefined();
  });

  it('first-registered-wins for a colliding name (ponytail)', () => {
    const a = registerHighlightGrammar('extension-a', 'plantuml', fakeModule().highlightGrammars!.plantumlGrammar);
    expect(getHighlightGrammarOwner('plantuml')).toBe('extension-a');
    registerHighlightGrammar('extension-b', 'plantuml', fakeModule().highlightGrammars!.plantumlGrammar);
    expect(getHighlightGrammarOwner('plantuml')).toBe('extension-a');
    a.dispose();
    // extension-a's dispose clears the slot; extension-b's registration was a no-op
    // so the grammar is gone, not owned by extension-b.
    expect(hljs.getLanguage('plantuml')).toBeUndefined();
  });

  it('unregisterHighlightGrammar does not remove a foreign extension grammar', () => {
    registerHighlightGrammar('extension-a', 'plantuml', fakeModule().highlightGrammars!.plantumlGrammar);
    unregisterHighlightGrammar('plantuml', 'extension-b');
    expect(hljs.getLanguage('plantuml')).toBeDefined();
    expect(getHighlightGrammarOwner('plantuml')).toBe('extension-a');
  });

  it('highlight produces meta/keyword spans after registration', () => {
    registerExtensionHighlightGrammars(manifest(), fakeModule());
    const out = hljs.highlight("participant Alice\n' a comment", { language: 'plantuml' });
    expect(out.value).toContain('hljs-keyword');
    expect(out.value).toContain('hljs-comment');
  });
});
