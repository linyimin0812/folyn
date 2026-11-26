import { useEffect, useState } from 'react';

// ponytail: hardcoded public server. No config knob — YAGNI. Add a settings
// field when a user needs an internal Graphviz server.
const QUICKCHART_ENDPOINT = 'https://quickchart.io/graphviz';

interface GraphvizState {
  svg: string | null;
  error: string | null;
}

/**
 * Fetch the rendered SVG for a DOT source from quickchart.io. Shared by
 * the inline markdown code-fence renderer (`GraphvizBlock`) and the file-type
 * preview (`GraphvizPreview` via ZoomPanCanvas).
 *
 * Unlike PlantUML, DOT source needs no deflate+base64 encoding — quickchart
 * accepts raw DOT in a JSON POST body.
 */
export function useGraphvizSvg(source: string): GraphvizState {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source.trim()) return;
    let cancelled = false;

    fetch(QUICKCHART_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'svg', graph: source }),
    })
      .then((r) => r.text())
      .then(
        (text) => {
          if (cancelled) return;
          // ponytail: quickchart.io returns a standalone SVG document with XML prolog + DOCTYPE, so check for <svg substring instead of startsWith
          if (/<svg\b/.test(text)) {
            setSvg(text);
            setError(null);
          } else {
            // 4xx responses come back as plain-text error messages;
            // a non-SVG body is a network/server error.
            setError(text || 'Graphviz 渲染失败');
            setSvg(null);
          }
        },
        (err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Graphviz 渲染失败');
          setSvg(null);
        },
      );

    return () => { cancelled = true; };
  }, [source]);

  return { svg, error };
}

interface GraphvizBlockProps {
  source: string;
  /** Visible loading label (i18n'd by the caller). Defaults to zh for back-compat. */
  loadingLabel?: string;
}

export function GraphvizBlock({ source, loadingLabel = '渲染图表中…' }: GraphvizBlockProps) {
  const { svg, error } = useGraphvizSvg(source);

  if (error) {
    return (
      <div className="docmd-diagram-error">
        <pre className="docmd-diagram-error-message">{error}</pre>
        <pre className="docmd-diagram-source"><code>{source}</code></pre>
      </div>
    );
  }

  if (svg) {
    return (
      <div className="docmd-diagram">
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    );
  }

  // Loading marker — `data-loading` attribute is queried by exportService's
  // stability poll (sibling mechanism to the LOADING_MARKERS text markers
  // mermaid/ER still use).
  return (
    <div className="docmd-diagram-loading" data-loading="true">
      <span className="docmd-spinner" aria-label="渲染图表中" />
      <span>{loadingLabel}</span>
    </div>
  );
}
