/**
 * mmap file-preview export: replace the body with an SVG produced by
 * mind-elixir's `exportSvg()` on the live instance. The export container's
 * MindMapCanvas already mounted mind-elixir and exposed the instance on the
 * host element (data-mmap-instance-host); we just call its exportSvg and
 * inject the resulting SVG. Falls back silently on any error.
 *
 * `exportSvg` returns a Blob (SVG type); we read it as text. The exported
 * SVG has its own inline styles so it renders standalone.
 */

import { inlineSvgImages } from './shared';
import type { EnhanceCtx } from './dbml';

export async function enhance(body: HTMLElement, _ctx: EnhanceCtx): Promise<void> {
  const host = body.querySelector<HTMLElement>('[data-mmap-instance-host]');
  const inst = host && (host as any).__mindElixir;
  if (!inst || typeof inst.exportSvg !== 'function') return;
  // Wait for layout + font-swaps to settle (mind-elixir's linkDiv runs on
  // fonts.ready + rAF; without this, exportSvg can capture mid-link state).
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  // ponytail: post-process the exported SVG to fix the foreignObject div
  // styling directly. mind-elixir's exportSvg 2nd-arg CSS injection
  // (insertAdjacentHTML on an SVG element) doesn't reliably apply to
  // foreignObject's HTML content in standalone SVG viewers — namespace
  // mismatch between HTML <style> and SVG. Patching the div's inline
  // style bypasses that: inject `line-height:1.5` so the div's text
  // matches the foreignObject's height (which came from
  // getComputedStyle(.text) inheriting body's line-height 1.5). Without
  // this, the div's text uses browser default "normal" ≈ 1.2 — shorter
  // than foreignObject, top-anchored → 偏上. Adding line-height makes
  // the text fill the foreignObject height. We don't use display:flex
  // because flex shrink on narrow foreignObjects forces 2-char Chinese
  // nodes to wrap to 2 lines, then the (1-line tall) foreignObject
  // clips the 2nd line → 显示不全.
  let blob: Blob | null = null;
  try {
    blob = inst.exportSvg(false, '');
  } catch { return; }
  if (!blob) return;
  let svgString = await blob.text();
  if (!svgString) return;
  // Inject a <style> block right after <svg> opening tag. Targets all
  // descendants of foreignObject (mind-elixir nests text in a div, possibly
  // with child spans). !important overrides any inline style mind-elixir
  // emits on those elements.
  //
  // Goals:
  //  - No wrapping: white-space:nowrap keeps each node's text on one line,
  //    overflowing the foreignObject width (SVG doesn't clip foreignObject
  //    content by default, so the text renders past the boundary). User
  //    wants single-line display regardless of length.
  //  - Vertical centering: the div's text block (1 line × line-height:1.5)
  //    is centered on the foreignObject's vertical axis via flex-direction:
  //    column + justify-content:center. height:100% lets the div fill the
  //    (post-image-swap) foreignObject so flex centering actually moves
  //    the text. (Plain flex without height:100% centers within the div's
  //    auto content height — no effect.)
  //  - Horizontal centering: text-align:center on the single line.
  const foStyle = `<style>foreignObject div, foreignObject span, foreignObject p { height: 100% !important; display: flex !important; flex-direction: column !important; justify-content: center !important; line-height: 1.5 !important; text-align: center !important; }</style>`;
  svgString = svgString.replace(/<svg\b([^>]*)>/, `<svg$1>${foStyle}`);
  // ponytail: fix image-node layout. mind-elixir's exportSvg has a bug
  // where for image nodes (me-tpc with img child), the text
  // foreignObject spans me-tpc's full content area (because
  // getComputedStyle(.text).height returns me-tpc.content height, not
  // .text's own content height). The foreignObject is positioned at
  // me-tpc.content top, so text renders ABOVE the image instead of
  // below. Visually: text at top, image below — reversed from the
  // in-app DOM layout (image at top, text below).
  // Fix: for each <image>, find the containing foreignObject (the one
  // whose bbox contains the image), then swap — move image to
  // foreignObject's top, move foreignObject to below image with 8px
  // margin (mind-elixir's img margin-bottom). foreignObject.height
  // becomes the remaining content area; line-height:1.5 + the div's
  // natural line-box centering handles vertical centering within.
  svgString = fixImageNodeLayout(svgString);
  body.innerHTML = svgString;
  // Inline <image> hrefs (Tauri asset URLs) as base64 — mind-elixir's
  // exportSvg copies img.src into <image href="...">, but the app's
  // inlineContainerImages pass runs BEFORE mind-elixir mounts, so those
  // URLs never got inlined. Without this, images break in standalone HTML.
  await inlineSvgImages(body);
  const svgEl = body.querySelector<SVGSVGElement>('svg');
  if (svgEl) {
    // mind-elixir's exportSvg emits width/height as pixel strings (e.g.
    // "640px" × "480px") but no viewBox — without one, width:100% just
    // shrinks the canvas while content stays at native coords, so only
    // the top-left corner shows. Synthesize viewBox from width/height
    // so preserveAspectRatio meet scales the content to fit the body.
    const wAttr = svgEl.getAttribute('width') ?? '';
    const hAttr = svgEl.getAttribute('height') ?? '';
    const w = parseInt(wAttr, 10);
    const h = parseInt(hAttr, 10);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    svgEl.setAttribute('width', '100%');
    svgEl.setAttribute('height', '100%');
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgEl.style.maxWidth = '100%';
    svgEl.style.display = 'block';
    svgEl.style.margin = '0 auto';
  }
  body.style.height = '420px';
  body.style.minHeight = '420px';
  body.style.overflow = 'hidden';
}

