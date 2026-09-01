import { useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { themeCss } from '@/editor/codeThemes';
import { useVaultStore } from '@/store/vaultStore';
import {
  renderMarkdownToHtmlViaDom,
  HTML_STYLES,
  CONTAINER_INTERACT_SCRIPT,
  RESIZABLE_MEDIA_OVERRIDE,
  IMAGE_LIGHTBOX_SCRIPT,
  LIGHT_THEME_VARS,
  DARK_THEME_VARS,
  hasContainerSyntax,
} from '@/services/exportService';
import type { ExportFormat } from '@/services/exportService';
import {
  inlineImages,
  downloadBlob,
  escapeHtml,
  renderFilePreviewToSvg,
  svgToPngBlob,
  ASSET_URL_SRC_REGEX,
  assetUrlToFilePath,
} from '@/services/export/shared';
import { richTextToHtmlBlob } from '@/services/export/richtext';
import { renderMarkmapSvg } from '@/services/export/markmapShared';
import { resolveAssetBase } from '@/components/file-types/previewPath';
import { getHandlerById } from '@/components/file-types/registry';
import { externalFileProvider } from '@/services/externalFileProvider';
import { isExternalPath } from '@/utils/isExternalPath';
import { WIKI_PREFIX } from '@/types/wiki';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getProvider } from '@/services/storage/registry';
import type { ProviderConfig } from '@/services/storage/types';

export type { ExportFormat };
export { hasContainerSyntax };

export interface ActiveDocument {
  name: string;
  content: string;
  path: string;
  vaultRoot: string;
  fileType: string;
}

/**
 * Build a `:root` override block carrying the user's live UI font + size CSS
 * variables, so exported HTML renders with the same interface font the user
 * picked in Appearance settings (instead of the hardcoded 'Sora' fallback
 * baked into LIGHT/DARK_THEME_VARS). Reads the runtime style set by
 * appearanceStore.setFontFamily / setFontSize; empty values (defaults, or a
 * non-browser caller) fall back to the theme-vars default by emitting nothing.
 */
function runtimeFontVars(): string {
  const root = document.documentElement.style;
  const fontFamily = root.getPropertyValue('--font-ui').trim();
  const fontSize = root.getPropertyValue('--ui-font-size').trim();
  const rules: string[] = [];
  if (fontFamily) rules.push(`--font-ui: ${fontFamily};`);
  if (fontSize) rules.push(`--ui-font-size: ${fontSize};`);
  return rules.length ? `:root { ${rules.join(' ')} }` : '';
}

/**
 * Read the active document from stores. Extracted so non-React callers (e.g.
 * the command palette's export commands) can access the same source of truth
 * without a hook.
 */
export function getActiveDocument(): ActiveDocument {
  const { tabs, activeTabId } = useEditorStore.getState();
  const { currentVault } = useVaultStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  return {
    name: tab?.name ?? 'untitled.md',
    content: tab?.content ?? '',
    path: tab?.path ?? '',
    vaultRoot: currentVault?.basePath ?? '',
    fileType: tab?.fileType ?? '',
  };
}

/** Export the active document as Markdown. Imperative; callable outside React. */
export function exportActiveMarkdown(onBeforeDialog?: () => void): void {
  const { name, content } = getActiveDocument();
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  onBeforeDialog?.();
  void downloadBlob(blob, name, ['md']);
}

/** Read raw bytes for a binary (needsFileContent=false) tab. Routes by path
 *  shape — external paths go through externalFileProvider, vault paths
 *  through the vault manager's byte-preserving read. Wiki paths never hit
 *  this branch (wiki is text-only). */
async function readActiveBytes(path: string): Promise<Uint8Array> {
  if (isExternalPath(path)) {
    return externalFileProvider.readFileBytes(path);
  }
  if (path.startsWith(WIKI_PREFIX)) {
    // ponytail: wiki is text-only; office/binary types never open from wiki.
    // If we ever get here, UTF-8 round-trip is acceptable.
    const { wikiProvider } = await import('@/services/wikiProvider');
    const text = await wikiProvider.readFile(path.slice(WIKI_PREFIX.length));
    return new TextEncoder().encode(text);
  }
  return useVaultStore.getState().manager.readFileBytes(path);
}

