// ponytail: markmap-lib → @vscode/markdown-it-katex →
// katex.renderToString emits <span class="katex"><span class="katex-
// mathml"><math>…</math></span><span class="katex-html">…</span></span>.
// .katex-mathml is a 1px, clip-path-hidden accessibility copy with
// `position: absolute`; inside an SVG foreignObject, WebKit (the Tauri
// WKWebView) resolves that absolute position against the SVG root, so
// the formula renders at the coordinate origin (0,0) — the top-left
// corner — instead of on the node. Chromium doesn't reproduce.
// The katex-html copy is the visible one, so strip the katex-mathml
// span from node.content after transform (it's only for screen
// readers; visually hidden via CSS in normal katex usage).

import type { IPureNode } from 'markmap-common';

export function stripMathmlFromTree(node: IPureNode): void {
  if (node.content && node.content.includes('katex-mathml')) {
    node.content = node.content.replace(
      /<span class="katex-mathml">[\s\S]*?<\/span>(?=\s*<span class="katex-html")/g,
      '',
    );
  }
  if (node.children) {
    for (const c of node.children) stripMathmlFromTree(c);
  }
}
