// ponytail: markmap-lib's katex plugin reads window.katex at transform
// time; if absent it autoloads from CDN (jsdelivr) and triggers a
// retransform — unreliable offline in the Tauri webview. The app
// already bundles katex (^0.16.47) for MarkdownPreview, so import it
// locally + its CSS and assign to window before any transform runs.
// Module side effects run once (ESM cache); safe to import from both
// the preview and the export path.

import katex from 'katex';
import 'katex/dist/katex.min.css';

declare global {
  interface Window { katex?: typeof katex; }
}

window.katex = window.katex ?? katex;
