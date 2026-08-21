// Inline ```markmap code-fence renderer. The fence body is markdown
// (headings become the mind-map nodes), so it feeds straight into
// MarkmapCanvas via the same Transformer as the `.markmap` file-type preview.
//
// Sizing: MarkmapCanvas defers render until its container has a real size, and
// percentage heights don't resolve in normal document flow — so the block is
// wrapped in a fixed-height box (mirrors the 420px box FilePreviewPlugin uses
// for embedded previews). `data-markmap-code` lets the export pipeline locate
// the block after stabilization to inline its foreignObject <img> srcs.

import { useEffect, useState } from 'react';
import { useVaultContext } from '@quill/container-plugins';
import { resolveAssetBase } from '../previewPath';
import { MarkmapCanvas } from './MarkmapCanvas';

interface MarkmapBlockProps {
  source: string;
}

export function MarkmapBlock({ source }: MarkmapBlockProps) {
  const ctx = useVaultContext();
  const filePath = ctx?.filePath ?? '';
  const vaultRoot = ctx?.vaultRoot ?? '';
  const [assetBase, setAssetBase] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath || !vaultRoot) {
      setAssetBase(null);
      return;
    }
    let cancelled = false;
    resolveAssetBase(filePath, vaultRoot)
      .then((base) => { if (!cancelled) setAssetBase(base); })
      .catch(() => { if (!cancelled) setAssetBase(null); });
    return () => { cancelled = true; };
  }, [filePath, vaultRoot]);

  return (
    <div
      data-markmap-code
      data-markmap-src={source}
      className="markmap-block my-3 overflow-hidden"
      style={{ height: 420 }}
    >
      <MarkmapCanvas content={source} assetBase={assetBase} className="h-full w-full" />
    </div>
  );
}
