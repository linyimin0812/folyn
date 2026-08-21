// ponytail: markmap-lib renders math by calling `window.katex.renderToString`
// at transform time (its browser build checks `window.katex`). katex emits
// HTML whose layout relies on CSS table display + relative/absolute
// positioning; inside an SVG <foreignObject>, WebKit (the Tauri WKWebView)
// resolves those positions against the SVG root, so the formula paints at the
// top-left corner instead of on the node. No katex output tweak fixes it
// (html-only, inline-only) — the CSS layout itself is what breaks.
//
// The app already bundles MathJax (mathjax-full, via rehype-mathjax) for
// MarkdownPreview. MathJax's SVG output is pure <svg>/<path> markup with no
// CSS positioning, so it renders correctly inside the foreignObject. Install
// a fake `window.katex` whose renderToString returns MathJax SVG; markmap-lib
// keeps its markdown-it math plugin but the node content now lands as SVG.
// Always render inline (display:false): display math's block wrapper
// (`margin:1em 0`) trips the same WebKit foreignObject bug.
// Module side effects run once (ESM cache); safe to import from both the
// preview and the export path.

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js';

type KatexShim = {
  renderToString: (latex: string, options?: { displayMode?: boolean; throwOnError?: boolean }) => string;
};

declare global {
  interface Window { katex?: KatexShim; }
}

// One MathJax document is reused across renders; its counter keeps each
// formula's SVG <defs> ids unique.
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const texInput = new TeX({ packages: AllPackages });
const svgOutput = new SVG();
const mathDoc = mathjax.document('', { InputJax: texInput, OutputJax: svgOutput });

// MathJax's SVG layout stylesheet (mjx-container direction / overflow) is
// tiny; inject it once so the inline SVG scales and aligns correctly.
const stylesheet = adaptor.textContent(svgOutput.styleSheet(mathDoc) as LiteElement);
if (typeof document !== 'undefined' && stylesheet) {
  const style = document.createElement('style');
  style.setAttribute('data-markmap-mathjax', '');
  style.textContent = stylesheet;
  document.head.appendChild(style);
}

const katexShim: KatexShim = {
  renderToString(latex) {
    try {
      const node = mathDoc.convert(latex, { display: false }) as unknown as LiteElement;
      return adaptor.outerHTML(node);
    } catch {
      // Truly unparseable TeX: fall back to the raw source text.
      return latex;
    }
  },
};

// katex's UMD types also type `window.katex` as the full katex API; cast the
// minimal shim past that intersection (markmap-lib only calls renderToString).
window.katex = katexShim as unknown as typeof window.katex;
