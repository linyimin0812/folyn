// ponytail: render a standalone markmap SVG from the .mmap source for
// export. The in-DOM MarkmapPreview also renders an SVG, but the export
// body may be in a different container / theme state — re-render from the
// file's on-disk content so the exported SVG is self-contained and matches
// the source exactly.

import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import { readFileByRoute } from '@/services/editorIoService';
import { inlineContainerImages, resolveVaultPath } from './shared';
import type { EnhanceCtx } from './dbml';
import { resolveAssetBase } from '@/components/file-types/previewPath';
import { resolveImagesInTree } from '@/components/file-types/mmap/resolveImages';
import '@/components/file-types/mmap/initMath';

const transformer = new Transformer();

export async function enhance(body: HTMLElement, ctx: EnhanceCtx): Promise<void> {
  const { src, filePath, vaultRoot } = ctx;
  if (!src) return;
  // ctx.src is the file-preview directive's src PATH (e.g. "./map.mmap"),
  // not the file content. Resolve it like the preview does and read the real
  // .mmap source — transforming the path string would yield an empty markmap
  // root (markmap only builds nodes from headings).
  const vaultRelPath = resolveVaultPath(src, filePath);
  let content: string;
  try {
    content = await readFileByRoute(vaultRelPath);
  } catch { return; }
  const assetBase = await resolveAssetBase(filePath, vaultRoot).catch(() => null);
  body.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  body.appendChild(svg);

  // duration: 0 — markmap applies every change through d3 transitions (node
  // translate, circle radius, foreignObject opacity, fit zoom). The default
  // 500ms leaves the SVG in its pre-transition state (opacity:0, r:0, no
  // transform) if we serialize before they finish → a blank export. A 0ms
  // transition still schedules a tick, so await setData + fit + one rAF to
  // let every transition land before capturing.
  const mm = Markmap.create(svg, { autoFit: true, duration: 0 });
  const { root } = transformer.transform(content || '');
  resolveImagesInTree(root, assetBase);
  await mm.setData(root);
  await mm.fit();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  // Bake the rendered pixel size into the SVG. markmap fits via a zoom
  // transform on the <g> (no viewBox), computed against the export body's
  // size. Leaving width/height at 100% would let a standalone viewer re-fit
  // to its own viewport and misalign the content; pinning the captured size
  // keeps the fit transform exact.
  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    svg.setAttribute('width', String(Math.round(rect.width)));
    svg.setAttribute('height', String(Math.round(rect.height)));
  }

  // markmap renders node images as HTML <img> inside foreignObject (not SVG
  // <image>), so inline those Tauri asset:// URLs as base64 data URLs — the
  // exported SVG must be standalone.
  await inlineContainerImages(body);

  // Serialize the markmap SVG as XML, not HTML. markmap's foreignObject node
  // content contains HTML void elements (<img>, <br>) that HTML serialization
  // (innerHTML/outerHTML) emits unclosed, which a standalone XML parser
  // rejects ("Opening and ending tag mismatch: img"). XMLSerializer self-
  // closes void elements and emits proper xhtml namespaces. Stash the bytes on
  // data-raw-svg (same as plantuml/graphviz) so renderFilePreviewToSvg returns
  // them directly instead of round-tripping through HTML.
  body.setAttribute('data-raw-svg', new XMLSerializer().serializeToString(svg));

  body.style.height = '420px';
  body.style.minHeight = '420px';
  body.style.overflow = 'hidden';
}
