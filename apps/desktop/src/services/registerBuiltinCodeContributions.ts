/**
 * Register built-in markdown code renderers + editor languages.
 *
 * Parallel to `registerBuiltinPlugins` (container directives): the mermaid
 * renderer and mermaid CodeMirror StreamLanguage used to be hardcoded in
 * `MarkdownPreview.tsx` + `apps/desktop/src/editor/extensions/mermaidLanguage.ts`.
 * They now register through the same contribution registries plugins use, so
 * the dispatch path is uniform. First-registered-wins makes repeat calls safe.
 */

import { createElement } from 'react';
import { MermaidBlock, mermaidLanguageFactory } from '@quill/container-plugins';
import type { MarkdownCodeRendererProps } from '@quill/plugin-host';
import { registerMarkdownCodeRenderer } from './plugin-host/markdownCodeRendererAdapter';
import { registerEditorLanguage } from './plugin-host/editorLanguageAdapter';

/** Adapt MermaidBlock (children-based) to the renderer-props (source-based) shape. */
function MermaidCodeRenderer({ source }: MarkdownCodeRendererProps) {
  return createElement(MermaidBlock, null, source);
}

let registered = false;

export function registerBuiltinCodeContributions(): void {
  if (registered) return;
  registered = true;
  // ponytail: builtins register before plugins; first-registered-wins keeps the
  // builtin mermaid renderer authoritative even if a plugin also declares it.
  registerMarkdownCodeRenderer('builtin', 'mermaid', 'mermaid', MermaidCodeRenderer);
  registerMarkdownCodeRenderer('builtin', 'mmd', 'mermaid', MermaidCodeRenderer);
  registerEditorLanguage('builtin', 'mermaid', 'mermaid', mermaidLanguageFactory);
  registerEditorLanguage('builtin', 'mmd', 'mermaid', mermaidLanguageFactory);
}
