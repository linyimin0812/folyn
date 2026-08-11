/**
 * graphviz file-preview export: re-fetch the SVG from quickchart.io and inject
 * it as a self-contained <svg> into the body. Mirrors plantuml.ts.
 *
 * The in-app preview renders via ZoomPanCanvas as an <img src="blob:...">,
 * which doesn't leave an <svg> element behind for the export fallback to grab
 * — so we re-render from the source file (same path the preview resolved) and
 * replace the body.
 *
 * DOT source goes in a JSON POST body — no deflate+base64 encoding needed
 * (unlike plantuml).
 */

import { useVaultStore } from '@/store/vaultStore';
import { resolveVaultPath } from './shared';
import type { EnhanceCtx } from './dbml';

const QUICKCHART_ENDPOINT = 'https://quickchart.io/graphviz';

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
    const r = await fetch(QUICKCHART_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'svg', graph: content }),
    });
    svg = await r.text();
  } catch { return; }
  // ponytail: quickchart.io returns a standalone SVG document with XML prolog + DOCTYPE, so check for <svg substring instead of startsWith
  if (!/<svg\b/.test(svg)) return;

  // ponytail: stash the raw SVG returned by quickchart.io on a data attribute.
  // renderFilePreviewToSvg prefers this over svgEl.outerHTML — HTML
  // serialization (outerHTML) rewrites U+00A0 to &nbsp; and breaks standalone
  // XML parsing of the exported .svg ("Entity 'nbsp' not defined"). The
  // attribute value is HTML-escaped on serialization and decoded on read, so
  // the original SVG bytes survive byte-for-byte. The visible innerHTML
  // stays for HTML export embedding (HTML accepts &nbsp; fine).
  body.setAttribute('data-raw-svg', svg);
  body.innerHTML = `<div style="display:flex;justify-content:center;padding:16px 12px;overflow-x:auto">${svg}</div>`;
  const svgEl = body.querySelector<SVGSVGElement>('svg');
  if (svgEl) {
    svgEl.style.maxWidth = '100%';
    svgEl.style.height = 'auto';
  }
}
