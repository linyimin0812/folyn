import { createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { all as allLowlightGrammars } from 'lowlight';
import rehypeMathjax from 'rehype-mathjax';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { ContainerRegistry, registerBuiltinPlugins } from '@folyn/container-plugins';
import type { ContainerProps } from '@folyn/container-plugins';
import { transformMathBrackets, MATHJAX_CONTAINER_CSS } from '@/services/markdown/renderMarkdown';

import * as dbmlExporter from './export/dbml';
import * as excalidrawExporter from './export/excalidraw';
import * as drawioExporter from './export/drawio';
import * as markmapExporter from './export/markmap';
import * as plantumlExporter from './export/plantuml';
import * as graphvizExporter from './export/graphviz';
import * as mermaidExporter from './export/mermaid';
import { inlineContainerImages } from './export/shared';
import { renderMarkmapSvg } from './export/markmapShared';
import { resolveAssetBase } from '@/components/file-types/previewPath';
import type { EnhanceCtx } from './export/dbml';
import { getEnhancer } from './plugin-host/exportEnhancerAdapter';
import type { ExporterContext } from '@folyn/plugin-host';

// Ensure built-in plugins are registered once
registerBuiltinPlugins();

export type ExportFormat = 'markdown' | 'html';

/** Regex that matches Folyn container directive syntax (:::) */
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
      // Tag the wrapper with data-container so the export DOM walk can locate
      // rendered containers by directive name and apply plugin enhancers.
      return createElement('div', { 'data-container': plugin.name }, createElement(PluginComponent, containerProps));
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
    .use(remarkMath)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkDirective)
    .use(remarkDirectiveRehype)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeHighlight, { languages: allLowlightGrammars, ignoreMissing: true } as any)
    .use(rehypeMathjax)
    .use(rehypeReact, {
      jsx,
      jsxs,
      Fragment,
      components: componentMap,
    } as any)
    .processSync(transformMathBrackets(markdown));

  // result.result is a React element tree; render it to static HTML
  const html = renderToStaticMarkup(result.result as React.ReactElement);
  return html;
}

// ponytail: light-theme token block — mirrors [data-theme="light"] in
// apps/desktop/src/index.css:80-92. Dumped app CSS uses var(--t1) etc., which
// won't resolve in a standalone HTML file without :root defining them.
// Vars mirror index.css light ([data-theme="light"],:root) and dark
// ([data-theme="dark"]) blocks — keep in sync if those change.
export const LIGHT_THEME_VARS = `
[data-theme="light"], :root {
  --bg: #f0f2f8; --panel: #fff; --surf: #f8f9fd; --surf2: #eef0f8;
  --hov: #e8ecf8; --act: #dde3f5; --brd: #dde2f0; --brd2: #c8d0e8;
  --t1: #1a2040; --t2: #4a5580; --t3: #8892b0; --t4: #c0c8e0;
  --acc: #3a6ef0; --acc2: #6a3af0; --accdim: #dce8ff; --accglow: rgba(58,110,240,.08);
  --green: #22a863; --gdim: #dcf5e8; --amber: #d4820a; --red: #d94040;
  --cyan: #0a8ab8; --purple: #8040d0; --card: #fff; --inp: #f4f5f8;
  --font-ui: 'Sora', sans-serif; --font-mono: 'DM Mono', monospace; --ui-font-size: 14px;
}
`;

export const DARK_THEME_VARS = `
[data-theme="dark"], :root {
  --bg: #0b0d14; --panel: #0f1219; --surf: #13161f; --surf2: #181c28;
  --hov: #1b1f2e; --act: #1e2438; --brd: #1c2136; --brd2: #252d4a;
  --t1: #e2e8f8; --t2: #9aa5c0; --t3: #6b7a96; --t4: #3a4560;
  --acc: #5b8af5; --acc2: #7c5bf5; --accdim: #131d42; --accglow: rgba(91,138,245,.1);
  --green: #3dd68c; --gdim: #0b2418; --amber: #f5a623; --red: #f06a6a;
  --cyan: #5dd8f5; --purple: #b87cf5; --card: #111420; --inp: #0f1219;
  --font-ui: 'Sora', sans-serif; --font-mono: 'DM Mono', monospace; --ui-font-size: 14px;
}
`;

/**
 * Concatenate all CSS rules currently loaded in the document. Cross-origin
 * sheets throw on cssRules access and are skipped. Used so exported HTML
 * renders identically to the in-app preview (Tailwind utilities, container-
 * plugin classes, file-type Preview styles all rely on this).
 */