/**
 * Export the active document as its raw source — works for both text
 * editor-backed files (uses tab.content, including unsaved edits) and
 * binary/preview-only files (reads raw bytes from disk; office handler
 * sets needsFileContent=false so tab.content stays empty by design).
 */
export async function exportActiveSource(onBeforeDialog?: () => void): Promise<void> {
  const { name, content, path, fileType } = getActiveDocument();
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const handler = getHandlerById(fileType);
  if (handler && !handler.needsFileContent) {
    if (!path) return;
    try {
      const bytes = await readActiveBytes(path);
      const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
      onBeforeDialog?.();
      await downloadBlob(blob, name, ext ? [ext] : undefined);
    } catch (err) {
      console.error('[export] exportActiveSource (binary) failed:', err);
    }
    return;
  }
  const mime = ext === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
  const blob = new Blob([content], { type: mime });
  onBeforeDialog?.();
  await downloadBlob(blob, name, ext ? [ext] : undefined);
}

/** Export a canvas-backed file (dbml/excalidraw/drawio/markmap) as SVG. */
export async function exportActiveSvg(onBeforeDialog?: () => void): Promise<void> {
  const { name, path, vaultRoot } = getActiveDocument();
  const svg = await renderFilePreviewToSvg(path, vaultRoot);
  if (!svg) return;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  onBeforeDialog?.();
  const baseName = name.replace(/\.[^.]+$/, '');
  await downloadBlob(blob, `${baseName}.svg`, ['svg']);
}

/** Export a canvas-backed file (dbml/excalidraw/drawio/markmap) as PNG. */
export async function exportActivePng(onBeforeDialog?: () => void): Promise<void> {
  const { name, path, vaultRoot } = getActiveDocument();
  const svg = await renderFilePreviewToSvg(path, vaultRoot);
  if (!svg) return;
  const png = await svgToPngBlob(svg, 3);
  if (!png) return;
  onBeforeDialog?.();
  const baseName = name.replace(/\.[^.]+$/, '');
  await downloadBlob(png, `${baseName}.png`, ['png']);
}

/** Export the active markdown doc's headings as a markmap mind-map SVG. */
export async function exportActiveMarkmapSvg(onBeforeDialog?: () => void): Promise<void> {
  const { name, content, path, vaultRoot } = getActiveDocument();
  const assetBase = path
    ? await resolveAssetBase(path, vaultRoot).catch(() => null)
    : null;
  const svgEl = await renderMarkmapSvg(content, assetBase);
  const svg = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  onBeforeDialog?.();
  const baseName = name.replace(/\.[^.]+$/, '');
  await downloadBlob(blob, `${baseName}.svg`, ['svg']);
}

