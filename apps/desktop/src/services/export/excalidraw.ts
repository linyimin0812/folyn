/**
 * excalidraw file-preview export: replace the body with an SVG exported via
 * the excalidraw library's exportToSvg API. Reads the .excalidraw file fresh,
 * parses elements/appState/files, and calls the library. Falls back to
 * filename card on any error.
 */

import { useVaultStore } from '@/store/vaultStore';
import { resolveVaultPath } from './shared';
import type { EnhanceCtx } from './dbml';

export async function enhance(body: HTMLElement, ctx: EnhanceCtx): Promise<void> {
  const { src, filePath } = ctx;
  if (!src) return;
  const vaultRelPath = resolveVaultPath(src, filePath);
  const json = await useVaultStore.getState().readFile(vaultRelPath);
  let parsed: { elements?: any[]; appState?: any; files?: any };
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  const { exportToSvg } = await import('@excalidraw/excalidraw');
  const svg = await exportToSvg({
    elements: parsed.elements ?? [],
    appState: { ...parsed.appState, exportWithDarkMode: false },
    files: parsed.files,
  });
  const svgString = new XMLSerializer().serializeToString(svg);
  body.innerHTML = svgString;
  // Inline the SVG so it scales to body width.
  const svgEl = body.querySelector('svg');
  if (svgEl) {
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
