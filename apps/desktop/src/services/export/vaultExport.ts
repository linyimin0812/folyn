/**
 * Export an entire vault to HTML — keeps the left file-tree as in-app
 * navigation, renders text-type files (markdown / rich-text / code / data /
 * markup) to HTML, and filters binary types (images, office docs) out.
 *
 * Two product shapes, both driven by the same per-file HTML build:
 *  - 'single' (default): one self-contained HTML file. Left tree + right
 *    content; clicking a tree node swaps the visible document. Images in
 *    markdown are inlined as base64 data URIs (same as single-doc export).
 *  - 'folder': a directory the user picks. Creates a <vaultName>/ subfolder
 *    inside it holding `index.html` (tree + iframe) plus one standalone HTML
 *    per document. Closer to the on-disk vault layout.
 *
 * Reuses the single-doc pipeline (@/services/exportService +
 * @/services/export/shared + @/services/export/richtext) so markdown
 * rendering, image inlining, theme vars, and code themes stay identical.
 */
import type { VaultEntry } from '@folyn/vault-provider';
import { useVaultStore } from '@/store/vaultStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getProvider } from '@/services/storage/registry';
import type { StorageProvider, ProviderConfig } from '@/services/storage/types';
import type { HtmlImageMode } from '@/services/export/shared';
import { themeCss } from '@/editor/codeThemes';
import { detectFileType } from '@/store/editorStore';
import { getHandlerById } from '@/components/file-types/registry';
import {
  renderMarkdownToHtmlViaDom,
  HTML_STYLES,
  CONTAINER_INTERACT_SCRIPT,
  RESIZABLE_MEDIA_OVERRIDE,
  IMAGE_LIGHTBOX_SCRIPT,
  LIGHT_THEME_VARS,
  DARK_THEME_VARS,
  buildStandaloneDocHtml,
  CANVAS_DOC_STYLES,
  CODE_DOC_STYLES,
  CODE_INTERACT_SCRIPT,
} from '@/services/exportService';
import {
  inlineImages,
  downloadBlob,
  escapeHtml,
  renderFilePreviewToSvg,
  uploadImagesToProvider,
} from '@/services/export/shared';
import { richTextToHtmlBlob } from '@/services/export/richtext';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileIcon } from '@/components/icons/FileIcon';

export type VaultExportMode = 'single' | 'folder';

/** A vault file deemed "text" — read as a string, exported as HTML. */
interface ExportableFile {
  /** Vault-relative path (e.g. "notes/a.md"). */
  path: string;
  name: string;
  /** Stable doc id used to wire tree ↔ content (e.g. "doc-0"). */
  docId: string;
  /** Resolved file-type id from detectFileType (e.g. "markdown", "code"). */
  fileType: string;
}

/** Resolve the live light/dark theme from <html data-theme>. */
function resolvedTheme(): 'light' | 'dark' {
  return (document.documentElement.dataset.theme as 'light' | 'dark') === 'dark' ? 'dark' : 'light';
}

/**
 * Walk the vault tree, keeping the directory skeleton but only retaining
 * text-type files (handler.needsFileContent !== false). Binary types
 * (image / office / preview-only) are dropped. Directories that become
 * empty after filtering are pruned — a tree of only-empty dirs is noise.
 *
 * `__clips__` clip files (.md under __clips__/) detect as 'clip' (text) and
 * are kept; their handler needsFileContent is true. SVG files are filtered
 * out too — an SVG is rendered markup, not a text doc worth a standalone
 * export page.
 */
function filterTextTree(entries: VaultEntry[]): VaultEntry[] {
  const walk = (items: VaultEntry[]): VaultEntry[] => {
    const out: VaultEntry[] = [];
    for (const e of items) {
      if (e.type === 'dir') {
        const children = e.children ? walk(e.children) : [];
        if (children.length > 0) out.push({ ...e, children });
        // empty dirs after filtering → pruned (no push)
      } else {
        const ft = detectFileType(e.path);
        const handler = getHandlerById(ft);
        // needsFileContent === false ⇒ binary/preview-only (image, office, …)
        // → filter out. Unknown/code types default to text (kept). SVG is
        // excluded here too (rendered markup, not an exportable text doc).
        if (ft !== 'svg' && (!handler || handler.needsFileContent !== false)) {
          out.push({ ...e });
        }
      }
    }
    return out;
  };
  return walk(entries);
}