/** Export the active document as a standalone HTML file. Imperative. */
export async function exportActiveHtml(onBeforeDialog?: () => void): Promise<void> {
  const { name, content, path, vaultRoot } = getActiveDocument();
  // Resolve app theme to light/dark at call time — appearanceStore.theme can
  // be 'system', so we look at documentElement.dataset.theme which the store
  // has already resolved to the actual applied theme.
  const theme: 'light' | 'dark' =
    (document.documentElement.dataset.theme as 'light' | 'dark') === 'dark' ? 'dark' : 'light';
  const themeVars = theme === 'dark' ? DARK_THEME_VARS : LIGHT_THEME_VARS;
  const codeTheme = useAppearanceStore.getState().codeTheme;
  const codeThemeCss = codeTheme === 'auto' ? '' : themeCss(codeTheme);
  const { html: renderedBody, css } = await renderMarkdownToHtmlViaDom(content, path, vaultRoot, theme);
  const inlinedBody = await inlineImages(renderedBody, vaultRoot, path);
  const bodyBg = theme === 'dark' ? '#0b0d14' : '#fff';
  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}" data-code-theme="${codeTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name.replace(/\.md$/, ''))}</title>
  <style>${HTML_STYLES}\n${themeVars}\n${codeThemeCss}\n${runtimeFontVars()}\n${css}\n/* ponytail: app CSS dumps html,body{overflow:hidden;height:100%;background:var(--bg)} — override so the exported page scrolls natively and the 800px column is centered against the theme's viewport bg. */\nhtml, body { height: auto !important; min-height: 100vh !important; overflow: auto !important; background: ${bodyBg} !important; }\nbody { display: flex !important; justify-content: center !important; align-items: flex-start !important; max-width: none !important; margin: 0 !important; padding: 40px 20px !important; }\n.md-preview { max-width: 800px; width: 100%; }\n${RESIZABLE_MEDIA_OVERRIDE}\n</style>
  <script>${CONTAINER_INTERACT_SCRIPT}</script>
  <script>${IMAGE_LIGHTBOX_SCRIPT}</script>
