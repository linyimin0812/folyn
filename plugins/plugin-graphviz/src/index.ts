// Graphviz trusted-tier plugin — entry module (the `main` the trusted loader
// blob-URL `import()`-s). Export contract: `handlers` + `containers` + optional
// lifecycle (see contributionAdapters.ts `PluginModule`). All entry-refs in
// manifest.json (`handler: "graphviz"`, `component: "graphviz"`) index into
// these maps.
import type { ComponentType } from 'react';
import type { FileTypeHandler, ContainerProps } from './types';
import { GraphvizPreview } from './GraphvizPreview';
import { GraphvizContainer } from './GraphvizContainer';
import { GraphvizIcon } from './GraphvizIcon';

// Built at module-eval time. Safe: trusted plugins activate only after app
// boot, by which time main.tsx has set `window.React`.
const graphvizHandler: FileTypeHandler = {
  id: 'graphviz',
  extensions: ['dot', 'gv'],
  icon: GraphvizIcon(),
  supportedViewModes: ['preview'],
  defaultViewMode: 'preview',
  needsFileContent: true,
  useCodeMirror: false,
  Preview: GraphvizPreview,
};

export const handlers: Record<string, FileTypeHandler> = {
  graphviz: graphvizHandler,
};

export const containers: Record<string, ComponentType<ContainerProps>> = {
  graphviz: GraphvizContainer,
};

export function activate(): void {
  console.info('[plugin-graphviz] activated');
}

export function deactivate(): void {
  console.info('[plugin-graphviz] deactivated');
}
