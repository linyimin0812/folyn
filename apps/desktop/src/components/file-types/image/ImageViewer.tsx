import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { PreviewProps } from '../types';

export function ImageViewer({ filePath, vaultRoot }: PreviewProps) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!vaultRoot) return;
    import('@tauri-apps/api/path').then(({ homeDir, join }) => {
      const resolvedRoot = vaultRoot.startsWith('~')
        ? homeDir().then((h) => join(h, vaultRoot.slice(2)))
        : Promise.resolve(vaultRoot);
      resolvedRoot.then((root) => join(root, filePath)).then((absPath) => {
        setSrc(convertFileSrc(absPath));
      });
    });
  }, [filePath, vaultRoot]);

  if (!src) return null;

  return (
    <div className="image-viewer">
      <div className="image-viewer-inner">
        <img src={src} alt={filePath} />
        <div className="image-viewer-info">
          <span>{filePath}</span>
        </div>
      </div>
    </div>
  );
}