export function collectAppCss(): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const cssRules = sheet.cssRules;
      if (!cssRules) continue;
      for (const rule of Array.from(cssRules)) {
        rules.push(rule.cssText);
      }
    } catch {
      // cross-origin — skip
    }
  }
  return rules.join('\n');
}

// Loading-state placeholder strings that must disappear before export is
// ready. Covers mermaid ("渲染图表中..."), file-preview ("加载中..."), and
// the lazy ER renderer ("正在加载 ER 渲染器..."). Any of these present means
// an async render is still pending. PlantUML/Graphviz previews replaced the
// text with a spinner element marked `data-loading="true"` — the tick loop
// also queries that attribute so both paths are covered. Mermaid and the ER
// renderer still use the text markers, so the array stays.
const LOADING_MARKERS = ['加载中', '渲染图表中', '正在加载', '渲染中', '正在加载 ER 渲染器'];

/**
 * Mount the actual MarkdownPreview in a hidden DOM, wait for async effects
 * (mermaid.render, ctx.readFile, x6 graph mount) to settle, then extract
 * innerHTML. This is the export's source of truth — identical pipeline to
 * the in-app preview, so output matches what the user sees.
 *
 * Returns { html, css }: the rendered body HTML and the app's CSS rules (so
 * the standalone file has the classes referenced by the rendered DOM).
 */
export async function renderMarkdownToHtmlViaDom(
  content: string,
  filePath: string,
  vaultRoot: string,
  theme: 'light' | 'dark' = 'light',
  opts?: { inlineImages?: boolean },
): Promise<{ html: string; css: string }> {
  // ponytail: `inlineImages: false` skips the DOM-walk that converts
  // `asset://` <img> srcs to data URIs. Used by upload-mode sharing so
  // `uploadImagesToProvider` can still see the local asset URLs, upload
  // each, and rewrite src to the public cloud URL — instead of having the
  // images already-baked-in as base64 (which would defeat the whole
  // point of upload mode).
  const inlineImages = opts?.inlineImages !== false;
  // Lazy import: MarkdownPreview pulls in Excalidraw + x6 which need a real
  // DOM (canvas getContext). Keeps this module importable in test (jsdom).
  const { MarkdownPreview } = await import('@/components/file-types/markdown/MarkdownPreview');

  const container = document.createElement('div');
  // data-theme scopes the theme CSS variables to this subtree so the rendered
  // HTML bakes in the matching palette. visibility:hidden keeps it off-screen
  // but layout still computes — x6 needs real offsetWidth/Height to mount.
  container.setAttribute('data-export-root', '');
  container.setAttribute('data-theme', theme);
  const bg = theme === 'dark' ? '#0b0d14' : '#fff';
  const fg = theme === 'dark' ? '#e2e8f8' : '#1a2040';
  container.style.cssText =
    `position:absolute;left:-9999px;top:0;width:800px;height:auto;background:${bg};color:${fg};visibility:hidden;`;
  document.body.appendChild(container);

  const root = createRoot(container);
  // ponytail: no flushSync — it forces ALL pending passive effects in the
  // document to flush, including the editor pane's ErDiagramX6 if it has
  // pending work, which races with React's commit phase and logs a warning.
  // Natural async render + the 150ms poll start gives React time to commit
  // the first frame.
  root.render(createElement(MarkdownPreview, { content, filePath, vaultRoot }));

  // Poll for stability: no loading markers visible AND any markmap file-preview
  // block has its markmap SVG mounted (a child <g> inside the container's
  // <svg>). markmap-view's Markmap.create is synchronous, but d3 layout
  // runs on the next frame; without this check the loop can exit before
  // the SVG has any rendered nodes.
  const startedAt = Date.now();
  const TIMEOUT_MS = 10000;
  const POLL_MS = 150;
  let stableSince = 0;
  await new Promise<void>((resolve) => {
    const tick = () => {
      const text = container.textContent ?? '';
      const hasLoadingMarker = LOADING_MARKERS.some((m) => text.includes(m));
      const hasLoadingAttr = container.querySelector('[data-loading="true"]') !== null;
      const hasLoading = hasLoadingMarker || hasLoadingAttr;
      const markmapBlocks = container.querySelectorAll('[data-file-preview-src]');
      let pendingMarkmap = false;
      for (const b of Array.from(markmapBlocks)) {
        const name = (b.getAttribute('data-file-preview-name') || '').toLowerCase();
        if (!name.endsWith('.markmap')) continue;
        const svg = b.querySelector('.markmap-container svg');
        if (!svg || !svg.querySelector('g')) { pendingMarkmap = true; break; }
      }
      const elapsed = Date.now() - startedAt;
      if (!hasLoading && !pendingMarkmap) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= 500 || elapsed >= TIMEOUT_MS) {
          resolve();
          return;
        }
      } else {
        stableSince = 0;
      }
      if (elapsed >= TIMEOUT_MS) resolve();
      else setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, POLL_MS);
  });

  // Re-render ```markmap blocks into standalone SVGs (deterministic, images
  // inlined) — the in-DOM preview render still runs d3 transitions, so capture
  // it independently via renderMarkmapSvg (duration:0) like the .markmap enhancer.
  await processMarkmapCodeBlocks(container, filePath, vaultRoot);

  // ponytail: post-process file-preview blocks AFTER stabilization — per
  // file type, render a self-contained SVG for export (excalidraw/drawio
  // can't be captured from the in-DOM canvas/iframe; x6 ER needs viewBox
  // scaling; markmap keeps its in-DOM render). Done before innerHTML extraction
  // so the export captures the post-processed DOM.
  await processFilePreviews(container, filePath, vaultRoot);

  // Apply plugin-contributed export enhancers to [data-container] blocks
  // (post-process rendered container DOM into self-contained export form).
  await applyContainerEnhancers(container, { filePath, vaultRoot });

  // Inline <img> srcs (Tauri asset URLs) as base64 data URLs so the exported
  // file is self-contained. Done in-DOM AFTER React commits + async effects
  // settle + per-type enhancers run, so the <img> elements actually exist
  // when we walk them. (Earlier this ran right after `root.render`, before
  // React 18's async commit — querySelectorAll('img') came back empty and
  // asset:// srcs leaked into the exported HTML as broken images.)
  // Skipped in upload-share mode — the caller will walk the asset URLs
  // itself and upload each image.
  if (inlineImages) {
    await inlineContainerImages(container);
  }

  // ponytail: strip interactive resize handles — they're preview-only UI,
  // not content. Wrapper .resizable-media stays (holds the persisted width
  // inline style); only the drag handle div is removed.
  container.querySelectorAll('.resize-handle').forEach((el) => el.remove());

  const html = container.innerHTML;
  const css = collectAppCss();
  // Defer unmount out of the current render cycle so it doesn't race with
  // React 18's own unmount and log a warning. setTimeout(0) pushes cleanup
  // past the current task so no render is in flight. Errors are swallowed —
  // we've already extracted what we need.
  setTimeout(() => {
    try { root.unmount(); } catch { /* already torn down */ }
    container.remove();
  }, 0);
  return { html, css };
}

