// Shared markmap render surface: one Markmap instance per mount; markdown →
// markmap-lib Transformer → markmap-view renders SVG. Used by both the `.mmap`
// file-type preview (MarkmapPreview) and the inline ```markmap code-fence
// renderer (MarkmapBlock). No edit-in-canvas, no per-node style/arrows/
// summaries (markmap's data model is markdown headings — those features don't
// map). autoFit on every data change; dark theme via CSS var override on the
// container (markmap text inherits `color`).
//
// Layout: markmap measures node sizes + autoFits at render time, so a 0×0
// container makes it measure every node as 0 and pin the map at the SVG
// origin — the top-left corner (and nothing re-fits when the pane later
// grows, e.g. while the split view settles). Render is deferred until the
// container has a real size, then the map re-fits on pane resizes.
//
// Ceiling: very large trees (thousands of nodes) will lay out slowly because
// markmap re-runs d3-flextree on every setData. If it bites, throttle setData
// (requestAnimationFrame coalesce) or virtualize — not needed at v1.

import { useEffect, useRef, useState } from 'react';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import { resolveImagesInTree } from './resolveImages';
import './initMath';

const transformer = new Transformer();

interface MarkmapCanvasProps {
  content: string;
  /** Directory base for relative `![](img.png)` references inside nodes.
   *  Already `~`-expanded (resolved by the caller via resolveAssetBase). */
  assetBase: string | null;
  className?: string;
}

export function MarkmapCanvas({ content, assetBase, className = '' }: MarkmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<Markmap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!svgRef.current) return;
    mmRef.current = Markmap.create(svgRef.current, { autoFit: true });
    return () => {
      mmRef.current?.destroy();
      mmRef.current = null;
    };
  }, []);

  // Defer rendering until the container has a non-zero size (see header
  // comment). One-shot: once it has size, stop observing and flip `ready`.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const hasSize = () => el.clientWidth > 0 && el.clientHeight > 0;
    if (hasSize()) {
      setReady(true);
      return;
    }
    const ro = new ResizeObserver(() => {
      if (hasSize()) {
        setReady(true);
        ro.disconnect();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const mm = mmRef.current;
    if (!mm || !ready) return;
    const { root } = transformer.transform(content || '');
    resolveImagesInTree(root, assetBase);
    mm.setData(root);
    mm.fit();
  }, [content, assetBase, ready]);

  // Keep the map fitted when the container is resized (e.g. dragging the split
  // divider or the window changing width).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ready) return;
    const ro = new ResizeObserver(() => {
      mmRef.current?.fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  return (
    <div ref={containerRef} className={`markmap-container ${className}`.trim()}>
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
