// ponytail: markmap-lib's katex plugin emits the full katex output
// (katex-mathml <math> + katex-html) inside node.content. The <math>
// MathML element inside SVG foreignObject can escape its parent div
// due to namespace handling and render at the SVG root (0, 0) — visible
// as "formula at top-left corner, not on the node". Strip the
// katex-mathml wrapper (it's only for screen readers; visually hidden
// via CSS in normal katex usage) so only the HTML/CSS katex-html part
// remains inside the foreignObject.

import type { IPureNode } from 'markmap-common';

export function stripMathmlFromTree(node: IPureNode): void {
  if (node.content && node.content.includes('katex-mathml')) {
    node.content = node.content.replace(
      /<span class="katex-mathml">[\s\S]*?<\/span>\s*(?=<span class="katex-html")/g,
      '',
    );
  }
  if (node.children) {
    for (const c of node.children) stripMathmlFromTree(c);
  }
}
