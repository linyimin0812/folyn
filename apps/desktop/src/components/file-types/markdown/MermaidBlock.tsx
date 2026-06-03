import { useEffect, useState, useId } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

interface MermaidBlockProps {
  children?: React.ReactNode;
}

export function MermaidBlock({ children }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId().replace(/:/g, '-');

  const source = extractText(children);

  useEffect(() => {
    if (!source.trim()) return;

    const isDark = document.documentElement.dataset.theme === 'dark';
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
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

  if (error) {
    return (
      <div className="mermaid-error">
        <pre className="mermaid-error-text">{error}</pre>
        <pre className="mermaid-source"><code>{source}</code></pre>
      </div>
    );
  }

  if (svg) {
    return (
      <div
        className="mermaid-diagram"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  return <div className="mermaid-loading">渲染图表中...</div>;
}

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as any).props.children);
  }
  return '';
}
