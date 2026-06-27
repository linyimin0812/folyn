import { useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useVaultStore } from '@/store/vaultStore';
import html2pdf from 'html2pdf.js';
import {
  renderMarkdownToHtml,
  inlineImages,
  downloadBlob,
  escapeHtml,
  HTML_STYLES,
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
  downloadBlob(blob, name);
}

/** Export the active document as a standalone HTML file. Imperative. */
export async function exportActiveHtml(): Promise<void> {
  const { name, content, path, vaultRoot } = getActiveDocument();
  const renderedBody = renderMarkdownToHtml(content);
  const inlinedBody = await inlineImages(renderedBody, vaultRoot, path);
  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name.replace(/\.md$/, ''))}</title>
  <style>${HTML_STYLES}</style>
</head>
<body>
${inlinedBody}
</body>
</html>`;
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, name.replace(/\.md$/, '.html'));
}

/** Export the active document as PDF. Imperative; callable outside React. */
export async function exportActivePdf(): Promise<void> {
  const { name, content, path, vaultRoot } = getActiveDocument();
  const pdfTitle = name.replace(/\.md$/, '');

  try {
    const renderedBody = await inlineImages(renderMarkdownToHtml(content), vaultRoot, path);

    // Create an off-screen container that reuses the same HTML_STYLES as
    // the HTML export so the PDF looks identical to the preview.
    // Force light-theme CSS variables so the output is consistent regardless
    // of the user's current theme.
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;background:#fff;';
    container.innerHTML = `<div id="quill-pdf-root" data-theme="light">${renderedBody}</div>`;

    // Scope HTML_STYLES under #quill-pdf-root so they only affect the PDF content
    const scopedStyles = HTML_STYLES.replace(/^\s{4}body\s*\{/gm, '#quill-pdf-root {')
      .replace(/@media print\s*\{[^}]*\{[^}]*\}[^}]*\}/g, '');
    const styleEl = document.createElement('style');
    styleEl.textContent = scopedStyles;
    document.head.appendChild(styleEl);
    document.body.appendChild(container);

    // html2canvas cannot render CSS counter() / list-style markers,
    // so we manually inject visible numbers into the DOM.

    // 1) Steps container: inject number text and hide the ::before pseudo-element
    const stepNumbers = container.querySelectorAll('.docmd-step-number');
    stepNumbers.forEach((el, index) => {
      (el as HTMLElement).textContent = String(index + 1);
      (el as HTMLElement).style.setProperty('--step-injected', '1');
    });
    // 2) Ordered lists: html2canvas doesn't render list-style markers,
    //    so prepend visible number text to each <li>.
    const olElements = container.querySelectorAll('#quill-pdf-root ol');
    olElements.forEach((ol) => {
      const items = ol.querySelectorAll(':scope > li');
      items.forEach((li, idx) => {
        const numText = document.createTextNode(`${idx + 1}. `);
        // Insert the number text into the first <p> if present, otherwise into <li> directly
        const firstEl = li.firstElementChild;
        if (firstEl && firstEl.tagName === 'P') {
          firstEl.insertBefore(numText, firstEl.firstChild);
        } else {
          li.insertBefore(numText, li.firstChild);
        }
      });
      (ol as HTMLElement).style.listStyleType = 'none';
    });

    // Hide the CSS counter ::before on step numbers since we injected text
    const pdfFixStyle = document.createElement('style');
    pdfFixStyle.textContent = `
      .docmd-step-number[style*="--step-injected"]::before { content: none !important; }
    `;
    document.head.appendChild(pdfFixStyle);

    const cleanup = () => {
      document.body.removeChild(container);
      document.head.removeChild(styleEl);
      document.head.removeChild(pdfFixStyle);
    };

    const worker = html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        filename: `${pdfTitle}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(container.firstElementChild as HTMLElement);

    // In Tauri, generate blob and save via dialog; in browser, use default .save()
    const { isTauri: checkTauri } = await import('@/utils/platform');
    if (checkTauri()) {
      worker.outputPdf('blob').then(async (pdfBlob: Blob) => {
        cleanup();
        await downloadBlob(pdfBlob, `${pdfTitle}.pdf`);
      }).catch(() => cleanup());
    } else {
      worker.save().then(() => cleanup()).catch(() => cleanup());
    }
  } catch {
    // Swallow PDF generation errors so a failing export cannot crash the caller.
  }
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
  const exportPdf = useCallback(() => {
    void exportActivePdf();
  }, []);
  const getActiveContent = useCallback(
    () => {
      const { name, content, path } = getActiveDocument();
      return { name, content, path };
    },
    [],
  );
  return { exportMarkdown, exportHtml, exportPdf, getActiveContent };
}
