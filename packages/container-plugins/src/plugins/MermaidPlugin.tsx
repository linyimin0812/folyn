import { useEffect, useState, useId, useSyncExternalStore } from 'react';
import mermaid from 'mermaid';
import type { ContainerPlugin, ContainerProps } from '../ContainerPlugin';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

// Reactive <html data-theme>. Mermaid's theme is picked at render time, so we
// need to re-render when the user toggles themes. MutationObserver is the
// cheapest bridge from this plugin package to the app's appearance store,
// which always mutates documentElement.dataset.theme on toggle.
function useHtmlTheme(): string {
  return useSyncExternalStore(
    (onChange) => {
      const obs = new MutationObserver(onChange);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return () => obs.disconnect();
    },
    () => document.documentElement.dataset.theme || 'light',
    () => 'light',
  );
}

interface MermaidState {
  svg: string | null;
  error: string | null;
}

/**
 * Render Mermaid source to an SVG string. Shared by the inline markdown
 * code-fence renderer (`MermaidBlock`) and the file-type preview
 * (`MermaidPreview`) — mirrors `usePlantUmlSvg` / `useGraphvizSvg`.
 */
export function useMermaidSvg(source: string): MermaidState {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId().replace(/:/g, '-');

  useEffect(() => {
    if (!source.trim()) return;

    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
    });

    let cancelled = false;
    mermaid.render(`mermaid-${id}`, source.trim()).then(
      ({ svg: rendered }) => {
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      },
      (err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid 渲染失败');
          setSvg(null);
        }
      },
    );

    return () => { cancelled = true; };
  }, [source, id]);

  return { svg, error };
}

export function MermaidBlock({ children }: { children?: React.ReactNode }) {
  const source = extractText(children);
  const { svg, error } = useMermaidSvg(source);
  const theme = useHtmlTheme();
  const isDark = theme === 'dark';

  if (error) {
    return (
      <div className="border border-[#ef4444] rounded p-3 my-2">
        <pre className="text-[#ef4444] text-xs m-0 mb-2">{error}</pre>
        <pre className="bg-[var(--surf)] p-2 rounded text-xs overflow-x-auto"><code>{source}</code></pre>
      </div>
    );
  }

  if (svg) {
    return (
      <div
        className="flex justify-center py-4 px-3 my-2 overflow-x-auto rounded-lg"
        style={{ background: isDark ? 'var(--surf)' : 'transparent' }}
      >
        <div
          className="[&_svg]:max-w-full [&_svg]:h-auto"
          // ponytail: invert the light-themed SVG in dark mode. Filter is on
          // an inner wrapper so it doesn't flip the outer surface background.
          style={isDark ? { filter: 'invert(0.92) hue-rotate(180deg)' } : undefined}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    );
  }

  return <div className="py-4 text-center text-[var(--t3)] text-[13px]">渲染图表中...</div>;
}

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as any).props.children);
  }
  return '';
}

function MermaidComponent({ children }: ContainerProps) {
  return <MermaidBlock>{children}</MermaidBlock>;
}

export const mermaidPlugin: ContainerPlugin = {
  name: 'mermaid',
  icon: '📊',
  label: '流程图',
  category: 'media',
  component: MermaidComponent,
  template: ':::mermaid\ngraph TD\n  A[开始] --> B{判断}\n  B -->|是| C[结果1]\n  B -->|否| D[结果2]\n:::',
  description: 'Mermaid 图表（流程图/序列图/甘特图）',
};
