/**
 * Rehype extension: remove <br> nodes inside <code> elements (within <pre> blocks).
 * remark-breaks converts soft line breaks to <br> in paragraphs,
 * but can also leak <br> into code blocks, causing extra blank lines in preview.
 */
export function rehypeRemoveCodeBreaks() {
  function walk(node: any, insideCode: boolean) {
    if (!node || !Array.isArray(node.children)) return;
    const isCodeElement = node.type === 'element' && node.tagName === 'code';
    if (isCodeElement || insideCode) {
      node.children = node.children.filter(
        (child: any) => !(child.type === 'element' && child.tagName === 'br'),
      );
    }
    for (const child of node.children) {
      walk(child, insideCode || isCodeElement);
    }
  }
  return (tree: any) => walk(tree, false);
}
