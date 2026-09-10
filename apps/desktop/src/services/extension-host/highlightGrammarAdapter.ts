/**
 * Highlight-grammar contribution adapter (trusted-tier highlight.js grammars).
 *
 * For each `contributes.highlightGrammars[]` entry: resolve the `entry`
 * entry-ref against `module.highlightGrammars`, then call
 * `hljs.registerLanguage(name, fn)` so the grammar is recognized by both
 * `rehype-highlight` (markdown ```lang code blocks) and `CodeFileViewer`
 * (which falls back to `hljs.getLanguage(ext)` for file-extension lookup).
 * Aliases declared in the grammar's returned `aliases` field are
 * auto-registered by hljs itself — no host-side alias bookkeeping needed.
 *
 * Tracking the extension id on each registration lets `unregisterLanguage` skip
 * foreign extensions' grammars on deactivate (matches `editorLanguageAdapter`'s
 * first-registered-wins semantics). ponytail: re-registering the same name on
 * activate-over-activate is a no-op guard — hljs overwrites silently.
 *
 * Mirrors `editorLanguageAdapter.ts`: entry-ref missing → warn + skip; returns
 * a merged Disposable that unregisters all on deactivate.
 */

import type { Disposable, ExtensionManifest } from '@folyn/extension-host';
import type { HighlightGrammarContribution, HighlightGrammarFn } from '@folyn/extension-host';
import hljs from 'highlight.js';
import type { ExtensionModule } from './contributionAdapters';

interface RegisteredGrammar {
  extensionId: string;
  name: string;
}

const registered = new Map<string, RegisteredGrammar>();

/** Register a grammar with hljs under `name`. Idempotent per (extensionId, name). */
export function registerHighlightGrammar(
  extensionId: string,
  name: string,
  fn: HighlightGrammarFn,
): { dispose: () => void } {
  if (!registered.has(name)) {
    hljs.registerLanguage(name, fn as Parameters<typeof hljs.registerLanguage>[1]);
    registered.set(name, { extensionId, name });
  }
  return { dispose: () => unregisterHighlightGrammar(name, extensionId) };
}

/** Remove a grammar (only if it still belongs to this extension). */
export function unregisterHighlightGrammar(name: string, extensionId: string): void {
  const existing = registered.get(name);
  if (existing?.extensionId !== extensionId) return;
  hljs.unregisterLanguage(name);
  registered.delete(name);
}

/** Test helper: clear the registry (does NOT call hljs.unregisterLanguage). */
export function clearHighlightGrammars(): void {
  registered.clear();
}

/** Look up which extension owns a grammar (test/debug helper). */
export function getHighlightGrammarOwner(name: string): string | undefined {
  return registered.get(name)?.extensionId;
}

export function registerExtensionHighlightGrammars(
  manifest: ExtensionManifest,
  module: ExtensionModule,
): Disposable {
  const contributions: HighlightGrammarContribution[] = manifest.contributes?.highlightGrammars ?? [];
  if (contributions.length === 0) return { dispose: () => {} };

  const disposables: Array<{ dispose: () => void }> = [];
  for (const c of contributions) {
    const fn = module.highlightGrammars?.[c.entry];
    if (typeof fn !== 'function') {
      console.warn(
        `[extension-host] extension "${manifest.id}" highlight-grammar "${c.name}" has no factory for entry-ref "${c.entry}" — skipped`,
      );
      continue;
    }
    disposables.push(registerHighlightGrammar(manifest.id, c.name, fn));
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
