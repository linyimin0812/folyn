import { useEffect, useState } from 'react';
import { encodePlantUml } from '../plantuml/encode';

// ponytail: hardcoded public server. No config knob — YAGNI. Add a settings
// field when a user needs an internal/on-prem PlantUML server.
const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg/';

interface PlantUmlState {
  svg: string | null;
  error: string | null;
}

/**
 * Fetch the rendered SVG for a PlantUML source from plantuml.com. Shared by
 * the inline markdown code-fence renderer (`PlantUmlBlock`) and the file-type
 * preview (`PlantUmlPreview` via ZoomPanCanvas).
 */
export function usePlantUmlSvg(source: string): PlantUmlState {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source.trim()) return;
    let cancelled = false;

    encodePlantUml(source).then((encoded) =>
      fetch(`${PLANTUML_SERVER}${encoded}`).then((r) => r.text()),
    ).then(
      (text) => {
        if (cancelled) return;
        if (text.startsWith('<svg')) {
          setSvg(text);
          setError(null);
        } else {
          // Server returns a SVG with an error message for malformed source;
          // a non-SVG body is a network/server error.
          setError(text || 'PlantUML 渲染失败');
          setSvg(null);
        }
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'PlantUML 渲染失败');
        setSvg(null);
      },
    );

    return () => { cancelled = true; };
  }, [source]);

  return { svg, error };
}

interface PlantUmlBlockProps {
  source: string;
  /** Visible loading label (i18n'd by the caller). Defaults to zh for back-compat. */
  loadingLabel?: string;
}

export function PlantUmlBlock({ source, loadingLabel = '渲染图表中…' }: PlantUmlBlockProps) {
  const { svg, error } = usePlantUmlSvg(source);

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
