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
}

export function GraphvizBlock({ source }: GraphvizBlockProps) {
  const { svg, error } = useGraphvizSvg(source);

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
      <div className="flex justify-center py-4 px-3 my-2 overflow-x-auto rounded-lg">
        <div
          className="[&_svg]:max-w-full [&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    );
  }

  // Loading marker — `data-loading` attribute is queried by exportService's
  // stability poll (sibling mechanism to the LOADING_MARKERS text markers
  // mermaid/ER still use). Spinner matches ExportMenu's exporting overlay.
  return (
    <div className="py-4 flex justify-center items-center" data-loading="true">
      <span
        className="inline-block w-4 h-4 rounded-full border-[1.5px] border-brd border-t-acc animate-spin shrink-0"
        aria-label="渲染图表中"
      />
    </div>
  );
}
