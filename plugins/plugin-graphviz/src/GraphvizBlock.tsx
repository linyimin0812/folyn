// Shared Graphviz render block — used by both the `.dot` file Preview and the
// `:::graphviz` markdown container. Mirrors MermaidPlugin.tsx (debounced
// render, error box with original source fallback, dark-mode CSS invert on an
// inner wrapper, responsive `[&_svg]:max-w-full`). Plain createElement TS — no
// JSX, no runtime `import 'react'` (see src/react.ts).
import { resolveReact, useHtmlTheme } from './react';
import { renderDot } from './renderDot';
import type { ReactElement } from 'react';

interface BlockProps {
  source: string;
}

export function GraphvizBlock(props: BlockProps): ReactElement {
  const React = resolveReact();
  const { createElement: h, useState, useEffect } = React;
  const { source } = props;

  const theme = useHtmlTheme();
  const isDark = theme === 'dark';

  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = source.trim();
    if (!trimmed) {
      setSvg(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // ponytail: 300ms debounce mirrors Mermaid; avoids re-rendering on every
    // keystroke from the markdown preview / external editor save.
    const timer = setTimeout(() => {
      renderDot(trimmed).then(
        ({ svg: rendered }) => {
          if (!cancelled) {
            setSvg(rendered);
            setError(null);
            setLoading(false);
          }
        },
        (err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Graphviz 渲染失败');
            setSvg(null);
            setLoading(false);
          }
        },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source]);

  if (error) {
    return h(
      'div',
      { style: { border: '1px solid #ef4444', borderRadius: 6, padding: 12, margin: '8px 0' } },
      h('pre', { style: { color: '#ef4444', fontSize: 12, margin: '0 0 8px' } }, error),
      h(
        'pre',
        { style: { background: 'var(--surf)', padding: 8, borderRadius: 4, fontSize: 12, overflow: 'auto' } },
        h('code', null, source),
      ),
    );
  }

  if (loading) {
    return h(
      'div',
      { style: { padding: '16px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 } },
      '渲染图表中...',
    );
  }

  if (svg) {
    return h(
      'div',
      {
        className: 'flex justify-center py-4 px-3 my-2 overflow-x-auto rounded-lg',
        style: { background: isDark ? 'var(--surf)' : 'transparent' },
      },
      h('div', {
        key: 'svg',
        className: '[&_svg]:max-w-full [&_svg]:h-auto',
        // ponytail: render light, invert in dark — sidesteps graphviz theme
        // gaps. Filter on the inner wrapper so it doesn't flip the surface bg.
        style: isDark ? { filter: 'invert(0.92) hue-rotate(180deg)' } : undefined,
        dangerouslySetInnerHTML: { __html: svg },
      }),
    );
  }

  return h('div', null, null);
}