/** Flatten a (already filtered) tree into an ordered file list with doc ids. */
function collectFiles(tree: VaultEntry[]): ExportableFile[] {
  const files: ExportableFile[] = [];
  let i = 0;
  const walk = (items: VaultEntry[]) => {
    for (const e of items) {
      if (e.type === 'file') {
        files.push({
          path: e.path,
          name: e.name,
          docId: `doc-${i++}`,
          fileType: detectFileType(e.path),
        });
      } else if (e.children) {
        walk(e.children);
      }
    }
  };
  walk(tree);
  return files;
}

/** Read a vault file's text content via the vault manager. */
async function readVaultText(path: string): Promise<string> {
  return useVaultStore.getState().manager.readFile(path);
}

/**
 * Render one exportable file to an HTML *body fragment* (inner HTML for the
 * content pane). Markdown goes through the full DOM render pipeline +
 * image inlining (base64); rich-text reuses its serializer; canvas types
 * (plantuml/graphviz/mermaid/dbml/drawio/excalidraw/markmap) render to SVG
 * via the preview pipeline; svg/html embed their rendered markup (html in an
 * isolated iframe); the remaining text types (code/csv/json/txt…) are
 * wrapped in a <pre><code> source block.
 *
 * Returns { html, css } — css is the markdown-renderer's scoped CSS
 * (container extensions, code highlights); non-markdown types emit ''.
 */
const CANVAS_EXPORT_TYPES = new Set(['dbml', 'excalidraw', 'drawio', 'markmap', 'plantuml', 'graphviz', 'mermaid']);

// Max docs rendered in parallel during whole-vault export. Each render mounts
// a DOM root + poll loop on document.body, so this is bounded to avoid
// mounting hundreds of trees at once. ponytail: a fixed pool, not a config.
const EXPORT_CONCURRENCY = 6;

/** Map over `items` with at most `limit` in-flight promises; returns results in
 *  input order. A rejection (e.g. CANCELLED) aborts the batch via Promise.all. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

async function fileToBodyFragment(
  file: ExportableFile,
  vaultRoot: string,
  theme: 'light' | 'dark',
  imageMode: HtmlImageMode,
  provider: StorageProvider | null,
  cfg: ProviderConfig | null,
): Promise<{ html: string; css: string; standalone?: string; canvas?: boolean }> {
  // markdown / clip (clip is a md variant under __clips__) → full render
  if (file.fileType === 'markdown' || file.fileType === 'clip') {
    const content = await readVaultText(file.path);
    // upload mode needs the provider: render without the DOM inline pass so
    // asset:// srcs survive, then upload each and rewrite to the public URL.
    // Mirrors shareActiveToCloud. Falls back to inline when no provider is
    // configured (upload was picked but nothing is set up yet).
    if (imageMode === 'upload' && provider && cfg) {
      const { html, css } = await renderMarkdownToHtmlViaDom(content, file.path, vaultRoot, theme, { inlineImages: false });
      const uploaded = await uploadImagesToProvider(html, provider, cfg);
      return { html: uploaded, css };
    }
    const { html, css } = await renderMarkdownToHtmlViaDom(content, file.path, vaultRoot, theme);
    const inlined = await inlineImages(html, vaultRoot, file.path);
    return { html: inlined, css };
  }

  if (file.fileType === 'rich-text') {
    const content = await readVaultText(file.path);
    const blob = await richTextToHtmlBlob(content, file.name, vaultRoot);
    const full = await blob.text();
    // Extract <body> inner HTML from the standalone doc rich-text built.
    const match = full.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return { html: match ? match[1].trim() : full, css: '' };
  }

  // canvas types → render to SVG via the preview pipeline (not source)
  if (CANVAS_EXPORT_TYPES.has(file.fileType)) {
    const svg = await renderFilePreviewToSvg(file.path, vaultRoot);
    if (!svg) return { html: '', css: '' };
    // Centered, no-scroll canvas page (fills viewport, SVG scaled to fit).
    const page = `<div class="vt-canvas-page">${svg}</div>`;
    return {
      html: page,
      css: '',
      canvas: true,
      standalone: `<!DOCTYPE html>\n<html lang="zh-CN" data-theme="${theme}">\n<head><meta charset="UTF-8"><title>${escapeHtml(file.name)}</title><style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:${theme === 'dark' ? '#0b0d14' : '#fff'}}${VT_CANVAS_PAGE_CSS}</style></head>\n<body>${page}\n<script>${VT_CANVAS_GESTURE_SCRIPT}</script>\n</body>\n</html>`,
    };
  }

  // html file → isolate in an iframe (srcdoc) so its styles don't leak.
  // single mode embeds the iframe (fills .vt-doc-fit); folder mode uses
  // `standalone` — a full page with the iframe at 100% (no padding shell).
  if (file.fileType === 'html') {
    const content = await readVaultText(file.path);
    const srcdoc = escapeHtml(content);
    return {
      html: `<iframe srcdoc="${srcdoc}" style="width:100%;height:100%;border:0;display:block"></iframe>`,
      css: '',
      standalone: `<!DOCTYPE html>\n<html lang="zh-CN" data-theme="${theme}">\n<head><meta charset="UTF-8"><title>${escapeHtml(file.name)}</title><style>html,body{margin:0;padding:0;height:100%;overflow:auto;background:${theme === 'dark' ? '#0b0d14' : '#fff'}}iframe{width:100%;height:100vh;border:0}</style></head>\n<body><iframe srcdoc="${srcdoc}"></iframe></body>\n</html>`,
    };
  }

  // code / csv / json / txt / … → render as a highlighted code block via the
  // markdown pipeline (rehype-highlight) so syntax colors are preserved.
  const content = await readVaultText(file.path);
  const lang = file.name.split('.').pop()?.toLowerCase() ?? '';
  const fenced = '```' + lang + '\n' + content + '\n```';
  const { html, css } = await renderMarkdownToHtmlViaDom(fenced, file.path, vaultRoot, theme);
  return { html: `<div class="vt-code-doc">${html}</div>`, css };
}

/* ───────────────────────── tree nav (HTML) ───────────────────────── */

