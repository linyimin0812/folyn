/**
 * plantuml file-preview export: re-fetch the SVG from plantuml.com and inject
 * it as a self-contained <svg> into the body. The in-app preview renders via
 * ZoomPanCanvas as an <img src="blob:...">, which doesn't leave an <svg>
 * element behind for the export fallback to grab — so we re-render from the
 * source file (same path the preview resolved) and replace the body.
 *
 * Mirrors dbml/excalidraw/drawio/markmap exporters: read source via vault store,
 * render to SVG, set body.innerHTML. Failures fall through silently to the
 * "不支持导出" card in exportService.ts.
 */

import { useVaultStore } from '@/store/vaultStore';
import { resolveVaultPath } from './shared';
import { encodePlantUml } from '@mochi/container-plugins';
import type { EnhanceCtx } from './dbml';

const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg/';

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
    const encoded = await encodePlantUml(content);
    const r = await fetch(`${PLANTUML_SERVER}${encoded}`);
    svg = await r.text();
  } catch { return; }
  if (!svg.startsWith('<svg')) return;

  // ponytail: stash the raw SVG returned by plantuml.com on a data attribute.
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
