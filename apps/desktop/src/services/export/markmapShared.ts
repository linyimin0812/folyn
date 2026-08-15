// Shared markmap → standalone SVG renderer for the export pipeline. Used by
// the `.mmap` file-preview enhancer (mmap.ts) and the inline ```markmap
// code-block enhancer (exportService.processMarkmapCodeBlocks).
//
// duration: 0 — markmap applies every change through d3 transitions (node
// translate, circle radius, foreignObject opacity, fit zoom). The default
// 500ms leaves the SVG in its pre-transition state (opacity:0, r:0, no
// transform) if we serialize before they finish → a blank export. A 0ms
// transition still schedules a tick, so await setData + fit + one rAF to
// let every transition land before capturing.
//
// Renders offscreen (not in the export container) so it is independent of the
// in-DOM preview's transition state — the returned SVG is deterministic
// regardless of how far along the preview's own render is.

import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import { inlineContainerImages } from './shared';
import { resolveImagesInTree } from '@/components/file-types/mmap/resolveImages';
import '@/components/file-types/mmap/initMath';

const transformer = new Transformer();

/** Render markdown (headings → nodes) to a detached, export-ready SVG element. */
export async function renderMarkmapSvg(
  content: string,
  assetBase: string | null,
): Promise<SVGSVGElement> {
  const container = document.createElement('div');
  container.style.cssText =
    'position:absolute;left:-9999px;top:0;width:800px;height:420px;overflow:hidden;';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  container.appendChild(svg);
  document.body.appendChild(container);
  try {
    const mm = Markmap.create(svg, { autoFit: true, duration: 0 });
    const { root } = transformer.transform(content || '');
    resolveImagesInTree(root, assetBase);
    await mm.setData(root);
    await mm.fit();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    // Bake the rendered pixel size into the SVG. markmap fits via a zoom
    // transform on the <g> (no viewBox), computed against the offscreen
    // container's size. Leaving width/height at 100% would let a standalone
    // viewer re-fit to its own viewport and misalign the content; pinning the
    // captured size keeps the fit transform exact.
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      svg.setAttribute('width', String(Math.round(rect.width)));
      svg.setAttribute('height', String(Math.round(rect.height)));
    }

    // markmap renders node images as HTML <img> inside foreignObject; inline
    // Tauri asset:// URLs as base64 so the SVG is standalone.
    await inlineContainerImages(container);

    return svg;
  } finally {
    container.remove();
  }
}
