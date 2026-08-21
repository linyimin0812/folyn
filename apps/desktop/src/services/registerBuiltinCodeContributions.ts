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
import { useTranslation } from 'react-i18next';
import { MermaidBlock, mermaidLanguageFactory, PlantUmlBlock, GraphvizBlock, plantumlLanguageFactory, dotLanguageFactory } from '@quill/container-plugins';
import type { MarkdownCodeRendererProps } from '@quill/plugin-host';
import { registerMarkdownCodeRenderer } from './plugin-host/markdownCodeRendererAdapter';
import { registerEditorLanguage } from './plugin-host/editorLanguageAdapter';
import { MarkmapBlock } from '@/components/file-types/markmap/MarkmapBlock';

/** Adapt MermaidBlock (children-based) to the renderer-props (source-based) shape. */
function MermaidCodeRenderer({ source }: MarkdownCodeRendererProps) {
  return createElement(MermaidBlock, null, source);
}

/** PlantUML code-fence renderer — uses the source string directly. */
function PlantUmlCodeRenderer({ source }: MarkdownCodeRendererProps) {
  const { t } = useTranslation();
  return createElement(PlantUmlBlock, { source, loadingLabel: t('common.renderingDiagram') });
}

/** Graphviz (DOT) code-fence renderer — POSTed to quickchart.io. */
function GraphvizCodeRenderer({ source }: MarkdownCodeRendererProps) {
  const { t } = useTranslation();
  return createElement(GraphvizBlock, { source, loadingLabel: t('common.renderingDiagram') });
}

/** Markmap code-fence renderer — the fence body is markdown headings. */
function MarkmapCodeRenderer({ source }: MarkdownCodeRendererProps) {
  return createElement(MarkmapBlock, { source });
}

let registered = false;

export function registerBuiltinCodeContributions(): void {
  if (registered) return;
  registered = true;
  // ponytail: builtins register before plugins; first-registered-wins keeps the
  // builtin mermaid renderer authoritative even if a plugin also declares it.
  registerMarkdownCodeRenderer('builtin', 'mermaid', 'mermaid', MermaidCodeRenderer);
  registerMarkdownCodeRenderer('builtin', 'mmd', 'mermaid', MermaidCodeRenderer);
  registerEditorLanguage('builtin', 'mermaid', 'mermaid', mermaidLanguageFactory, ['mmd', 'mermaid']);
  registerEditorLanguage('builtin', 'mmd', 'mermaid', mermaidLanguageFactory, ['mmd', 'mermaid']);
  // PlantUML: rendered via plantuml.com. StreamLanguage defined in
  // container-plugins/src/editor-languages/plantuml.ts (covers common
  // diagram keywords, ' line comments, /' block comments, strings).
  registerMarkdownCodeRenderer('builtin', 'plantuml', 'plantuml', PlantUmlCodeRenderer);
  registerMarkdownCodeRenderer('builtin', 'puml', 'plantuml', PlantUmlCodeRenderer);
  registerMarkdownCodeRenderer('builtin', 'pu', 'plantuml', PlantUmlCodeRenderer);
  registerEditorLanguage('builtin', 'plantuml', 'plantuml', plantumlLanguageFactory, ['puml', 'pu', 'plantuml']);
  registerEditorLanguage('builtin', 'puml', 'plantuml', plantumlLanguageFactory, ['puml', 'pu', 'plantuml']);
  registerEditorLanguage('builtin', 'pu', 'plantuml', plantumlLanguageFactory, ['puml', 'pu', 'plantuml']);
  // Graphviz: rendered via quickchart.io. StreamLanguage defined in
  // container-plugins/src/editor-languages/dot.ts (covers digraph/graph/
  // subgraph, attributes, // and # line comments, /* block comments,
  // " strings, <html labels>).
  registerMarkdownCodeRenderer('builtin', 'graphviz', 'graphviz', GraphvizCodeRenderer);
  registerMarkdownCodeRenderer('builtin', 'dot', 'graphviz', GraphvizCodeRenderer);
  registerEditorLanguage('builtin', 'graphviz', 'graphviz', dotLanguageFactory, ['gv', 'dot', 'graphviz']);
  registerEditorLanguage('builtin', 'dot', 'graphviz', dotLanguageFactory, ['gv', 'dot', 'graphviz']);
  registerEditorLanguage('builtin', 'gv', 'graphviz', dotLanguageFactory, ['gv', 'dot', 'graphviz']);
  // Markmap: fence body is markdown headings; `markmap` is the canonical fence
  // language and matches the `.markmap` file extension.
  registerMarkdownCodeRenderer('builtin', 'markmap', 'markmap', MarkmapCodeRenderer);
}