</head>
<body>
${inlinedBody}
</body>
</html>`;
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  onBeforeDialog?.();
  await downloadBlob(blob, name.replace(/\.md$/, '.html'), ['html']);
}

/** Export a rich-text (.richtext) doc as a standalone HTML file. */
export async function exportActiveRichTextHtml(onBeforeDialog?: () => void): Promise<void> {
  const { name, content, vaultRoot } = getActiveDocument();
  if (!content) return;
  const blob = await richTextToHtmlBlob(content, name, vaultRoot);
  onBeforeDialog?.();
  const baseName = name.replace(/\.[^.]+$/, '');
  await downloadBlob(blob, `${baseName}.html`, ['html']);
}

/**
 * Share the active markdown doc as HTML to the configured storage
 * provider. Returns the public URL. Caller writes it to clipboard and
 * surfaces a toast.
 *
 * ponytail: mirrors exportActiveHtml up to the HTML assembly, then
 * swaps the final `downloadBlob` for `provider.uploadHtml`. Image
 * handling follows the global `htmlImageMode` setting:
 *   - 'inline' (default): existing `inlineImages()` → data URIs
 *   - 'upload': walk vault-file:// <img> tags, upload each via the
 *     active provider, rewrite src to the public URL
 */
export async function shareActiveToCloud(): Promise<string> {
  const { name, content, path, vaultRoot, fileType } = getActiveDocument();
  const store = useStorageConfigStore.getState();
  const cfg = store.getActiveConfig();
  if (!cfg) {
    throw new Error('STORAGE_NOT_CONFIGURED');
  }
  const provider = getProvider(store.activeProvider);
  if (!provider.capabilities.html) {
    throw new Error('STORAGE_NO_HTML_CAPABILITY');
  }

  const htmlContent = await buildShareableHtml(name, content, path, vaultRoot, fileType, store, cfg, provider);
  return provider.uploadHtml(htmlContent, cfg);
}

/**
 * Build the shareable HTML payload for the active document, dispatching on
 * fileType:
 *  - markdown: render → inline/upload images → wrap in styled shell
 *  - rich-text: richTextToHtmlBlob already returns a full HTML doc
 *  - canvas types (dbml/excalidraw/drawio/markmap/plantuml/graphviz/mermaid):
 *    render preview SVG, wrap in a minimal centered-HTML shell so the
 *    shared URL serves a viewable web page.
 */
async function buildShareableHtml(
  name: string,
  content: string,
  path: string,
  vaultRoot: string,
  fileType: string,
  store: ReturnType<typeof useStorageConfigStore.getState>,
  cfg: ProviderConfig,
  provider: ReturnType<typeof getProvider>,
): Promise<string> {
  const CANVAS_TYPES = new Set(['dbml', 'excalidraw', 'drawio', 'markmap', 'plantuml', 'graphviz', 'mermaid']);

  if (fileType === 'rich-text') {
    const blob = await richTextToHtmlBlob(content, name, vaultRoot);
    return blob.text();
  }

  if (CANVAS_TYPES.has(fileType)) {
    const svg = await renderFilePreviewToSvg(path, vaultRoot);
    if (!svg) throw new Error('SHARE_NO_SVG');
    const baseName = escapeHtml(name.replace(/\.[^.]+$/, ''));
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${baseName}</title>
  <style>html, body { margin: 0; padding: 24px; background: #fff; } body { display: flex; justify-content: center; } svg { max-width: 100%; height: auto; }</style>
</head>
<body>
${svg}
</body>
</html>`;
  }

  // markdown (default)
  const theme: 'light' | 'dark' =
    (document.documentElement.dataset.theme as 'light' | 'dark') === 'dark' ? 'dark' : 'light';
  const themeVars = theme === 'dark' ? DARK_THEME_VARS : LIGHT_THEME_VARS;
  const codeTheme = useAppearanceStore.getState().codeTheme;
  const codeThemeCss = codeTheme === 'auto' ? '' : themeCss(codeTheme);
  // ponytail: in upload mode, skip the inline-asset-URLs-as-data-URI pass
  // so `uploadImagesToProvider` can still see `asset://` srcs, upload each
  // image to the provider, and rewrite src to the public URL — instead of
  // getting HTML back with already-base64 images and a no-op regex.
  const { html: renderedBody, css } = await renderMarkdownToHtmlViaDom(
    content, path, vaultRoot, theme,
    { inlineImages: store.htmlImageMode !== 'upload' },
  );

  let body: string;
  if (store.htmlImageMode === 'inline') {
    body = await inlineImages(renderedBody, vaultRoot, path);
  } else {
    body = await uploadImagesToProvider(renderedBody, provider, cfg);
  }

  const bodyBg = theme === 'dark' ? '#0b0d14' : '#fff';
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}" data-code-theme="${codeTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name.replace(/\.md$/, ''))}</title>
  <style>${HTML_STYLES}\n${themeVars}\n${codeThemeCss}\n${runtimeFontVars()}\n${css}\nhtml, body { height: auto !important; min-height: 100vh !important; overflow: auto !important; background: ${bodyBg} !important; }\nbody { display: flex !important; justify-content: center !important; align-items: flex-start !important; max-width: none !important; margin: 0 !important; padding: 40px 20px !important; }\n.md-preview { max-width: 800px; width: 100%; }\n${RESIZABLE_MEDIA_OVERRIDE}\n</style>
  <script>${CONTAINER_INTERACT_SCRIPT}</script>
  <script>${IMAGE_LIGHTBOX_SCRIPT}</script>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Upload the active file's raw bytes to the configured storage provider's
 * image host. Returns the public URL.
 *
 * Used by both the image-tab share menu (png/jpg/svg/...) and the
 * source-tab share menu (code/csv/json/html/office/web — file types
 * without specialized rendering). Reuses `provider.uploadImage(bytes, ext,
 * cfg)` so the SHA1-based object key and content-type mapping are shared
 * with the paste-image flow.
 *
 * Bytes source: prefer `tab.content` (already in memory for text types
 * like code/json/html/svg), fall back to `readActiveBytes(path)` for
 * binary types (image/office) where content is empty by design.
 */
export async function shareActiveBytesToCloud(): Promise<string> {
  const { name, content, path } = getActiveDocument();
  const store = useStorageConfigStore.getState();
  const cfg = store.getActiveConfig();
  if (!cfg) {
    throw new Error('STORAGE_NOT_CONFIGURED');
  }
  const provider = getProvider(store.activeProvider);
  if (!provider.capabilities.image) {
    throw new Error('STORAGE_NO_IMAGE_CAPABILITY');
  }

  const ext = (name.split('.').pop() ?? 'bin').toLowerCase();

  let bytes: Uint8Array;
  if (content) {
    bytes = new TextEncoder().encode(content);
  } else if (path) {
    bytes = await readActiveBytes(path);
  } else {
    throw new Error('SHARE_NO_PATH');
  }

  return provider.uploadImage(bytes, ext, cfg);
}

