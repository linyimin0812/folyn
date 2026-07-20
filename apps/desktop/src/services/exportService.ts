import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { ContainerRegistry, registerBuiltinPlugins } from '@quill/container-plugins';
import type { ContainerProps } from '@quill/container-plugins';
import { readFile } from '@tauri-apps/plugin-fs';
import { resolveBasePath } from '@/utils/pathResolver';

// Ensure built-in plugins are registered once
registerBuiltinPlugins();

export type ExportFormat = 'markdown' | 'html';

/** Regex that matches Quill container directive syntax (:::) */
const CONTAINER_SYNTAX_REGEX = /^:{3,}\s*\w+/m;

/** Check whether markdown content uses container directives */
export function hasContainerSyntax(content: string): boolean {
  return CONTAINER_SYNTAX_REGEX.test(content);
}

/**
 * Build a component map from the ContainerRegistry for rehype-react.
 * This is the same approach used in MarkdownPreview.tsx so that export
 * output is identical to the in-app preview.
 */
export function buildExportComponentMap(): Record<string, React.ComponentType<any>> {
  const registry = ContainerRegistry.getInstance();
  const componentMap: Record<string, React.ComponentType<any>> = {};

  for (const plugin of registry.getAll()) {
    const PluginComponent = plugin.component;
    componentMap[plugin.name] = function DirectiveWrapper(props: any) {
      const { children, node, ...rest } = props;
      const nodeProperties = node?.properties ?? {};
      const mergedAttributes = { ...nodeProperties, ...rest };
      const containerProps: ContainerProps = {
        children,
        attributes: mergedAttributes,
        name: plugin.name,
      };
      return createElement(PluginComponent, containerProps);
    };
  }

  // Custom img component: use a vault-file:// marker that inlineImages will resolve
  componentMap['img'] = function ExportImage(props: any) {
    const { src, alt, node, ...rest } = props;
    if (!src || src.startsWith('http') || src.startsWith('data:')) {
      return createElement('img', { src, alt, ...rest });
    }
    const rawPath = src.replace(/^\.\//, '');
    const imagePath = decodeURIComponent(rawPath);
    const imageUrl = `vault-file://${imagePath}`;
    return createElement('img', { src: imageUrl, alt, ...rest });
  };

  return componentMap;
}

/** Render markdown to HTML string via unified pipeline + React SSR */
export function renderMarkdownToHtml(markdown: string, _vaultRoot?: string): string {
  const componentMap = buildExportComponentMap();

  const result = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkDirective)
    .use(remarkDirectiveRehype)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeHighlight, { ignoreMissing: true } as any)
    .use(rehypeReact, {
      jsx,
      jsxs,
      Fragment,
      components: componentMap,
    } as any)
    .processSync(markdown);

  // result.result is a React element tree; render it to static HTML
  const html = renderToStaticMarkup(result.result as React.ReactElement);
  return html;
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

/**
 * Styles for exported HTML / PDF.
 * These mirror the .md-preview styles from index.css with CSS variables
 * resolved to the light-theme palette so the export looks identical to the
 * in-app preview.
 */
export const HTML_STYLES = `
    body {
      max-width: 800px; margin: 0 auto; padding: 40px 20px;
      font-family: 'Sora', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px; line-height: 1.8; color: #1a2040; word-break: break-word;
    }

    /* Headings */
    h1 { font-size: 28px; font-weight: 700; margin: 8px 0 12px; border-bottom: 1px solid #dde2f0; padding-bottom: 8px; }
    h2 { font-size: 22px; font-weight: 700; margin: 20px 0 10px; }
    h3 { font-size: 18px; font-weight: 600; margin: 16px 0 8px; }
    h4 { font-size: 15px; font-weight: 600; margin: 12px 0 6px; }
    h5, h6 { font-size: 13px; font-weight: 600; margin: 10px 0 4px; }

    /* Inline */
    p { margin: 8px 0; }
    a { color: #3a6ef0; text-decoration: none; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    del { text-decoration: line-through; color: #8892b0; }

    /* Code */
    code {
      font-family: 'DM Mono', monospace; font-size: 12px;
      background: #f8f9fd; padding: 2px 5px; border-radius: 3px;
      border: 1px solid #dde2f0;
    }
    pre {
      background: #f8f9fd; border: 1px solid #dde2f0; border-radius: 6px;
      padding: 12px 16px; overflow-x: auto; margin: 12px 0;
    }
    pre code {
      background: none; border: none; padding: 0; font-size: 12px;
      line-height: 1.6; color: #1a2040;
    }

    /* Blockquote */
    blockquote {
      border-left: 3px solid #3a6ef0; padding: 4px 16px; margin: 12px 0;
      color: #4a5580; background: #f8f9fd; border-radius: 0 6px 6px 0;
    }

    /* Lists */
    ul { padding-left: 24px; margin: 8px 0; list-style-type: disc; }
    ol { padding-left: 24px; margin: 8px 0; list-style-type: decimal; }
    li { margin: 4px 0; }
    ul.contains-task-list { list-style-type: none; padding-left: 4px; }
    input[type="checkbox"] { margin-right: 6px; }

    /* Table */
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #dde2f0; padding: 6px 12px; font-size: 12px; text-align: left; }
    th { background: #f8f9fd; font-weight: 600; }

    /* Image */
    img { max-width: 100%; border-radius: 6px; margin: 8px 0; }

    /* Horizontal rule */
    hr { border: none; border-top: 1px solid #dde2f0; margin: 20px 0; }

    /* Syntax highlighting (light theme) */
    .hljs { background: #f8f9fd; }
    .hljs-comment, .hljs-quote { color: #940; }
    .hljs-keyword, .hljs-selector-tag { color: #708; }
    .hljs-number, .hljs-literal { color: #164; }
    .hljs-string, .hljs-addition { color: #a11; }
    .hljs-regexp { color: #e40; }
    .hljs-tag, .hljs-name { color: #170; }
    .hljs-attr, .hljs-variable, .hljs-template-variable { color: #00c; }
    .hljs-attribute { color: #00c; }
    .hljs-type, .hljs-built_in, .hljs-builtin-name, .hljs-class .hljs-title { color: #085; }
    .hljs-meta { color: #555; }
    .hljs-title, .hljs-function .hljs-title { color: #00f; }
    .hljs-section { color: #00f; }
    .hljs-deletion { color: #a11; }
    .hljs-symbol, .hljs-bullet { color: #708; }
    .hljs-link { color: #219; }
    .hljs-emphasis { font-style: italic; }
    .hljs-strong { font-weight: bold; }

    /*
     * Steps container: layout + CSS counter cannot be expressed via inline
     * styles, so we keep these rules here. All other container styles are
     * rendered as inline styles by the shared React components.
     */
    .docmd-steps { position: relative; padding-left: 3rem; margin: 1.5rem 0; counter-reset: docmd-step; }
    .docmd-steps-line { position: absolute; left: 1.15rem; top: 1rem; bottom: 1rem; width: 2px; background-color: #dde2f0; }
    .docmd-step { position: relative; margin-bottom: 2.5rem; counter-increment: docmd-step; }
    .docmd-step-number {
      position: absolute; left: -2.75rem; top: 0; width: 1.5rem; height: 1.5rem;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 0.75rem; line-height: 1; color: #4a5580; z-index: 1;
      background-color: #f8f9fd; border: 1px solid #dde2f0; border-radius: 50%;
    }
    .docmd-step-number::before { content: counter(docmd-step); }

    @media print {
      body { max-width: none; padding: 20px; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
`;

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
