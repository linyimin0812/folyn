/**
 * Tests for the editor-language contribution adapter.
 *
 * Covers: register resolves the `entry` entry-ref and registers into the
 * module-level registry (id + aliases); missing entry-ref is skipped with a
 * warning; dispose unregisters; `getEditorLanguage` returns the factory +
 * canonical by key; first-registered-wins for collisions.
 *
 * Mirrors `exportEnhancerAdapter.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LanguageDescription } from '@codemirror/language';
import type { PluginManifest } from '@quill/plugin-host';
import {
  registerPluginEditorLanguages,
  registerEditorLanguage,
  unregisterEditorLanguage,
  getEditorLanguage,
  listEditorLanguages,
  clearEditorLanguages,
} from './editorLanguageAdapter';
import type { PluginModule } from './contributionAdapters';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'lang-test',
    name: 'Lang Test',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      editorLanguages: [
        { id: 'plantuml', aliases: ['puml', 'pu'], extensions: ['puml', 'pu', 'plantuml'], entry: 'plantumlLanguage' },
      ],
    },
    ...overrides,
  };
}

function fakeModule(): PluginModule {
  return {
    editorLanguages: {
      plantumlLanguage: () => ({ /* LanguageSupport stub */ }),
    },
  } as unknown as PluginModule;
}

beforeEach(() => {
  clearEditorLanguages();
});

afterEach(() => {
  clearEditorLanguages();
  vi.restoreAllMocks();
});

describe('registerPluginEditorLanguages', () => {
  it('registers language resolvable by id + aliases', () => {
    registerPluginEditorLanguages(manifest(), fakeModule());
    expect(getEditorLanguage('plantuml')).toBeDefined();
    expect(getEditorLanguage('puml')?.canonical).toBe('plantuml');
    expect(getEditorLanguage('pu')?.canonical).toBe('plantuml');
  });

  it('exposes declared file extensions for standalone-file matching', () => {
    registerPluginEditorLanguages(manifest(), fakeModule());
    expect(getEditorLanguage('plantuml')?.extensions).toEqual(['puml', 'pu', 'plantuml']);
    const listed = listEditorLanguages();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      canonical: 'plantuml',
      aliases: ['puml', 'pu'],
      extensions: ['puml', 'pu', 'plantuml'],
    });
  });

  it('unions extensions across alias keys of the same canonical language', () => {
    registerEditorLanguage('plugin-a', 'plantuml', 'plantuml', () => ({ /* a */ }), ['puml', 'plantuml']);
    registerEditorLanguage('plugin-a', 'pu', 'plantuml', () => ({ /* a */ }), ['pu']);
    expect(listEditorLanguages()[0].extensions.sort()).toEqual(['plantuml', 'pu', 'puml']);
  });

  it('built registry descriptions match standalone files by extension', () => {
    // Mirrors buildCodeLanguages() in EditorView.tsx: registered languages are
    // turned into LanguageDescription.of({ name, alias, extensions, load }).
    registerEditorLanguage('builtin', 'plantuml', 'plantuml', () => ({ /* LanguageSupport stub */ }), ['puml', 'pu', 'plantuml']);
    registerEditorLanguage('builtin', 'graphviz', 'graphviz', () => ({ /* LanguageSupport stub */ }), ['gv', 'dot', 'graphviz']);
    const descs = listEditorLanguages().map((entry) =>
      LanguageDescription.of({
        name: entry.canonical,
        alias: entry.aliases,
        extensions: entry.extensions,
        load: async () => entry.factory() as never,
      }),
    );
    expect(LanguageDescription.matchFilename(descs, '/vault/diagram.puml')?.name).toBe('plantuml');
    expect(LanguageDescription.matchFilename(descs, 'diagram.dot')?.name).toBe('graphviz');
    expect(LanguageDescription.matchFilename(descs, 'diagram.gv')?.name).toBe('graphviz');
    // matchFilename is case-sensitive on the extension, so callers lowercase
    // the path first (EditorView does) — same convention as detectFileType.
    expect(LanguageDescription.matchFilename(descs, 'DIAGRAM.PUML'.toLowerCase())?.name).toBe('plantuml');
    expect(LanguageDescription.matchFilename(descs, 'notes.md')).toBeNull();
  });

  it('skips languages with missing entry-ref and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = fakeModule();
    mod.editorLanguages = {}; // no plantumlLanguage
    registerPluginEditorLanguages(manifest(), mod);
    expect(getEditorLanguage('plantuml')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns no-op disposable when no editorLanguages declared', () => {
    expect(() =>
      registerPluginEditorLanguages(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });

  it('dispose unregisters all keys', () => {
    const d = registerPluginEditorLanguages(manifest(), fakeModule());
    expect(getEditorLanguage('plantuml')).toBeDefined();
    expect(getEditorLanguage('puml')).toBeDefined();
    d.dispose();
    expect(getEditorLanguage('plantuml')).toBeUndefined();
    expect(getEditorLanguage('puml')).toBeUndefined();
    expect(getEditorLanguage('pu')).toBeUndefined();
  });

  it('first-registered-wins for a colliding key (ponytail)', () => {
    // ponytail: first-registered-wins; upgrade path is a per-id precedence list.
    const f1 = () => ({ /* a */ });
    const f2 = () => ({ /* b */ });
    registerEditorLanguage('plugin-a', 'plantuml', 'plantuml', f1);
    registerEditorLanguage('plugin-b', 'plantuml', 'plantuml', f2);
    expect(getEditorLanguage('plantuml')?.factory).toBe(f1);
    // plugin-b's write didn't take; its dispose should be a no-op (only plugin-a owns it).
    unregisterEditorLanguage('plantuml', 'plugin-b');
    expect(getEditorLanguage('plantuml')?.factory).toBe(f1);
  });
});