/** Render the app's file/folder icon for a tree entry to static HTML, so
 * the exported tree uses the same icons as the in-app sidebar (no emoji). */
function fileIconMarkup(entry: { name: string; type: 'file' | 'dir' }, fileType: string): string {
  return renderToStaticMarkup(React.createElement(FileIcon, { filename: entry.name, isDir: entry.type === 'dir', fileType }));
}

/** Indent guide lines — one per ancestor depth, matching the in-app file
 * tree (FileTreeItem: absolute w-px bg-brd2 at left = basePad + i*indent + 7). */
function indentLines(depth: number): string {
  let s = '';
  for (let i = 0; i < depth; i++) s += `<span class="vt-line" style="left:${12 + i * 16 + 7}px"></span>`;
  return s;
}

/**
 * Build the file-tree <ul> HTML from the filtered tree. Each leaf carries
 * `data-doc="${docId}"`; clicking calls into the page's switchDoc(). Folders
 * are collapsible <details> groups.
 */
function buildTreeHtml(tree: VaultEntry[], files: ExportableFile[]): string {
  const pathToDoc = new Map(files.map((f) => [f.path, f.docId]));
  const walk = (items: VaultEntry[], depth: number): string => {
    const lis: string[] = [];
    for (const e of items) {
      const pad = `padding-left:${12 + depth * 16}px`;
      if (e.type === 'dir') {
        const childHtml = e.children ? walk(e.children, depth + 1) : '';
        lis.push(
          `<li class="vt-dir"><details open><summary class="vt-row" style="${pad}">${indentLines(depth)}<span class="vt-icon">${fileIconMarkup(e, '')}</span><span class="vt-name">${escapeHtml(e.name)}</span></summary><ul>${childHtml}</ul></details></li>`,
        );
      } else {
        const docId = pathToDoc.get(e.path);
        if (!docId) continue;
        // data-path = vault-relative path, used for ?file=<path> deep-linking.
        lis.push(
          `<li class="vt-file" data-doc="${docId}" data-path="${escapeHtml(e.path)}"><div class="vt-row" style="${pad}">${indentLines(depth)}<span class="vt-icon">${fileIconMarkup(e, detectFileType(e.path))}</span><span class="vt-name">${escapeHtml(e.name)}</span></div></li>`,
        );
      }
    }
    return lis.join('');
  };
  return `<ul class="vt-root">${walk(tree, 0)}</ul>`;
}

/* ───────────────────────── single-file mode ───────────────────────── */

