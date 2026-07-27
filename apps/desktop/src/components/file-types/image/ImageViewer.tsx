import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { PreviewProps } from '../types';
import { ZoomPanCanvas } from './ZoomPanCanvas';
import { resolvePreviewPath } from '../previewPath';
import { isExternalPath } from '@/utils/isExternalPath';

export function ImageViewer({ filePath, vaultRoot }: PreviewProps) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    // External files don't need a vault root — their path is absolute.
    if (!isExternalPath(filePath) && !vaultRoot) return;
    let cancelled = false;
    resolvePreviewPath(filePath, vaultRoot)
      .then((absPath) => {
        if (!cancelled) setSrc(convertFileSrc(absPath));
      })
      .catch(() => { /* leave src empty */ });
    return () => { cancelled = true; };
  }, [filePath, vaultRoot]);

  if (!src) return null;
  return <ZoomPanCanvas src={src} alt={filePath} />;
}