/**
 * Per-file-type export enhancer registry. Each entry takes a rendered
 * [data-file-preview] body and replaces its content with a self-contained
 * SVG suitable for standalone HTML export. Adding a new file type = add
 * a module under services/export/<type>.ts and register it here.
 */
type EnhanceFn = (body: HTMLElement, ctx: EnhanceCtx) => Promise<void>;

const REGISTRY: Record<string, EnhanceFn> = {
  dbml: dbmlExporter.enhance,
  excalidraw: excalidrawExporter.enhance,
  drawio: drawioExporter.enhance,
  markmap: markmapExporter.enhance,
  plantuml: plantumlExporter.enhance,
  puml: plantumlExporter.enhance,
  pu: plantumlExporter.enhance,
  graphviz: graphvizExporter.enhance,
  gv: graphvizExporter.enhance,
  dot: graphvizExporter.enhance,
  mermaid: mermaidExporter.enhance,
  mmd: mermaidExporter.enhance,
};

/**
 * Walk each `[data-markmap-code]` block (an inline ```markmap fence) and
 * re-render it as a standalone SVG. The fence source is stashed on
 * `data-markmap-src` by MarkmapBlock; relative `![](img.png)` references
 * resolve against the markdown file's directory (same as the .markmap enhancer).
 */
async function processMarkmapCodeBlocks(
  container: HTMLElement,
  filePath: string,
  vaultRoot: string,
): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>('[data-markmap-code]');
  if (blocks.length === 0) return;
  const assetBase = await resolveAssetBase(filePath, vaultRoot).catch(() => null);
  await Promise.all(Array.from(blocks).map(async (block) => {
    const source = block.getAttribute('data-markmap-src') || '';
    const svg = await renderMarkmapSvg(source, assetBase);
    block.removeAttribute('data-markmap-src');
    block.innerHTML = '';
    block.appendChild(svg);
    block.style.height = '420px';
    block.style.minHeight = '420px';
    block.style.overflow = 'hidden';
  }));
}

