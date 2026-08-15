// `.mmap` file-type preview: resolve the file's asset base (for relative
// `![](img.png)` references in headings), then hand off to MarkmapCanvas which
// owns the markmap instance + sizing lifecycle. The same canvas backs the
// inline ```markmap code-fence renderer (MarkmapBlock).

import { useEffect, useState } from 'react';
import type { PreviewProps } from '../types';
import { resolveAssetBase } from '../previewPath';
import { MarkmapCanvas } from './MarkmapCanvas';

export function MarkmapPreview({ content, filePath, vaultRoot }: PreviewProps) {
  const [assetBase, setAssetBase] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveAssetBase(filePath, vaultRoot)
      .then((base) => { if (!cancelled) setAssetBase(base); })
      .catch(() => { if (!cancelled) setAssetBase(null); });
    return () => { cancelled = true; };
  }, [filePath, vaultRoot]);

  return (
    <MarkmapCanvas
      content={content}
      assetBase={assetBase}
      className="flex-1 h-full w-full overflow-hidden"
    />
  );
}
