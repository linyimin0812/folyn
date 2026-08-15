// ponytail: markmap-lib's browser build (the one Vite resolves via the
// package `browser` export) overrides the katex renderer to read
// `window.katex` at transform time: if absent it falls back to emitting
// the raw `$...$` source text and schedules a CDN autoload + retransform
// that nobody in this app listens to. The app already bundles katex
// (^0.16.47) for MarkdownPreview, so import it locally + its CSS and
// install a wrapped copy on window before any transform runs.
//
// The wrapper forces `output: 'html'` so katex never emits its
// accessibility MathML sibling (<math> inside .katex-mathml). That copy
// is a 1px absolutely-positioned element; inside an SVG foreignObject,
// WebKit (the Tauri WKWebView) resolves its position against the SVG
// root, so the formula paints at the top-left corner instead of on the
// node. html-only output keeps the visible katex-html and avoids the
// element entirely — no post-transform stripping needed.
// Module side effects run once (ESM cache); safe to import from both
// the preview and the export path.

import katex from 'katex';
import 'katex/dist/katex.min.css';

declare global {
  interface Window { katex?: typeof katex; }
}

const renderToString = katex.renderToString.bind(katex);
window.katex = {
  ...katex,
  renderToString: (latex: string, options?: Parameters<typeof katex.renderToString>[1]) =>
    renderToString(latex, { ...options, output: 'html' }),
};
