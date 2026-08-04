/**
 * Shared utilities for the export pipeline. Pure helpers — no per-file-type
 * logic, no dependency on the main pipeline (renderMarkdownToHtmlViaDom is
 * pulled via dynamic import by renderFilePreviewToSvg to avoid an ESM cycle).
 */

import { readFile } from '@tauri-apps/plugin-fs';
import { resolveBasePath } from '@/utils/pathResolver';

/**
 * Resolve a vault-relative path the same way FilePreviewPlugin does, so
 * per-type enhancers can re-read source files by the same path the preview
 * used. ponytail: duplicated 5-line resolveVaultPath from
 * FilePreviewPlugin.tsx — two packages, different build graphs, sharing it
 * isn't worth a new dep.
 */
export function resolveVaultPath(src: string, filePath: string): string {
  if (src.startsWith('/') || src.startsWith('~')) return src;
  if (
    !src.startsWith('./') && !src.startsWith('.\\') &&
    !src.startsWith('../') && !src.startsWith('..\\')
  ) {
    return src;
  }
  const fileDir = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  const segments = fileDir.split('/').filter(Boolean);
  const parts = src.replace(/\\/g, '/').split('/').filter((s) => s !== '.' && s !== '');
  for (const seg of parts) {
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}

/**
 * Rasterize an SVG string to a PNG Blob via canvas. Parses width/height
 * (or viewBox fallback) since exported SVGs use width="100%" which yields
 * naturalWidth=0 when loaded into an Image.
 */
export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob | null> {
  const wMatch = svg.match(/\bwidth="([^"]+)"/);
  const hMatch = svg.match(/\bheight="([^"]+)"/);
  let w = wMatch ? parseInt(wMatch[1], 10) || 0 : 0;
  let h = hMatch ? parseInt(hMatch[1], 10) || 0 : 0;
  // ponytail: mmap.ts / dbml.ts / excalidraw.ts all set width/height to "100%"
  // for fit-to-container preview. parseInt("100%")=100 — passes the !w check
  // but yields a 100×100 PNG instead of native SVG dims. Treat any % value
  // as "unresolved" and fall through to viewBox.
  const wIsPct = wMatch && wMatch[1].includes('%');
  const hIsPct = hMatch && hMatch[1].includes('%');
  if (!w || !h || wIsPct || hIsPct) {
    const vb = svg.match(/viewBox="([^"]+)"/);
    if (vb) {
      const parts = vb[1].split(/[\s,]+/).map(Number);
      if (wIsPct || !w) w = parts[2] || 0;
      if (hIsPct || !h) h = parts[3] || 0;
    }
  }
  w = w || 800;
  h = h || 600;
  const sizedSvg = svg
    .replace(/\bwidth="[^"]*"/, `width="${w}"`)
    .replace(/\bheight="[^"]*"/, `height="${h}"`);
  const blob = new Blob([sizedSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('svg load failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Walk all <image> elements (SVG namespace) inside `container` and replace
 * Tauri asset URLs (any non-data, non-http src) in both `href` and
 * `xlink:href` with base64 data URLs. Used by the mmap enhancer —
 * mind-elixir's exported SVG (inlineContainerImages runs before mind-elixir
 * mounts, so it misses the mmap image elements).
 */
export async function inlineSvgImages(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('image'));
  await Promise.all(
    imgs.map(async (img) => {
      const href = img.getAttribute('href') ?? img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
      if (!href || href.startsWith('data:') || href.startsWith('http')) return;
      try {
        const res = await fetch(href);
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(blob);
        });
        img.setAttribute('href', dataUrl);
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dataUrl);
      } catch { /* leave original href */ }
    }),
  );
}

/**
 * Walk all <img> elements in a container and replace Tauri asset URLs with
 * base64 data URLs. Skips http(s) and data: URLs. Mutates the DOM in place.
 */
export async function inlineContainerImages(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') ?? '';
      if (!src || src.startsWith('data:') || src.startsWith('http')) return;
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(blob);
        });
        img.setAttribute('src', dataUrl);
      } catch {
        // leave the original src — better a broken img than a failed export
      }
    }),
  );
}

/**
 * Read a local image file and return it as a base64 data URL.
 */
export async function readImageAsDataUrl(filePath: string): Promise<string> {
  try {
    const bytes = await readFile(filePath);
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png';
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    };
    const mime = mimeMap[ext] || 'image/png';
    const binary = Array.from(bytes).map((b) => String.fromCharCode(b)).join('');
    const base64 = btoa(binary);
    return `data:${mime};base64,${base64}`;
  } catch {
    return '';
  }
}

/**
 * Replace all vault-file:// image references with base64 data URLs
 * so the exported HTML is fully self-contained.
 * Image paths are resolved relative to the current document's directory.
 */
