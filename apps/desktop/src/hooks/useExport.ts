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
export function exportActiveMarkdown(): void {
  const { name, content } = getActiveDocument();
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, name, ['md']);
}

/** Export the active document as a standalone HTML file. Imperative. */
export async function exportActiveHtml(): Promise<void> {
  const { name, content, path, vaultRoot } = getActiveDocument();
  const { html: renderedBody, css } = await renderMarkdownToHtmlViaDom(content, path, vaultRoot);
  const inlinedBody = await inlineImages(renderedBody, vaultRoot, path);
  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name.replace(/\.md$/, ''))}</title>
  <style>${HTML_STYLES}\n${LIGHT_THEME_VARS}\n${css}\n/* ponytail: app CSS dumps html,body{overflow:hidden;height:100%} because the app uses internal scroll containers. Override so the exported page scrolls natively. */\nhtml, body { height: auto !important; min-height: 0 !important; overflow: auto !important; }\n</style>
</head>
<body>
${inlinedBody}
</body>
</html>`;
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, name.replace(/\.md$/, '.html'), ['html']);
}

/**
 * React hook facade over the imperative export functions. Reads from stores at
 * call time so the returned callbacks always reflect the latest active tab and
 * vault without depending on render-captured state. Kept for component
 * consumers (e.g. {@link ExportMenu}) that prefer hook-style access.
 */
export function useExport() {
  const exportMarkdown = useCallback(() => exportActiveMarkdown(), []);
  const exportHtml = useCallback(() => {
    void exportActiveHtml();
  }, []);
  const getActiveContent = useCallback(
    () => {
      const { name, content, path } = getActiveDocument();
      return { name, content, path };
    },
    [],
  );
  return { exportMarkdown, exportHtml, getActiveContent };
}
