/**
 * mermaid file-preview export: render the source to SVG client-side and inject
 * it as a self-contained <svg> into the body. Mirrors plantuml.ts / graphviz.ts.
 *
 * The in-app preview renders via ZoomPanCanvas as an <img src="blob:...">,
 * which doesn't leave an <svg> element behind for the export fallback to grab
 * — so we re-render from the source file (same path the preview resolved) and
 * replace the body.
 */

import mermaid from 'mermaid';
import { useVaultStore } from '@/store/vaultStore';
import { resolveVaultPath } from './shared';
import type { EnhanceCtx } from './dbml';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

export async function enhance(body: HTMLElement, ctx: EnhanceCtx): Promise<void> {
  const { src, filePath } = ctx;
  if (!src) return;
  const vaultRelPath = resolveVaultPath(src, filePath);
  let content: string;
  try {
    content = await useVaultStore.getState().readFile(vaultRelPath);
  } catch { return; }
  if (!content.trim()) return;

  let svg: string;
  try {
    const id = `mermaid-export-${Math.random().toString(36).slice(2)}`;
    const rendered = await mermaid.render(id, content.trim());
    svg = rendered.svg;
  } catch { return; }

  // ponytail: stash the raw SVG on a data attribute. renderFilePreviewToSvg
  // prefers this over svgEl.outerHTML — HTML serialization (outerHTML)
  // rewrites U+00A0 to &nbsp; and breaks standalone XML parsing of the
  // exported .svg. The visible innerHTML stays for HTML export embedding.
  body.setAttribute('data-raw-svg', svg);
  body.innerHTML = `<div style="display:flex;justify-content:center;padding:16px 12px;overflow-x:auto">${svg}</div>`;
  const svgEl = body.querySelector<SVGSVGElement>('svg');
  if (svgEl) {
    svgEl.style.maxWidth = '100%';
    svgEl.style.height = 'auto';
  }
}
