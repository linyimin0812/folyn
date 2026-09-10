/**
 * Editor-language contribution adapter (trusted-tier CodeMirror language extensions).
 *
 * For each `contributes.editorLanguages[]` entry: resolve the `entry` entry-ref
 * against `module.editorLanguages`, then register into a module-level
 * {@link editorLanguageRegistry} keyed by `id` + each alias. `EditorView.tsx`
 * consults {@link getEditorLanguage} when building the markdown `codeLanguages`
 * lookup; a hit replaces the `@codemirror/language-data` fallback. First-
 * registered wins (ponytail: a per-id precedence list is the upgrade path).
 *
 * Mirrors `markdownCodeRendererAdapter.ts`: entry-ref missing → warn + skip;
 * returns a merged Disposable that unregisters all keys on deactivate.
 */

import type { Disposable, ExtensionManifest } from '@folyn/extension-host';
import type { EditorLanguageContribution, EditorLanguageFactory } from '@folyn/extension-host';
import type { ExtensionModule } from './contributionAdapters';

interface RegisteredLanguage {
  extensionId: string;
  canonical: string;
  factory: EditorLanguageFactory;
  /** File extensions (no leading dot) that should open with this language. */
  extensions: string[];
}

const languages = new Map<string, RegisteredLanguage>();

/** Register a language factory for an id (and optional aliases). First-registered-wins. */
export function registerEditorLanguage(
  extensionId: string,
  id: string,
  canonical: string,
  factory: EditorLanguageFactory,
  extensions: string[] = [],
): { dispose: () => void } {
  if (!languages.has(id)) {
    languages.set(id, { extensionId, canonical, factory, extensions });
  }
  return { dispose: () => unregisterEditorLanguage(id, extensionId) };
}

/** Remove a language (only if it still belongs to this extension). */
export function unregisterEditorLanguage(id: string, extensionId: string): void {
  const existing = languages.get(id);
  if (existing?.extensionId === extensionId) languages.delete(id);
}

/** Look up a language factory by id or alias. */
export function getEditorLanguage(
  id: string,
): { canonical: string; factory: EditorLanguageFactory; extensions: string[] } | undefined {
  const entry = languages.get(id);
  return entry ? { canonical: entry.canonical, factory: entry.factory, extensions: entry.extensions } : undefined;
}

/**
 * Enumerate distinct registered languages (deduped by canonical id, with the
 * alias keys that point at each). `EditorView.tsx` builds its markdown
 * `codeLanguages` lookup from this so extension-contributed languages (e.g.
 * plantuml) get CodeMirror highlighting — not just the hardcoded mermaid
 * builtin. Each entry's `aliases` excludes the canonical itself; `extensions`
 * are the union across all keys so standalone files (`.puml`, `.dot`, ...)
 * resolve to the same language support as ```` ```plantuml ```` fences.
 */
export function listEditorLanguages(): Array<{
  canonical: string;
  aliases: string[];
  extensions: string[];
  factory: EditorLanguageFactory;
}> {
  const byCanonical = new Map<string, {
    aliases: Set<string>;
    extensions: Set<string>;
    factory: EditorLanguageFactory;
  }>();
  for (const [key, { canonical, factory, extensions }] of languages) {
    let bucket = byCanonical.get(canonical);
    if (!bucket) {
      bucket = { aliases: new Set(), extensions: new Set(), factory };
      byCanonical.set(canonical, bucket);
    }
    if (key !== canonical) bucket.aliases.add(key);
    for (const ext of extensions) bucket.extensions.add(ext);
  }
  return Array.from(byCanonical.entries(), ([canonical, { aliases, extensions, factory }]) => ({
    canonical,
    aliases: Array.from(aliases),
    extensions: Array.from(extensions),
    factory,
  }));
}

/** Test helper: clear the registry. */
export function clearEditorLanguages(): void {
  languages.clear();
}

export function registerExtensionEditorLanguages(
  manifest: ExtensionManifest,
  module: ExtensionModule,
): Disposable {
  const contributions: EditorLanguageContribution[] = manifest.contributes?.editorLanguages ?? [];
  if (contributions.length === 0) return { dispose: () => {} };

  const disposables: Array<{ dispose: () => void }> = [];
  for (const c of contributions) {
    const factory = module.editorLanguages?.[c.entry];
    if (typeof factory !== 'function') {
      console.warn(
        `[extension-host] extension "${manifest.id}" editor-language "${c.id}" has no factory for entry-ref "${c.entry}" — skipped`,
      );
      continue;
    }
    const keys = [c.id, ...(c.aliases ?? [])];
    for (const key of keys) {
      if (languages.has(key)) continue; // first-registered wins
      disposables.push(registerEditorLanguage(manifest.id, key, c.id, factory, c.extensions ?? []));
    }
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
