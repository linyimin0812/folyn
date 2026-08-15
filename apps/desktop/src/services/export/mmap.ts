// ponytail: render a standalone markmap SVG from the .mmap source for
// export. The in-DOM MarkmapPreview also renders an SVG, but the export
// body may be in a different container / theme state — re-render from the
// file's on-disk content so the exported SVG is self-contained and matches
// the source exactly (see markmapShared.renderMarkmapSvg).

import { readFileByRoute } from '@/services/editorIoService';
import { resolveVaultPath } from './shared';
import type { EnhanceCtx } from './dbml';
import { resolveAssetBase } from '@/components/file-types/previewPath';
import { renderMarkmapSvg } from './markmapShared';

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
  const svg = await renderMarkmapSvg(content, assetBase);
  body.innerHTML = '';
  body.appendChild(svg);

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