/**
 * Walk each `[data-file-preview]` block in the rendered DOM and produce an
 * export-ready body per file type via the REGISTRY. Falls back to keeping
 * in-DOM content if it has an SVG; otherwise shows a filename card.
 */
async function processFilePreviews(
  container: HTMLElement,
  filePath: string,
  vaultRoot: string,
): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>('[data-file-preview]');
  await Promise.all(Array.from(blocks).map(async (block) => {
    // Strip action buttons (no-ops in static HTML).
    for (const btn of Array.from(block.querySelectorAll('button'))) btn.remove();

    const body = block.querySelector<HTMLElement>('[data-file-preview-body]');
    if (!body) return;

    const src = block.getAttribute('data-file-preview-src') || '';
    const name = block.getAttribute('data-file-preview-name') || '';
    const ext = name.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';

    // dbml blocks also match via the x6-graph-svg-viewport class (in case
    // x6 mounted but the name attr is missing).
    const fn = ext === 'dbml' && body.querySelector('.x6-graph-svg-viewport')
      ? REGISTRY['dbml']
      : REGISTRY[ext];

    if (fn) {
      await fn(body, { src, filePath, vaultRoot }).catch(() => {});
      return;
    }
    // Fallback: consult the plugin export-enhancer registry (keyed by ext
    // without dot). Unifies container-name and file-extension enhancers onto
    // one surface. Plugin handler receives ExporterContext (no src — it can
    // read data-file-preview-src from the parent block if needed).
    const pluginEnhancer = getEnhancer(ext);
    if (pluginEnhancer) {
      const ctx: ExporterContext = { filePath, vaultRoot };
      await pluginEnhancer(body, ctx).catch(() => {});
      return;
    }
    // .markmap and other types: keep in-DOM content if it has an SVG; else
    // fall back to a filename card. Reset the body's fixed 420px height
    // so the card shrinks to content instead of leaving a huge empty box.
    // ponytail: iframe-based previews (html) are already self-contained via
    // srcDoc + sandbox — keep as-is instead of the unsupported card.
    if (body.querySelector('iframe')) return;
    if (body.querySelector('svg')) return;
    body.innerHTML = `<div style="font-family:var(--font-ui,'Sora',sans-serif);font-size:13px;color:var(--t3,#8892b0);text-align:center;padding:20px 0">此文件类型内容不支持导出</div>`;
    body.style.height = 'auto';
    body.style.minHeight = '0';
    body.style.overflow = 'visible';
  }));
}

/**
 * Walk each `[data-container]` element in the rendered export DOM and apply
 * any matching plugin export enhancer (keyed by the container directive name).
 * The enhancer runs host-realm on a real HTMLElement after the in-DOM render
 * has settled; it mutates the body in place to be self-contained for export.
 *
 * The `body` handed to the enhancer is the `[data-container]` element itself,
 * unless it contains a `[data-file-preview-body]` child (a file-preview
 * rendered inside a container directive) — then the inner body is used, mir
 * roring `processFilePreviews`'s body-selection logic. Action buttons are
 * stripped first (same as processFilePreviews).
 *
 * ponytail: enhancer failures are swallowed best-effort (`.catch(() => {})`)
 * — a broken enhancer should not abort the whole export. If multiple plugins
 * register for the same key, last-registered-wins (see exportEnhancerAdapter).
 *
 * Extracted as an exported pure function so the walk is unit-testable in
 * isolation (jsdom can host a DOM, but not MarkdownPreview + excalidraw/x6).
 */
export async function applyContainerEnhancers(
  container: HTMLElement,
  ctx: ExporterContext,
): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>('[data-container]');
  await Promise.all(Array.from(blocks).map(async (block) => {
    const name = block.getAttribute('data-container') || '';
    const enhancer = getEnhancer(name);
    if (!enhancer) return;
    // Strip action buttons (no-ops in static HTML).
    for (const btn of Array.from(block.querySelectorAll('button'))) btn.remove();
    // Use the inner [data-file-preview-body] if present (a file-preview
    // rendered inside this container directive), else the block itself.
    const body = block.querySelector<HTMLElement>('[data-file-preview-body]') ?? block;
    await enhancer(body, ctx).catch(() => {});
  }));
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

    /* MathJax: pin mjx-container to a stable font + size so the SVG
       width="Xex" resolves consistently regardless of whether 'Sora'
       loaded from CDN. See renderMarkdown.ts MATHJAX_CONTAINER_CSS for
       the full rationale. */
    ${MATHJAX_CONTAINER_CSS}

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
    img { cursor: zoom-in; }

    /* Resizable media wrapper — mirrors .md-preview .resizable-media rules
       from index.css so exported images render at the same persisted width
       as the in-app preview. The export DOM strips .resize-handle but keeps
       the wrapper with its inline width style. */
    .resizable-media { position: relative; display: block; width: fit-content; max-width: 100%; margin: 8px auto; line-height: 0; }
    .resizable-media > *:not(.resize-handle) { display: block; width: 100%; }
    .resizable-media img,
    .resizable-media svg { width: 100% !important; height: auto !important; display: block; margin: 0; max-width: none !important; }

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

