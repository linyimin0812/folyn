// ponytail: render a standalone markmap SVG from the .mmap source for
// export. The in-DOM MarkmapPreview also renders an SVG, but the export
// body may be in a different container / theme state — re-render from
// ctx.src so the exported SVG is self-contained and matches the source
// exactly.

import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import { inlineSvgImages } from './shared';
import type { EnhanceCtx } from './dbml';

const transformer = new Transformer();

export async function enhance(body: HTMLElement, ctx: EnhanceCtx): Promise<void> {
  const { src } = ctx;
  body.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  body.appendChild(svg);

  const mm = Markmap.create(svg, { autoFit: true });
  const { root } = transformer.transform(src || '');
  mm.setData(root);
  // ponytail: one rAF lets d3-flextree lay out + markmap apply the fit
  // transform; without it the captured SVG may still be at origin.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  mm.fit();

  // Inline any <image> hrefs (Tauri asset URLs) as base64 so the exported
  // SVG renders standalone.
  await inlineSvgImages(body);

  body.style.height = '420px';
  body.style.minHeight = '420px';
  body.style.overflow = 'hidden';
}