/**
 * Fix mind-elixir's image-node export layout. For nodes with both an image
 * and text, mind-elixir's exportSvg sets the text foreignObject to span
 * me-tpc's full content area (because getComputedStyle(.text).height returns
 * me-tpc.content height for image nodes), and the image ends up positioned
 * below the text — reversed from the in-app DOM layout (image at top, text
 * below). This post-processes the SVG string to swap positions: move image
 * to content top, move foreignObject below image with 8px margin (matching
 * me-tpc > img { margin-bottom: 8px } in mind-elixir's CSS).
 */
function fixImageNodeLayout(svgString: string): string {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const images = Array.from(doc.querySelectorAll('image'));
  for (const img of Array.from(images)) {
    const ix = parseFloat(img.getAttribute('x') ?? '0');
    const iy = parseFloat(img.getAttribute('y') ?? '0');
    const iw = parseFloat(img.getAttribute('width') ?? '0');
    const ih = parseFloat(img.getAttribute('height') ?? '0');
    if (!ix && !iy && !iw && !ih) continue;
    // Find the foreignObject whose bbox contains the image (same me-tpc).
    const foreignObjects = Array.from(doc.querySelectorAll('foreignObject'));
    const fo = foreignObjects.find((f) => {
      const fx = parseFloat(f.getAttribute('x') ?? '0');
      const fy = parseFloat(f.getAttribute('y') ?? '0');
      const fw = parseFloat(f.getAttribute('width') ?? '0');
      const fh = parseFloat(f.getAttribute('height') ?? '0');
      return ix >= fx - 0.5 && ix + iw <= fx + fw + 0.5
        && iy >= fy - 0.5 && iy + ih <= fy + fh + 0.5;
    });
    if (!fo) continue;
    const fy = parseFloat(fo.getAttribute('y') ?? '0');
    const fh = parseFloat(fo.getAttribute('height') ?? '0');
    const foBottom = fy + fh;  // me-tpc.content bottom
    // Move image to top of content area (foreignObject's current y).
    img.setAttribute('y', String(fy));
    // Move foreignObject below image + 8px margin.
    const newFy = fy + ih + 8;
    fo.setAttribute('y', String(newFy));
    // Height = remaining content area; foreignObject div has line-height:1.5
    // so text fills its line box and centers within. Avoids overflow beyond
    // me-tpc since (newFy + newFh) = foBottom.
    fo.setAttribute('height', String(Math.max(0, foBottom - newFy)));
  }
  return new XMLSerializer().serializeToString(doc);
}
