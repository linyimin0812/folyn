import { useEffect, useState } from 'react';
import { usePlantUmlSvg } from '@quill/container-plugins';
import { ZoomPanCanvas } from '../image/ZoomPanCanvas';
import type { PreviewProps } from '../types';

// ponytail: file-type preview reuses the same SVG fetch as the inline markdown
// renderer, but wraps the SVG in ZoomPanCanvas (matching svg/image previews)
// so the user can wheel-zoom, drag-pan, and pinch. SVG string → blob URL is
// the same trick SvgPreview uses; ZoomPanCanvas treats it as an img src.
export function PlantUmlPreview({ content, filePath }: PreviewProps) {
  const { svg, error } = usePlantUmlSvg(content);
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
    // Loading marker — `渲染图表中` is in exportService's LOADING_MARKERS.
    return <div className="py-4 text-center text-[var(--t3)] text-[13px]">渲染图表中...</div>;
  }

  return <ZoomPanCanvas src={url} alt={filePath} />;
}
