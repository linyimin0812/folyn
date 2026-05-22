const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'ul', 'ol', 'table', 'hr', 'div',
]);

export function rehypeSourceLine() {
  return (tree: any) => {
    function walk(node: any) {
      if (
        node.type === 'element' &&
        BLOCK_TAGS.has(node.tagName) &&
        node.position?.start?.line
      ) {
        node.properties = node.properties || {};
        node.properties['dataSourceLine'] = node.position.start.line;
      }
      if (node.children) {
        for (const child of node.children) walk(child);
      }
    }
    walk(tree);
  };
}
