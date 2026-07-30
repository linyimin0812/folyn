import type { ContainerProps } from './types';
import { resolveReact } from './react';
import { GraphvizBlock } from './GraphvizBlock';
import type { ReactNode, ReactElement } from 'react';

/** `:::graphviz` markdown container directive renderer. */
export function GraphvizContainer(props: ContainerProps): ReactElement {
  const h = resolveReact().createElement;
  return h(GraphvizBlock, { source: extractText(props.children) });
}

// ponytail: lifted verbatim from MermaidPlugin.tsx — directive children come
// as nested React nodes; concatenate their text.
function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}