export async function inlineImages(html: string, vaultRoot: string, currentFilePath?: string): Promise<string> {
  const imgRegex = /<img\s[^>]*?src="vault-file:\/\/([^"]+?)"[^>]*?\/?>/gi;
  const matches = [...html.matchAll(imgRegex)];
  if (matches.length === 0) return html;

  const resolvedRoot = await resolveBasePath(vaultRoot);
  const fileDir = currentFilePath
    ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
    : '';
  const uniquePaths = [...new Set(matches.map((m) => m[1]))];

  const { join } = await import('@tauri-apps/api/path');
  const replacements = await Promise.all(
    uniquePaths.map(async (relativePath) => {
      const decoded = decodeURIComponent(relativePath.replace(/&amp;/g, '&'));
      const basePath = fileDir ? await join(resolvedRoot, fileDir) : resolvedRoot;
      const absPath = await join(basePath, decoded);
      const dataUrl = await readImageAsDataUrl(absPath);
      return { original: `vault-file://${relativePath}`, dataUrl };
    }),
  );

  let result = html;
  for (const { original, dataUrl } of replacements) {
    if (dataUrl) result = result.replaceAll(original, dataUrl);
  }
  return result;
}

export async function downloadBlob(blob: Blob, filename: string, extensions?: string[]) {
  const { isTauri } = await import('@/utils/platform');
  if (isTauri()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeFile } = await import('@tauri-apps/plugin-fs');
      const ext = extensions ?? [filename.split('.').pop() ?? '*'];
      const label = ext[0] === '*' ? 'All Files' : ext[0].toUpperCase();
      const filePath = await save({
        defaultPath: filename,
        filters: [{ name: label, extensions: ext }],
      });
      if (filePath) {
        const arrayBuffer = await blob.arrayBuffer();
        await writeFile(filePath, new Uint8Array(arrayBuffer));
        // Show a brief success notification
        showExportNotification(`已保存到 ${filePath}`);
      }
    } catch (error) {
      console.error('[Export] Save failed:', error);
    }
    return;
  }
  // Browser fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render a non-markdown file (dbml/excalidraw/drawio/mmap) to a standalone
 * SVG string. Builds a synthetic one-block markdown with a file-preview
 * directive pointing at the file, then runs the main
 * renderMarkdownToHtmlViaDom pipeline (which mounts the preview, stabilizes
 * async effects, and converts the body to SVG via processFilePreviews).
 * Extracts the resulting <svg> from the rendered HTML.
 *
 * ponytail: dynamic import of renderMarkdownToHtmlViaDom to avoid an ESM
 * cycle — shared.ts must not statically depend on exportService.ts (which
 * imports shared.ts). Same TDZ-safe pattern as editorStore<->editorIoService.
 */
export async function renderFilePreviewToSvg(
  filePath: string,
  vaultRoot: string,
): Promise<string> {
  const fileName = filePath.split('/').pop() ?? '';
  if (!fileName) return '';
  // src is resolved by FilePreviewPlugin relative to filePath's directory,
  // so "./filename" + the file's own path resolves back to itself.
  const syntheticMd = `:::file-preview{src="./${fileName}"}\n:::\n`;
  const { renderMarkdownToHtmlViaDom } = await import('../exportService');
  const { html } = await renderMarkdownToHtmlViaDom(syntheticMd, filePath, vaultRoot);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bodyEl = doc.querySelector('[data-file-preview-body]');
  if (!bodyEl) return '';
  // ponytail: drawio embeds its SVG as <img src="data:image/svg+xml;utf8,…">
  // for CSS isolation (inline SVG in HTML inherits host CSS into
  // foreignObject divs and breaks drawio's text layout — see
  // services/export/drawio.ts). Extract the raw SVG from the img src for
  // standalone .svg / .png export. Other types (mmap, excalidraw, dbml)
  // keep inline <svg>; fall through.
  let svgString = '';
  const imgEl = bodyEl.querySelector('img[src^="data:image/svg+xml"]');
  if (imgEl) {
    const src = imgEl.getAttribute('src') || '';
    const commaIdx = src.indexOf(',');
    if (commaIdx >= 0) {
      const dataBody = src.slice(commaIdx + 1);
      try { svgString = decodeURIComponent(dataBody); }
      catch { svgString = dataBody; }
    }
  }
  if (!svgString) {
    const svgEl = bodyEl.querySelector('svg');
    if (!svgEl) return '';
    svgString = svgEl.outerHTML;
  }
  // ponytail: mind-elixir's exportSvg emits <image xlink:href="..."> without
  // declaring xmlns:xlink on the root <svg>, so standalone XML parsers reject
  // it ("Namespace prefix xlink for href on image is not defined"). HTML
  // rendering is unaffected — only standalone .svg files break. Inject the
  // namespace declaration on the root when xlink: is referenced but missing.
  if (svgString.includes('xlink:') && !/\bxmlns:xlink=/.test(svgString)) {
    svgString = svgString.replace(
      /<svg\b([^>]*)>/,
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"$1>',
    );
  }
  if (!/\bxmlns=/.test(svgString)) {
    svgString = svgString.replace(
      /<svg\b([^>]*)>/,
      '<svg xmlns="http://www.w3.org/2000/svg"$1>',
    );
  }
  return svgString;
}

/** Show a temporary toast notification for export success */
function showExportNotification(message: string) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%);
    background: var(--surf2, #2a2d3e); color: var(--t1, #cdd6f4);
    padding: 10px 20px; border-radius: 8px; font-size: 13px;
    box-shadow: 0 4px 16px rgba(0,0,0,.3); z-index: 9999;
    animation: toast-in .3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s';
    toast.style.opacity = '0';
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 2500);
}
