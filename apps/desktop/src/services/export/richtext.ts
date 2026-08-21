import { generateHTML } from '@tiptap/react';
import katex from 'katex';
// ponytail: Vite `?inline` returns the raw CSS text (not a <link>), so the
// standalone export can embed KaTeX's layout rules without a CDN stylesheet
// or an extra network dependency. Font files stay external (CDN below) —
// KaTeX falls back to system serif glyphs if fonts can't load.
import katexCss from 'katex/dist/katex.min.css?inline';
import { getRichTextExtensions, richTextLowlight } from '@/components/file-types/rich-text/richTextExtensions';
import { deserializeToContent, emptyDoc } from '@/components/file-types/rich-text/richTextContent';
import { readImageAsDataUrl, escapeHtml } from './shared';
import { resolveBasePath } from '@/utils/pathResolver';
import { isLoadableUrlScheme } from '@/components/file-types/rich-text/richTextContent';

// ponytail: hand-rolled CSS mirroring the editor's Tailwind classes. The
// editor styles via `[&_.ProseMirror_…]` arbitrary variants on a wrapper
// that depends on Tailwind + the app's CSS-var theme — neither is available
// in a standalone HTML file. Inline the rendered subset; keep it small so
// the exported file opens with zero deps. Upgrade path: extract editor
// styles to a shared CSS file when a second consumer needs the live theme.
const RT_HTML_STYLES = `
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1f2430; line-height: 1.6; }
h1 { font-size: 1.5rem; font-weight: 700; margin: 0.75rem 0; }
h2 { font-size: 1.25rem; font-weight: 600; margin: 0.75rem 0; }
h3 { font-size: 1.1rem; font-weight: 600; margin: 0.5rem 0; }
p { margin: 0.5rem 0; }
ul, ol { padding-left: 1.5rem; margin: 0.5rem 0; }
ul[data-type="taskList"] { list-style: none; padding-left: 0; }
ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5rem; }
ul[data-type="taskList"] li label { flex-shrink: 0; }
blockquote { border-left: 2px solid #d0d0d0; padding-left: 1rem; color: #555; margin: 0.5rem 0; }
pre { background: #f4f4f5; border-radius: 4px; padding: 0.75rem; overflow-x: auto; }
code { background: #f4f4f5; padding: 0 4px; border-radius: 3px; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
pre code { background: none; padding: 0; }
hr { border: none; border-top: 1px solid #d0d0d0; margin: 1rem 0; }
a { color: #3b82f6; text-decoration: underline; }
table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
th, td { border: 1px solid #d0d0d0; padding: 4px 8px; }
th { background: #f4f4f5; text-align: left; font-weight: 600; }
/* empty cells keep row height: tiptap serializes an empty cell as
   <td><p></p></td> — an empty <p> has no line box, so the cell (and any
   fully-empty row) collapses. ::after injects a non-breaking space, giving
   the cell a line box at the same height as a text cell (mirrors the
   editor, where contenteditable keeps an editable <br> in empty cells). */
td:empty::after, th:empty::after,
td p:empty::after, th p:empty::after { content: "\\00a0"; }
img { max-width: 100%; height: auto; }
figure { margin: 0.5rem 0; }
figure[data-align="left"] { margin-right: auto; }
figure[data-align="center"] { margin-left: auto; margin-right: auto; }
figure[data-align="right"] { margin-left: auto; }
figcaption { text-align: center; font-size: 0.85rem; color: #888; margin-top: 0.25rem; }
/* exported math elements carry only data-type (the NodeView adds
   .tiptap-mathematics-render, which generateHTML never runs) */
[data-type="inline-math"] { white-space: nowrap; }
[data-type="block-math"] { display: block; text-align: center; margin: 0.75rem 0; }
/* ponytail: CodeBlockLowlight decorates tokens as <span class="hljs-…">.
   generateHTML runs the extension's renderHTML, so the export picks up the
   same token spans as the live editor. Light-only palette mirrors the
   md-preview light rules — the export body has no dark theme. */
pre code .hljs-comment, pre code .hljs-quote { color: #940; }
pre code .hljs-keyword, pre code .hljs-selector-tag { color: #708; }
pre code .hljs-number, pre code .hljs-literal { color: #164; }
pre code .hljs-string, pre code .hljs-addition { color: #a11; }
pre code .hljs-regexp { color: #e40; }
pre code .hljs-tag, pre code .hljs-name { color: #170; }
pre code .hljs-attr, pre code .hljs-variable, pre code .hljs-template-variable { color: #00c; }
pre code .hljs-attribute { color: #00c; }
pre code .hljs-type, pre code .hljs-built_in, pre code .hljs-builtin-name, pre code .hljs-class .hljs-title { color: #085; }
pre code .hljs-meta { color: #555; }
pre code .hljs-title, pre code .hljs-function .hljs-title { color: #00f; }
pre code .hljs-section { color: #00f; }
pre code .hljs-deletion { color: #a11; }
pre code .hljs-symbol, pre code .hljs-bullet { color: #708; }
pre code .hljs-link { color: #219; }
pre code .hljs-emphasis { font-style: italic; }
pre code .hljs-strong { font-weight: bold; }
`;