/**
 * Walk all `asset://localhost/<path>` (or `http(s)://asset.localhost/<path>`)
 * `<img>` srcs in `html`, upload each referenced local file to the active
 * provider, and rewrite the src to the returned public URL.
 *
 * Sister to `inlineImages` / `inlineContainerImages` (services/export/shared.ts):
 * same idea — find local-asset <img> srcs, upload instead of inlining. The
 * caller must have rendered the markdown with `inlineImages: false` so the
 * srcs are still `asset://...` (otherwise `inlineContainerImages` already
 * replaced them with data URIs and this regex matches nothing).
 *
 * ponytail: dedupes unique srcs so a doc with 10 references to the same
 * image uploads it once. Ceiling: sequential uploads, no batching — R2/OSS
 * PUTs are independent so a Promise.all batch would scale, but we'd need
 * retry + concurrency limits we don't need yet.
 */
async function uploadImagesToProvider(
  html: string,
  provider: ReturnType<typeof getProvider>,
  cfg: ProviderConfig,
): Promise<string> {
  const matches = [...html.matchAll(ASSET_URL_SRC_REGEX)];
  if (matches.length === 0) return html;

  const { readFile } = await import('@tauri-apps/plugin-fs');
  const uniqueSrcs = [...new Set(matches.map((m) => m[1]))];

  const replacements = await Promise.all(
    uniqueSrcs.map(async (src) => {
      const absPath = assetUrlToFilePath(src);
      if (!absPath) return null;
      try {
        const bytes = await readFile(absPath);
        const ext = absPath.split('.').pop()?.toLowerCase() ?? 'png';
        const url = await provider.uploadImage(new Uint8Array(bytes), ext, cfg);
        return { original: src, url };
      } catch {
        // Leave the original asset:// src — a broken img (outside the app)
        // is preferable to a failed share. Caller can surface a toast.
        return null;
      }
    }),
  );

  let result = html;
  for (const r of replacements) {
    if (r) result = result.replaceAll(r.original, r.url);
  }
  return result;
}

/**
 * React hook facade over the imperative export functions. Reads from stores at
 * call time so the returned callbacks always reflect the latest active tab and
 * vault without depending on render-captured state. Kept for component
 * consumers (e.g. {@link ExportMenu}) that prefer hook-style access.
 */
export function useExport() {
  const exportMarkdown = useCallback((onBeforeDialog?: () => void) => exportActiveMarkdown(onBeforeDialog), []);
  const exportSource = useCallback((onBeforeDialog?: () => void) => exportActiveSource(onBeforeDialog), []);
  const exportHtml = useCallback((onBeforeDialog?: () => void) => exportActiveHtml(onBeforeDialog), []);
  const exportRichTextHtml = useCallback((onBeforeDialog?: () => void) => exportActiveRichTextHtml(onBeforeDialog), []);
  const exportSvg = useCallback((onBeforeDialog?: () => void) => exportActiveSvg(onBeforeDialog), []);
  const exportPng = useCallback((onBeforeDialog?: () => void) => exportActivePng(onBeforeDialog), []);
  const exportMarkmap = useCallback((onBeforeDialog?: () => void) => exportActiveMarkmapSvg(onBeforeDialog), []);
  const shareToCloud = useCallback(() => shareActiveToCloud(), []);
  const shareBytesToCloud = useCallback(() => shareActiveBytesToCloud(), []);
  const getActiveContent = useCallback(
    () => {
      const { name, content, path } = getActiveDocument();
      return { name, content, path };
    },
    [],
  );
  return { exportMarkdown, exportSource, exportHtml, exportRichTextHtml, exportSvg, exportPng, exportMarkmap, shareToCloud, shareBytesToCloud, getActiveContent };
}