/**
 * Inline `<script>` injected into the exported HTML `<head>` to make container
 * directives that rely on React synthetic events work in static HTML. Currently
 * wires up `::::tabs` click-to-switch via event delegation on `[data-tab-button]`.
 *
 * ponytail: one global listener covers every tabs block in the doc — smaller
 * than per-block script injection and avoids duplicate handlers on re-render.
 * Initial display (tab 0 visible, others hidden) is set by TabsComponent's
 * useEffect during the in-DOM render mount, so the script only handles clicks.
 */
export const CONTAINER_INTERACT_SCRIPT = `
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-tab-button]');
      if (!btn) return;
      var c = btn.closest('[data-container="tabs"]');
      if (!c) return;
      var btns = c.querySelectorAll('button[data-tab-button]');
      var panels = c.querySelectorAll('[data-is-tab="true"]');
      var idx = Array.prototype.indexOf.call(btns, btn);
      for (var i = 0; i < btns.length; i++) {
        var active = i === idx;
        btns[i].style.borderBottom = active ? '3px solid var(--acc, #068ad5)' : '3px solid transparent';
        btns[i].style.color = active ? 'var(--acc, #068ad5)' : 'var(--t3, #71717a)';
        btns[i].style.backgroundColor = active ? 'var(--panel, #fff)' : 'transparent';
        if (panels[i]) panels[i].style.display = active ? 'block' : 'none';
      }
    });
`;

/**
* CSS override injected AFTER collectAppCss() in the export <style> block.
* The app CSS from index.css sets `.md-preview .resizable-media { width:
* fit-content }` (higher specificity than the bare rules in HTML_STYLES).
 *
 * fit-content + img `width:100% !important` creates a sizing cycle that
 * resolves to the replaced element's default 300px for images WITHOUT
 * intrinsic dimensions (e.g. SVG <img> with viewBox but no width/height).
 * In the preview such images fill the .md-preview width because the img's
 * max-width:100% caps against the 800px parent. This override switches the
 * wrapper to width:100% — but ONLY for wrappers whose direct child is an
 * <img> (`:has(> img)`). Diagram fences (plantuml/mermaid/graphviz/markmap)
 * render inline <svg> with intrinsic dimensions inside nested divs, so they
 * must keep fit-content to render at their natural size — the same as the
 * in-app preview. Uses !important to win against the app CSS dump.
*/
export const RESIZABLE_MEDIA_OVERRIDE = `
    .md-preview .resizable-media:not([style*="width"]):has(> img) { width: 100% !important; }
`;

/**
 * Inline `<script>` injected into the exported HTML `<head>` to enable
 * click-to-zoom on content images. Clicking any `<img>` inside the document
 * body opens a fullscreen lightbox overlay (fixed, dark backdrop, image
 * centered at up to 90vw/90vh). The overlay closes on backdrop click, image
 * click, or Escape. Body scroll is locked while the overlay is open.
 *
 * ponytail: one delegated click listener covers every <img> in the doc —
 * smaller than per-image handlers and works for images rendered dynamically
 * (e.g. container-plugin output). The lightbox overlay element is created
 * lazily on first open and reused thereafter.
 */
export const IMAGE_LIGHTBOX_SCRIPT = `
    (function () {
      var overlay = null;
      function close() {
        if (!overlay) return;
        overlay.style.display = 'none';
        document.body.style.overflow = '';
      }
      function open(src, alt) {
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.7);cursor:zoom-out;';
          var img = document.createElement('img');
          img.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:6px;cursor:zoom-out;';
          overlay.appendChild(img);
          overlay.addEventListener('click', close);
          document.body.appendChild(overlay);
        }
        var lbImg = overlay.querySelector('img');
        lbImg.src = src;
        lbImg.alt = alt || '';
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      }
      document.addEventListener('click', function (e) {
        var img = e.target.closest && e.target.closest('img');
        if (!img || (overlay && overlay.contains(img))) return;
        if (!img.src) return;
        e.preventDefault();
        open(img.src, img.alt);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') close();
      });
    })();
`;
