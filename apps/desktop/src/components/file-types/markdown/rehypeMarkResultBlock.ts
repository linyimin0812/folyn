/**
 * Rehype extension: mark the blockquote that immediately follows a
 * `<!-- Result -->` HTML comment with the `run-result` class, so the synced
 * run output keeps its monospace alignment (dir table columns etc.) instead
 * of falling back to the proportional body font every blockquote uses.
 * Without this, saving a run result to the editor "loses" the alignment the
 * live .code-run-output panel had. CSS targets blockquote.run-result.
 *
 * The comment survives into hast via remarkRehype({allowDangerousHtml}) +
 * rehypeRaw as a `comment` node; the run result blockquote is the next
 * non-whitespace sibling. Skip stray whitespace text nodes between them.
 */
export function rehypeMarkResultBlock() {
  return (tree: any) => {
    const kids = Array.isArray(tree.children) ? tree.children : [];
    for (let i = 0; i < kids.length; i++) {
      const node = kids[i];
      if (node?.type !== 'comment' || !/^\s*Result\s*$/.test(node.value ?? '')) continue;
      // Find the next element sibling, tolerating whitespace text nodes.
      let j = i + 1;
      while (j < kids.length && kids[j].type === 'text' && /^\s*$/.test(kids[j].value ?? ' ')) j++;
      const target = kids[j];
      if (target?.type === 'element' && target.tagName === 'blockquote') {
        const props = target.properties || (target.properties = {});
        const cls = Array.isArray(props.className) ? props.className : (props.className ? [String(props.className)] : []);
        if (!cls.includes('run-result')) cls.push('run-result');
        props.className = cls;
      }
    }
  };
}