// KaTeX's @font-face rules reference `fonts/...` relative to the CSS file.
// In the standalone export there is no fonts/ dir, so rewrite them to the
// jsdelivr CDN (version must track the `katex` dependency in package.json).
// Online exports render with real KaTeX fonts; offline, the browser 404s
// and KaTeX falls back to its serif glyph stack — layout still works.
const KATEX_FONT_CDN_BASE = 'https://cdn.jsdelivr.net/npm/katex@0.16.47/dist';

function katexCssForExport(): string {
  return katexCss.replace(/url\((fonts\/[^)]+)\)/g, (_m, p: string) => `url(${KATEX_FONT_CDN_BASE}/${p})`);
}

/**
 * generateHTML only emits each node's static renderHTML — math nodes come
 * out as empty `<span data-type="inline-math" data-latex="...">` /
 * `<div data-type="block-math">` because their KaTeX output lives in the
 * NodeView, which generateHTML never runs. Post-process those elements into
 * real KaTeX HTML so the exported file shows the formula.
 */
function renderRichTextMath(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes = Array.from(doc.querySelectorAll('[data-type="inline-math"], [data-type="block-math"]'));
  if (nodes.length === 0) return html;
  for (const el of nodes) {
    const latex = el.getAttribute('data-latex') ?? '';
    const isBlock = el.getAttribute('data-type') === 'block-math';
    // throwOnError:false mirrors the editor's katexOptions — invalid LaTeX
    // renders the raw source (KaTeX red error styling) instead of throwing.
    el.innerHTML = katex.renderToString(latex, { throwOnError: false, displayMode: isBlock });
  }
  return doc.body.innerHTML;
}

// ponytail: serialize lowlight's hast tree to a token-span HTML string.
// Mirrors CodeBlockLowlight's parseNodes (decorations build path) so the
// export HTML matches the in-editor highlighting token-for-token. ~15 lines
// over pulling in hast-util-to-html; we only need <span class="…">text</span>
// for text/element nodes — no properties beyond className, no comments.
function serializeHast(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return escapeHtml(node.value ?? '');
  if (node.type === 'root') return (node.children ?? []).map(serializeHast).join('');
  const cls = node.properties?.className;
  const classAttr = Array.isArray(cls) && cls.length
    ? ` class="${cls.map(escapeHtml).join(' ')}"`
    : '';
  const inner = (node.children ?? []).map(serializeHast).join('');
  return `<span${classAttr}>${inner}</span>`;
}

/**
 * generateHTML runs each node's static renderHTML — for CodeBlockLowlight
 * that's the inherited CodeBlock `<pre><code class="language-…">text</code>`
 * (the lowlight plugin that decorates tokens only runs inside a live
 * ProseMirror view, not generateHTML). Post-process: re-run lowlight on
 * each code block and swap its innerHTML for the token spans. Same
 * lowlight instance as the editor → same grammar coverage + same colors.
 */
function renderRichTextCode(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const codeEls = Array.from(doc.querySelectorAll('pre > code'));
  if (codeEls.length === 0) return html;
  for (const codeEl of codeEls) {
    const lang = (codeEl.className.match(/language-([\w-]+)/) || [])[1];
    const text = codeEl.textContent ?? '';
    try {
      const tree = lang && richTextLowlight.registered(lang)
        ? richTextLowlight.highlight(lang, text)
        : richTextLowlight.highlightAuto(text);
      codeEl.innerHTML = serializeHast(tree);
    } catch {
      // unknown language / parse error → leave raw text
    }
  }
  return doc.body.innerHTML;
}

/**
 * Inline vault-relative `<img src="assets/...">` as base64 data URLs so the
 * exported HTML is self-contained. Mirrors inlineImages for markdown, but
 * rich-text stores bare vault-relative paths (no `vault-file://` scheme).
 * URL-scheme srcs (http/data/asset/blob) pass through unchanged.
 */
async function inlineRichTextImages(html: string, vaultRoot: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img'));
  if (imgs.length === 0) return html;
  const resolvedRoot = vaultRoot ? await resolveBasePath(vaultRoot) : '';
  if (!resolvedRoot) return doc.body.innerHTML;
  const { join } = await import('@tauri-apps/api/path');
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') ?? '';
      if (!src || isLoadableUrlScheme(src)) return;
      try {
        const abs = await join(resolvedRoot, src.replace(/^\.\//, '').replace(/^\/+/, ''));
        const dataUrl = await readImageAsDataUrl(abs);
        if (dataUrl) img.setAttribute('src', dataUrl);
      } catch {
        // leave original src — better a broken img than a failed export
      }
    }),
  );
  return doc.body.innerHTML;
}

/**
 * Render a rich-text doc (JSON-on-disk string) to a self-contained HTML
 * Blob. Uses the same extension stack as the live editor so the schema
 * matches exactly; vault-relative image srcs are inlined as base64.
 */
export async function richTextToHtmlBlob(
  content: string,
  name: string,
  vaultRoot: string,
): Promise<Blob> {
  const doc = deserializeToContent(content) ?? emptyDoc();
  const bodyHtml = generateHTML(doc, getRichTextExtensions());
  const withMath = renderRichTextMath(bodyHtml);
  const withCode = renderRichTextCode(withMath);
  const inlined = await inlineRichTextImages(withCode, vaultRoot);
  const baseName = name.replace(/\.[^.]+$/, '');
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(baseName)}</title>
  <style>${RT_HTML_STYLES}
${katexCssForExport()}</style>
</head>
<body>
${inlined}
</body>
</html>`;
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}
