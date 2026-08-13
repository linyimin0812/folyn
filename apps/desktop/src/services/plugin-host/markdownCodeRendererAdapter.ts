/**
 * Markdown code-renderer contribution adapter (trusted-tier fenced-block dispatch).
 *
 * For each `contributes.markdownCodeRenderers[]` entry: resolve the `component`
 * entry-ref against `module.markdownCodeRenderers`, then register into a
 * module-level {@link markdownCodeRendererRegistry} keyed by `language` + each
 * alias. `MarkdownPreview.tsx` consults {@link getMarkdownCodeRenderer} on
 * each fenced code block; a hit replaces the default `CodeBlockWrapper`, a miss
 * falls through. Builtins (mermaid) register before plugins; first-registered
 * wins (ponytail: a per-language precedence list is the upgrade path).
 *
 * Mirrors `exportEnhancerAdapter.ts`: entry-ref missing → warn + skip; returns
 * a merged Disposable that unregisters all keys on deactivate.
 */

import type { ComponentType } from 'react';
import type { Disposable, PluginManifest } from '@quill/plugin-host';
import type { MarkdownCodeRendererContribution, MarkdownCodeRendererProps } from '@quill/plugin-host';
import type { PluginModule } from './contributionAdapters';
import { withPluginBoundary } from './pluginBoundary';

interface RegisteredRenderer {
  pluginId: string;
  canonical: string;
  component: ComponentType<MarkdownCodeRendererProps>;
}

const renderers = new Map<string, RegisteredRenderer>();

/** Register a renderer for a language (and optional aliases). First-registered-wins. */
export function registerMarkdownCodeRenderer(
  pluginId: string,
  language: string,
  canonical: string,
  component: ComponentType<MarkdownCodeRendererProps>,
): { dispose: () => void } {
  if (!renderers.has(language)) {
    renderers.set(language, { pluginId, canonical, component });
  }
  return { dispose: () => unregisterMarkdownCodeRenderer(language, pluginId) };
}

/** Remove a renderer (only if it still belongs to this plugin). */
export function unregisterMarkdownCodeRenderer(language: string, pluginId: string): void {
  const existing = renderers.get(language);
  if (existing?.pluginId === pluginId) renderers.delete(language);
}

/** Look up a renderer by fence language or alias. */
export function getMarkdownCodeRenderer(
  language: string,
): { canonical: string; component: ComponentType<MarkdownCodeRendererProps> } | undefined {
  const entry = renderers.get(language);
  return entry ? { canonical: entry.canonical, component: entry.component } : undefined;
}

/** Test helper: clear the registry. */
export function clearMarkdownCodeRenderers(): void {
  renderers.clear();
}

/**
 * Enumerate registered renderer languages (canonical + alias keys) for the
 * markdown code-fence autocomplete. Each key — canonical or alias — is a
 * valid fence language the user may type, so all are surfaced as
 * `{name, label}` entries. `CodeBlockExtension.getAllLanguages()` merges
 * this with the highlight.js list.
 */
export function listMarkdownCodeRendererLanguages(): Array<{ name: string; label: string }> {
  return Array.from(renderers.keys(), (key) => ({ name: key, label: key }));
}

export function registerPluginMarkdownCodeRenderers(
  manifest: PluginManifest,
  module: PluginModule,
): Disposable {
  const contributions: MarkdownCodeRendererContribution[] = manifest.contributes?.markdownCodeRenderers ?? [];
  if (contributions.length === 0) return { dispose: () => {} };

  const disposables: Array<{ dispose: () => void }> = [];
  for (const c of contributions) {
    const component = module.markdownCodeRenderers?.[c.component];
    if (!component) {
      console.warn(
        `[plugin-host] plugin "${manifest.id}" markdown-code-renderer "${c.language}" has no component for entry-ref "${c.component}" — skipped`,
      );
      continue;
    }
    // Wrap at the registration chokepoint so a renderer throw is isolated to
    // this fenced-block surface and never white-screens the markdown preview.
    // Per-`<pre>` instance isolation: each createElement(wrapped) call gets
    // its own boundary, so one broken block doesn't kill its siblings.
    const wrapped = withPluginBoundary(component, manifest.id, `code-renderer:${c.language}`);
    const keys = [c.language, ...(c.aliases ?? [])];
    for (const key of keys) {
      if (renderers.has(key)) continue; // first-registered wins
      disposables.push(registerMarkdownCodeRenderer(manifest.id, key, c.language, wrapped));
    }
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
