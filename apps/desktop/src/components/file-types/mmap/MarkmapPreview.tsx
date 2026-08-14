// ponytail: one Markmap instance per mount; markdown → markmap-lib
// Transformer → markmap-view renders SVG. No edit-in-canvas, no per-node
// style/arrows/summaries (markmap's data model is markdown headings — those
// features don't map). autoFit on every data change; dark theme via CSS var
// override on the container (markmap text inherits `color`).
//
// Ceiling: very large trees (thousands of nodes) will lay out slowly because
// markmap re-runs d3-flextree on every setData. If it bites, throttle setData
// (requestAnimationFrame coalesce) or virtualize — not needed at v1.

import { useEffect, useRef, useState } from 'react';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import type { PreviewProps } from '../types';
import { resolveAssetBase } from '../previewPath';
import { resolveImagesInTree } from './resolveImages';

const transformer = new Transformer();

export function MarkmapPreview({ content, filePath, vaultRoot }: PreviewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<Markmap | null>(null);
  const [assetBase, setAssetBase] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveAssetBase(filePath, vaultRoot)
      .then((base) => { if (!cancelled) setAssetBase(base); })
      .catch(() => { if (!cancelled) setAssetBase(null); });
    return () => { cancelled = true; };
  }, [filePath, vaultRoot]);

  useEffect(() => {
    if (!svgRef.current) return;
    mmRef.current = Markmap.create(svgRef.current, { autoFit: true });
    return () => {
      mmRef.current?.destroy();
      mmRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mm = mmRef.current;
    if (!mm) return;
    const { root } = transformer.transform(content || '');
    resolveImagesInTree(root, assetBase);
    mm.setData(root);
    mm.fit();
  }, [content, assetBase]);

  return (
    <div className="markmap-container flex-1 h-full w-full overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
