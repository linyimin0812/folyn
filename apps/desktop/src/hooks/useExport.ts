import { useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useVaultStore } from '@/store/vaultStore';
import {
  renderMarkdownToHtmlViaDom,
  inlineImages,
  downloadBlob,
  escapeHtml,
  HTML_STYLES,
  LIGHT_THEME_VARS,
  DARK_THEME_VARS,
  renderFilePreviewToSvg,
  svgToPngBlob,
} from '@/services/exportService';

export type { ExportFormat } from '@/services/exportService';
export { hasContainerSyntax } from '@/services/exportService';

export interface ActiveDocument {
  name: string;
  content: string;
  path: string;
  vaultRoot: string;
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
  };
}

/** Export the active document as Markdown. Imperative; callable outside React. */
export function exportActiveMarkdown(onBeforeDialog?: () => void): void {
  const { name, content } = getActiveDocument();
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  onBeforeDialog?.();
  void downloadBlob(blob, name, ['md']);
}

/**
 * Export the active document as its raw source — works for any text-based
 * file type. Downloads with the original filename and extension.
 */
export function exportActiveSource(onBeforeDialog?: () => void): void {
  const { name, content } = getActiveDocument();
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const mime = ext === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
  const blob = new Blob([content], { type: mime });
  onBeforeDialog?.();
  void downloadBlob(blob, name, ext ? [ext] : undefined);
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
</head>
<body>
${inlinedBody}
</body>
</html>`;
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  onBeforeDialog?.();
  await downloadBlob(blob, name.replace(/\.md$/, '.html'), ['html']);
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
  const exportSvg = useCallback((onBeforeDialog?: () => void) => exportActiveSvg(onBeforeDialog), []);
  const exportPng = useCallback((onBeforeDialog?: () => void) => exportActivePng(onBeforeDialog), []);
  const getActiveContent = useCallback(
    () => {
      const { name, content, path } = getActiveDocument();
      return { name, content, path };
    },
    [],
  );
  return { exportMarkdown, exportSource, exportHtml, exportSvg, exportPng, getActiveContent };
}
