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
}

export function PlantUmlBlock({ source }: PlantUmlBlockProps) {
  const { svg, error } = usePlantUmlSvg(source);

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
