import type { PreviewProps } from './types';
import { resolveReact } from './react';
import { GraphvizBlock } from './GraphvizBlock';
import type { ReactElement } from 'react';

/** `.dot` / `.gv` file Preview — preview-only (no CodeMirror editor). */
export function GraphvizPreview(props: PreviewProps): ReactElement {
  const h = resolveReact().createElement;
  return h(GraphvizBlock, { source: props.content });
}
