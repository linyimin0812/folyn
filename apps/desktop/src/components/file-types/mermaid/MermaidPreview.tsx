import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMermaidSvg } from '@folyn/container-plugins';
import { ZoomPanCanvas } from '../image/ZoomPanCanvas';
import type { PreviewProps } from '../types';

// ponytail: file-type preview reuses the same client-side SVG render as the
// inline markdown code-fence renderer (useMermaidSvg), but wraps the SVG in
// ZoomPanCanvas (matching graphviz/plantuml previews) so the user can
// wheel-zoom, drag-pan, and pinch. SVG string → blob URL is the same trick
// PlantUmlPreview uses; ZoomPanCanvas treats it as an img src.
export function MermaidPreview({ content, filePath }: PreviewProps) {
  const { t } = useTranslation();
  const { svg, error } = useMermaidSvg(content);
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!svg) { setUrl(''); return; }
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [svg]);

  if (error) {
    return (
      <div className="border border-[#ef4444] rounded p-3 my-2">
        <pre className="text-[#ef4444] text-xs m-0 mb-2">{error}</pre>
        <pre className="bg-[var(--surf)] p-2 rounded text-xs overflow-x-auto"><code>{content}</code></pre>
      </div>
    );
  }

  if (!url) {
    // Loading marker — `data-loading` attribute is queried by exportService's
    // stability poll (sibling mechanism to LOADING_MARKERS text markers).
    return (
      <div
        className="min-h-[60vh] flex flex-col gap-3 justify-center items-center text-[var(--txt-muted, #888)]"
        data-loading="true"
      >
        <span
          className="inline-block w-8 h-8 rounded-full border-[3px] border-brd border-t-acc animate-spin shrink-0"
          aria-label="渲染图表中"
        />
        <span className="text-sm">{t('common.renderingDiagram')}</span>
      </div>
    );
  }

  return <ZoomPanCanvas src={url} alt={filePath} />;
}