const VT_CANVAS_PAGE_CSS = `
.vt-canvas-page { width: 100%; height: 100%; min-height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; box-sizing: border-box; }
.vt-canvas-page svg { max-width: 100%; max-height: 100%; width: auto; height: auto; display: block; transform-origin: center center; transition: transform .08s; }
`;

/** Gesture zoom for canvas SVGs (plantuml/dbml/drawio/…): wheel to zoom,
 *  two-finger pinch to zoom, double-click to reset. Works in place on the
 *  `.vt-canvas-page svg` without opening the lightbox overlay. */
const VT_CANVAS_GESTURE_SCRIPT = `
(function () {
  function attach(page) {
    var svg = page && page.querySelector('svg');
    if (!svg) return;
    var scale = 1, x = 0, y = 0;
    function apply() { svg.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')'; }
    function reset() { scale = 1; x = 0; y = 0; apply(); }
    // Wheel zoom (ctrl+wheel on trackpads = pinch; plain wheel = zoom too).
    page.addEventListener('wheel', function (e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? 0.9 : 1.1;
      scale = Math.max(0.2, Math.min(8, scale * delta));
      apply();
    }, { passive: false });
    // Two-finger pinch on touch.
    var pinchDist = 0, pinchScale = 1;
    page.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) { pinchDist = dist(e.touches); pinchScale = scale; e.preventDefault(); }
    }, { passive: false });
    page.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && pinchDist) {
        e.preventDefault();
        scale = Math.max(0.2, Math.min(8, pinchScale * (dist(e.touches) / pinchDist)));
        apply();
      }
    }, { passive: false });
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.hypot(dx, dy); }
    // Double-click/double-tap resets.
    page.addEventListener('dblclick', reset);
  }
  [].slice.call(document.querySelectorAll('.vt-canvas-page')).forEach(attach);
})();
`;

