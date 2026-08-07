import { useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useVaultStore } from '@/store/vaultStore';
import {
  renderMarkdownToHtmlViaDom,
  HTML_STYLES,
  CONTAINER_INTERACT_SCRIPT,
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
} from '@/services/export/shared';
import { mmapToXmindBlob } from '@/services/export/xmind';
import { richTextToHtmlBlob } from '@/services/export/richtext';
import { getHandlerById } from '@/components/file-types/registry';
import { externalFileProvider } from '@/services/externalFileProvider';
import { isExternalPath } from '@/utils/isExternalPath';
import { WIKI_PREFIX } from '@/types/wiki';

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

/** Export a canvas-backed file (dbml/excalidraw/drawio/mmap) as SVG. */
export async function exportActiveSvg(onBeforeDialog?: () => void): Promise<void> {
  const { name, path, vaultRoot } = getActiveDocument();
  const svg = await renderFilePreviewToSvg(path, vaultRoot);
  if (!svg) return;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  onBeforeDialog?.();
  const baseName = name.replace(/\.[^.]+$/, '');
  await downloadBlob(blob, `${baseName}.svg`, ['svg']);
}

/** Export an mmap file as XMind (.xmind) format. */
export async function exportActiveXmind(onBeforeDialog?: () => void): Promise<void> {
  const { name, content } = getActiveDocument();
  if (!content) return;
  const baseName = name.replace(/\.[^.]+$/, '');
  const blob = await mmapToXmindBlob(content, baseName);
  onBeforeDialog?.();
  await downloadBlob(blob, `${baseName}.xmind`, ['xmind']);
}

/** Export a canvas-backed file (dbml/excalidraw/drawio/mmap) as PNG. */
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

/** Export the active document as a standalone HTML file. Imperative. */
export async function exportActiveHtml(onBeforeDialog?: () => void): Promise<void> {
  const { name, content, path, vaultRoot } = getActiveDocument();
  // Resolve app theme to light/dark at call time — appearanceStore.theme can
  // be 'system', so we look at documentElement.dataset.theme which the store
  // has already resolved to the actual applied theme.
  const theme: 'light' | 'dark' =
    (document.documentElement.dataset.theme as 'light' | 'dark') === 'dark' ? 'dark' : 'light';
  const themeVars = theme === 'dark' ? DARK_THEME_VARS : LIGHT_THEME_VARS;
  const { html: renderedBody, css } = await renderMarkdownToHtmlViaDom(content, path, vaultRoot, theme);
  const inlinedBody = await inlineImages(renderedBody, vaultRoot, path);
  const bodyBg = theme === 'dark' ? '#0b0d14' : '#fff';
  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name.replace(/\.md$/, ''))}</title>
  <style>${HTML_STYLES}\n${themeVars}\n${css}\n/* ponytail: app CSS dumps html,body{overflow:hidden;height:100%;background:var(--bg)} — override so the exported page scrolls natively and the 800px column is centered against the theme's viewport bg. */\nhtml, body { height: auto !important; min-height: 100vh !important; overflow: auto !important; background: ${bodyBg} !important; }\nbody { display: flex !important; justify-content: center !important; align-items: flex-start !important; max-width: none !important; margin: 0 !important; padding: 40px 20px !important; }\n.md-preview { max-width: 800px; width: 100%; }\n</style>
  <script>${CONTAINER_INTERACT_SCRIPT}</script>
</head>
<body>
${inlinedBody}
</body>
</html>`;
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  onBeforeDialog?.();
  await downloadBlob(blob, name.replace(/\.md$/, '.html'), ['html']);
}

/** Export a rich-text (.rt) doc as a standalone HTML file. */
export async function exportActiveRichTextHtml(onBeforeDialog?: () => void): Promise<void> {
  const { name, content, vaultRoot } = getActiveDocument();
  if (!content) return;
  const blob = await richTextToHtmlBlob(content, name, vaultRoot);
  onBeforeDialog?.();
  const baseName = name.replace(/\.[^.]+$/, '');
  await downloadBlob(blob, `${baseName}.html`, ['html']);
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
  const exportXmind = useCallback((onBeforeDialog?: () => void) => exportActiveXmind(onBeforeDialog), []);
  const getActiveContent = useCallback(
    () => {
      const { name, content, path } = getActiveDocument();
      return { name, content, path };
    },
    [],
  );
  return { exportMarkdown, exportSource, exportHtml, exportRichTextHtml, exportSvg, exportPng, exportXmind, getActiveContent };
}
