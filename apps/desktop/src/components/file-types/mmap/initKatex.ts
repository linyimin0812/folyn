// ponytail: markmap-lib's browser build (the one Vite resolves via the
// package `browser` export) overrides the katex renderer to read
// `window.katex` at transform time: if absent it falls back to emitting
// the raw `$...$` source text and schedules a CDN autoload + retransform
// that nobody in this app listens to. The app already bundles katex
// (^0.16.47) for MarkdownPreview, so import it locally + its CSS and
// assign to window before any transform runs. MathML is stripped from
// the transformed tree instead; see stripMathml.ts.
// Module side effects run once (ESM cache); safe to import from both
// the preview and the export path.

import katex from 'katex';
import 'katex/dist/katex.min.css';

declare global {
  interface Window { katex?: typeof katex; }
}

window.katex = window.katex ?? katex;