const VAULT_EXPORT_STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { display: flex; font-family: 'Sora', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.vt-sidebar { position: relative; width: 260px; height: 100vh; overflow: auto; border-right: 1px solid var(--brd, #dde2f0); background: var(--surf, #f8f9fd); flex-shrink: 0; padding: 10px 0; }
.vt-content { flex: 1; height: 100vh; overflow: auto; }
.vt-root { list-style: none; margin: 0; padding: 0; }
.vt-root ul { list-style: none; margin: 0; padding: 0; }
.vt-root li { display: block; margin: 0; padding: 0; }
details { display: block; margin: 0; padding: 0; }
.vt-row { position: relative; overflow: visible; display: flex; align-items: center; gap: 6px; padding-top: 4px; padding-bottom: 4px; padding-right: 10px; cursor: pointer; font-size: 13px; color: var(--t2, #4a5378); border-radius: 4px; }
.vt-row:hover { background: var(--hov, #eef1fb); }
.vt-file.active .vt-row, .vt-dir .vt-row[data-active] { background: var(--act, #e6ecff); color: var(--t1, #1a2040); }
.vt-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0; }
.vt-icon img, .vt-icon svg { display: block; width: 16px; height: 16px; flex-shrink: 0; }
.vt-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vt-line { position: absolute; top: -1px; bottom: -1px; width: 1px; background: var(--brd2, #dde2f0); pointer-events: none; }
.vt-resizer { width: 1px; flex-shrink: 0; cursor: col-resize; height: 100vh; position: relative; background: var(--brd, #dde2f0); }
.vt-resizer:hover, .vt-resizer.is-dragging { background: var(--acc, #3a6ef0); opacity: .5; }
.vt-resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: -4px; right: -4px; }
.is-resizing, .is-resizing * { cursor: col-resize !important; user-select: none !important; }
details > summary { list-style: none; }
details > summary::-webkit-details-marker { display: none; }
.vt-doc { display: none; }
.vt-doc.active { display: block; }
.vt-doc-fit { height: 100vh; }
.vt-doc-fit.active { display: flex; justify-content: center; align-items: flex-start; }
.vt-doc-fit iframe { width: 100%; height: 100%; border: 0; display: block; }
.vt-doc-inner { max-width: none; width: 100%; padding: 32px 40px; box-sizing: border-box; }
.vt-doc pre.vault-code { background: #f8f9fd; border: 1px solid #dde2f0; border-radius: 6px; padding: 16px; overflow: auto; }
.vt-doc pre.vault-code code { font-family: 'DM Mono', monospace; font-size: 12px; white-space: pre; }
/* canvas docs: fill viewport + center (both axes) + no scrollbars; the
 SVG scales to fit (preserving aspect ratio) instead of stretching. */
.vt-doc-canvas { height: 100vh; overflow: hidden; }
.vt-doc-canvas.active { display: flex; align-items: center; justify-content: center; }
${VT_CANVAS_PAGE_CSS}
`;

const VAULT_NAV_SCRIPT = `
(function () {
  var files = [].slice.call(document.querySelectorAll('.vt-file'));
  var docs = [].slice.call(document.querySelectorAll('.vt-doc'));
  function show(id) {
    files.forEach(function (f) { f.classList.toggle('active', f.getAttribute('data-doc') === id); });
    docs.forEach(function (d) { d.classList.toggle('active', d.getAttribute('data-doc') === id); });
    var el = document.querySelector('.vt-doc[data-doc="' + id + '"]');
    if (el) el.querySelector('.vt-content-scroll')?.scrollTo(0, 0);
    document.querySelector('.vt-content')?.scrollTo(0, 0);
    // Reflect the open doc in the URL as ?file=<vault-relative path> so it
    // can be shared/bookmarked and reopened directly.
    var active = document.querySelector('.vt-file.active');
    var path = active && active.getAttribute('data-path');
    if (path) {
      var url = new URL(location.href);
      url.searchParams.set('file', path);
      history.replaceState(null, '', url);
    }
  }
  files.forEach(function (f) {
    f.querySelector('.vt-row').addEventListener('click', function () { show(f.getAttribute('data-doc')); });
  });
  // Deep link: ?file=<path> → open that doc; fall back to the first file.
  var target = new URLSearchParams(location.search).get('file');
  var initial = (target && files.filter(function (f) { return f.getAttribute('data-path') === target; })[0]) || files[0];
  if (initial) show(initial.getAttribute('data-doc'));
})();
`;

/** Sidebar drag-to-resize handler — mirrors in-app SidebarResizer: mousedown
 * on the .vt-resizer grip drives sidebar width via mousemove, clamped
 * 120–600px. Injected into both single-file and folder-index pages. */
const VT_RESIZER_SCRIPT = `
(function () {
  var sidebar = document.querySelector('.vt-sidebar');
  var resizer = document.querySelector('.vt-resizer');
  if (!sidebar || !resizer) return;
  var dragging = false;
  resizer.addEventListener('mousedown', function (e) {
    e.preventDefault();
    dragging = true;
    resizer.classList.add('is-dragging');
    document.documentElement.classList.add('is-resizing');
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var w = Math.max(120, Math.min(600, e.clientX));
    sidebar.style.width = w + 'px';
  });
  document.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('is-dragging');
    document.documentElement.classList.remove('is-resizing');
  });
})();
`;

/**
 * Build the single self-contained HTML: sidebar tree + every document as a
 * hidden <section class="vt-doc">; clicking a tree node swaps visibility.
 */
function assembleSingleHtml(
  tree: VaultEntry[],
  files: ExportableFile[],
  docs: { docId: string; html: string; css: string; standalone?: string; canvas?: boolean }[],
  vaultName: string,
  theme: 'light' | 'dark',
  codeThemeCss: string,
): string {
  const treeHtml = buildTreeHtml(tree, files);
  const themeVars = theme === 'dark' ? DARK_THEME_VARS : LIGHT_THEME_VARS;
  const bodyBg = theme === 'dark' ? '#0b0d14' : '#fff';
  const docSections = docs
    .map((d) => d.standalone
      ? `    <section class="vt-doc vt-doc-fit${d.canvas ? ' vt-doc-canvas' : ''}" data-doc="${d.docId}">${d.html}</section>`
      : `    <section class="vt-doc" data-doc="${d.docId}"><div class="vt-doc-inner">${d.html}</div></section>`)
    .join('\n');
  // Merge per-doc CSS (markdown renderer scoped styles) — dedupe by string equality.
  const cssSet = new Set<string>();
  for (const d of docs) if (d.css) cssSet.add(d.css);
  const mergedCss = [...cssSet].join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(vaultName)} — Vault</title>
  <base target="_blank">
  <style>${VAULT_EXPORT_STYLES}\n${themeVars}\n${codeThemeCss}\n${HTML_STYLES}\n${mergedCss}\nhtml, body { background: ${bodyBg}; min-height: 100vh; }\n.vt-doc-inner { color: var(--t1, #1a2040); }\n.vt-content { background: ${bodyBg}; }\nbody { max-width: none !important; display: flex !important; margin: 0 !important; padding: 0 !important; }\n${CANVAS_DOC_STYLES}\n${CODE_DOC_STYLES}\n${RESIZABLE_MEDIA_OVERRIDE}</style>
  <script>${CONTAINER_INTERACT_SCRIPT}</script>
  <script>${IMAGE_LIGHTBOX_SCRIPT}</script>
</head>
<body>
  <aside class="vt-sidebar">${treeHtml}</aside><div class="vt-resizer"></div>
  <main class="vt-content">
${docSections}
  </main>
  <script>${VAULT_NAV_SCRIPT}${VT_RESIZER_SCRIPT}</script>
  <script>${VT_CANVAS_GESTURE_SCRIPT}</script>
  <script>${CODE_INTERACT_SCRIPT}</script>
</body>
</html>`;
}

/* ───────────────────────── folder mode ───────────────────────── */

/** Sanitize a vault-relative path into a flat, unique output filename. */
function safeDocFileName(docId: string, name: string): string {
  // docId is already unique (doc-0, doc-1, …); keep the original name for
  // human readability but strip path separators and force .html.
  const base = name.replace(/[/\\]/g, '_').replace(/\.[^.]+$/, '');
  return `${docId}__${base}.html`;
}

/**
 * Folder-mode index: tree nav on the left, an <iframe> on the right that
 * loads the clicked document's standalone HTML page.
 */
function assembleFolderIndexHtml(
  tree: VaultEntry[],
  files: ExportableFile[],
  vaultName: string,
  theme: 'light' | 'dark',
): string {
  const bodyBg = theme === 'dark' ? '#0b0d14' : '#fff';
  const fileNames = new Map(files.map((f) => [f.path, 'docs/' + safeDocFileName(f.docId, f.name)]));
  const treeHtml = buildFolderTreeHtml(tree, fileNames);
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(vaultName)} — Vault</title>
  <style>${VAULT_EXPORT_STYLES}\nhtml, body { background: ${bodyBg}; }\n.vt-content { display: flex; }\n.vt-content iframe { flex: 1; border: 0; width: 100%; height: 100vh; background: ${bodyBg}; }</style>
</head>
<body>
  <aside class="vt-sidebar">${treeHtml}</aside><div class="vt-resizer"></div>
  <main class="vt-content"><iframe id="vt-frame" src=""></iframe></main>
  <script>
  (function () {
    var leaves = [].slice.call(document.querySelectorAll('.vt-file'));
    var frame = document.getElementById('vt-frame');
    function load(leaf) {
      var href = leaf.getAttribute('data-href');
      frame.src = href;
      leaves.forEach(function (f) { f.classList.toggle('active', f === leaf); });
      // Reflect the open doc in the URL as ?file=<vault-relative path> so it
      // can be shared/bookmarked and reopened directly.
      var path = leaf.getAttribute('data-path');
      if (path) {
        var url = new URL(location.href);
        url.searchParams.set('file', path);
        history.replaceState(null, '', url);
      }
    }
    leaves.forEach(function (f) {
      f.querySelector('.vt-row').addEventListener('click', function () { load(f); });
    });
    // Deep link: ?file=<path> → open that doc; fall back to the first file.
    var target = new URLSearchParams(location.search).get('file');
    var initial = (target && leaves.filter(function (f) { return f.getAttribute('data-path') === target; })[0]) || leaves[0];
    if (initial) load(initial);
  })();
${VT_RESIZER_SCRIPT}
  </script>
</body>
</html>`;
}

/** Tree for folder mode — leaves carry data-href instead of data-doc. */
function buildFolderTreeHtml(tree: VaultEntry[], fileNames: Map<string, string>): string {
  const walk = (items: VaultEntry[], depth: number): string => {
    const lis: string[] = [];
    for (const e of items) {
      const pad = `padding-left:${12 + depth * 16}px`;
      if (e.type === 'dir') {
        const childHtml = e.children ? walk(e.children, depth + 1) : '';
        lis.push(
          `<li class="vt-dir"><details open><summary class="vt-row" style="${pad}">${indentLines(depth)}<span class="vt-icon">${fileIconMarkup(e, '')}</span><span class="vt-name">${escapeHtml(e.name)}</span></summary><ul>${childHtml}</ul></details></li>`,
        );
      } else {
        const href = fileNames.get(e.path);
        if (!href) continue;
        // data-path = vault-relative path, used for ?file=<path> deep-linking.
        lis.push(
          `<li class="vt-file" data-href="${escapeHtml(href)}" data-path="${escapeHtml(e.path)}"><div class="vt-row" style="${pad}">${indentLines(depth)}<span class="vt-icon">${fileIconMarkup(e, detectFileType(e.path))}</span><span class="vt-name">${escapeHtml(e.name)}</span></div></li>`,
        );
      }
    }
    return lis.join('');
  };
  return `<ul class="vt-root">${walk(tree, 0)}</ul>`;
}

/* ───────────────────────── public entry ───────────────────────── */

export interface VaultExportResult {
  mode: VaultExportMode;
  /** Number of documents actually exported. */
  docCount: number;
  /** Number of files filtered out (binary). */
  filteredCount: number;
}

/** Count binary files filtered out (for reporting). */
function countFilteredFiles(tree: VaultEntry[]): number {
  let n = 0;
  const walk = (items: VaultEntry[]) => {
    for (const e of items) {
      if (e.type === 'file') {
        const ft = detectFileType(e.path);
        const handler = getHandlerById(ft);
        // SVG is filtered out too (rendered markup, not a text doc).
        if (ft === 'svg' || (handler && handler.needsFileContent === false)) n++;
      } else if (e.children) walk(e.children);
    }
  };
  walk(tree);
  return n;
}

/** Shared render prep for vault export — reads stores, filters text files,
 * renders each doc to a body fragment. Used by both download (exportVaultToHtml)
 * and cloud upload (uploadVaultSingleToCloud) so the heavy work isn't duplicated. */
async function prepareVaultExport(opts?: { imageMode?: HtmlImageMode; imageProviderId?: string; onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean }): Promise<{
  textTree: VaultEntry[];
  files: ExportableFile[];
  docs: { docId: string; html: string; css: string; standalone?: string; canvas?: boolean }[];
  vaultName: string;
  theme: 'light' | 'dark';
  codeTheme: string;
  codeThemeCss: string;
  filteredCount: number;
  total: number;
}> {
  const { fileTree, currentVault } = useVaultStore.getState();
  if (!currentVault) throw new Error('NO_VAULT');
  const vaultRoot = currentVault.basePath;
  const vaultName = currentVault.name || currentVault.id || 'vault';

  const theme = resolvedTheme();
  const codeTheme = useAppearanceStore.getState().codeTheme;
  const codeThemeCss = codeTheme === 'auto' ? '' : themeCss(codeTheme);

  // Image handling follows the caller's imageMode (per-export choice from
  // the dialog). In 'upload' mode each markdown image is uploaded to the
  // image provider and src is rewritten to the public URL; 'inline'
  // base64-embeds them. Null provider/cfg when nothing is configured —
  // fileToBodyFragment then falls back to inline.
  const storageStore = useStorageConfigStore.getState();
  const imageMode = opts?.imageMode ?? 'inline';
  const imgId = opts?.imageProviderId ?? storageStore.activeProvider;
  const cfg = storageStore.configs[imgId] ?? null;
  const provider = cfg ? getProvider(imgId) : null;

  const textTree = filterTextTree(fileTree);
  const files = collectFiles(textTree);
  if (files.length === 0) throw new Error('NO_TEXT_FILES');

  const filteredCount = countFilteredFiles(fileTree);
  const total = files.length;

  // Render every doc to a body fragment (+ css) up front, in parallel with a
  // bounded concurrency (each render spins up a DOM root + poll loop, so
  // unbounded Promise.all would mount N trees on document.body at once).
  // Cancellation is honored before a task starts; a CANCELLED rejection
  // aborts the batch via Promise.all.
  let done = 0;
  const docs = await mapWithConcurrency(files, EXPORT_CONCURRENCY, async (f) => {
    if (opts?.shouldCancel?.()) throw new Error('CANCELLED');
    const frag = await fileToBodyFragment(f, vaultRoot, theme, imageMode, provider, cfg);
    opts?.onProgress?.(++done, total);
    return { docId: f.docId, html: frag.html, css: frag.css, standalone: frag.standalone, canvas: frag.canvas };
  });
  return { textTree, files, docs, vaultName, theme, codeTheme, codeThemeCss, filteredCount, total };
}

/**
 * Export the current vault to HTML. Dispatches on `mode`:
 *  - 'single': one self-contained HTML via the OS save dialog.
 *  - 'folder': user picks a parent directory; writes index.html + one HTML
 *    per doc under a <vaultName>/ subfolder.
 *
 * Reads from vaultStore at call time (file tree + manager + current vault),
 * so callers (hook, command palette) can invoke it outside React render.
 */
export async function exportVaultToHtml(
  mode: VaultExportMode,
  opts?: { imageMode?: HtmlImageMode; imageProviderId?: string; onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean },
): Promise<VaultExportResult> {
  const { textTree, files, docs, vaultName, theme, codeTheme, codeThemeCss, filteredCount, total } = await prepareVaultExport(opts);

  if (mode === 'single') {
    const html = assembleSingleHtml(textTree, files, docs, vaultName, theme, codeThemeCss);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const safeName = vaultName.replace(/[/\\]/g, '_');
    await downloadBlob(blob, `${safeName}.html`, ['html']);
    return { mode, docCount: total, filteredCount };
  }

  // folder mode — pick a directory and write index.html + per-doc pages.
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { writeFile, exists, mkdir } = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');
  const picked = await open({ directory: true, multiple: false });
  if (!picked || Array.isArray(picked)) {
    // User cancelled the folder pick — treat as a no-op success with zero docs.
    return { mode, docCount: 0, filteredCount };
  }
  // Put the whole export under a <vaultName> subfolder so the product is
  // self-identifying and index.html lives inside a folder named after the
  // vault — mirrors the cloud folder-upload key prefix (${safeName}/...).
  const safeName = vaultName.replace(/[/\\]/g, '_');
  const outDir = await join(picked as string, safeName);
  if (!(await exists(outDir))) await mkdir(outDir, { recursive: true });
  // docs/ subdir avoids name clashes with anything the user already has
  // under the vault-named folder.
  const docsDir = await join(outDir, 'docs');
  if (!(await exists(docsDir))) await mkdir(docsDir, { recursive: true });

  // per-doc standalone pages
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const pageHtml = docs[i].standalone ?? buildStandaloneDocHtml({ title: f.name.replace(/\.[^.]+$/, ''), bodyHtml: docs[i].html, css: docs[i].css, theme, codeTheme, codeThemeCss });
    const fileName = safeDocFileName(f.docId, f.name);
    await writeFile(await join(docsDir, fileName), new TextEncoder().encode(pageHtml));
    opts?.onProgress?.(i + 1, total);
    if (opts?.shouldCancel?.()) throw new Error('CANCELLED');
  }

  // index.html — tree links resolve to ./docs/<file>
  const indexHtml = assembleFolderIndexHtml(textTree, files, vaultName, theme);
  await writeFile(await join(outDir, 'index.html'), new TextEncoder().encode(indexHtml));

  return { mode, docCount: total, filteredCount };
}

/**
 * Upload the vault as a single self-contained HTML to the configured storage
 * provider (mirrors shareActiveToCloud). Verifies config + html capability,
 * builds the single HTML, uploads via provider.uploadHtml → returns the
 * public URL. Only single mode is supported (folder is multi-file). */
export async function uploadVaultSingleToCloud(opts?: { imageMode?: HtmlImageMode; imageProviderId?: string; fileProviderId?: string; onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean }): Promise<string> {
  const { textTree, files, docs, vaultName, theme, codeThemeCss } = await prepareVaultExport(opts);
  const html = assembleSingleHtml(textTree, files, docs, vaultName, theme, codeThemeCss);
  const store = useStorageConfigStore.getState();
  const fileId = opts?.fileProviderId ?? store.activeProvider;
  const cfg = store.configs[fileId] ?? null;
  if (!cfg || !getProvider(fileId).isConfigured(cfg)) throw new Error('STORAGE_NOT_CONFIGURED');
  const provider = getProvider(fileId);
  if (!provider.capabilities.html) throw new Error('STORAGE_NO_HTML_CAPABILITY');
  return provider.uploadHtml(html, cfg);
}
