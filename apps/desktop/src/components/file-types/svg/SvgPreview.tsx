import { useEffect, useState } from 'react';
import type { PreviewProps } from '../types';
import { ZoomPanCanvas } from '../image/ZoomPanCanvas';

// ponytail: live SVG preview — renders in-memory `content` as a blob URL so
// edits in CodeMirror show immediately, before save. Reuses ZoomPanCanvas
// for zoom/pan/pinch parity with ImageViewer.
export function SvgPreview({ content, filePath }: PreviewProps) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const blob = new Blob([content], { type: 'image/svg+xml' });
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [content]);

  if (!url) return null;
  // ponytail: className defaults to 'image-viewer' so .prev-body:has(.image-viewer)
  // zeroes padding — same full-bleed treatment as raster image previews.
  return <ZoomPanCanvas src={url} alt={filePath} />;
}
