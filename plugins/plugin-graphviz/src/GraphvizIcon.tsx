import type { ReactElement } from 'react';
import { resolveReact } from './react';

// 16x16 stroke svg mirroring the ExcalidrawIcon/ClipIcon style in
// apps/desktop/src/components/icons/FileIcon.tsx. Two top nodes joined to a
// bottom node — a tiny directed-graph glyph.
export function GraphvizIcon(): ReactElement {
  const h = resolveReact().createElement;
  return h(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      style: { stroke: 'var(--ic-draw, currentColor)' },
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    h('circle', { key: 'n1', cx: 3.5, cy: 4, r: 1.6 }),
    h('circle', { key: 'n2', cx: 12.5, cy: 4, r: 1.6 }),
    h('circle', { key: 'n3', cx: 8, cy: 12, r: 1.6 }),
    h('path', { key: 'e', d: 'M5 5L7 10.4M11 5L9 10.4M5 4h6' }),
  );
}
