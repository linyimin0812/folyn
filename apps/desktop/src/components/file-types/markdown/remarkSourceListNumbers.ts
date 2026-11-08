/**
 * Remark extension: ordered-list items show the number written in the source.
 *
 * CommonMark only honors the FIRST item's number (the list `start`) and
 * renumbers the rest consecutively, so `1. / ~~2. x~~ / 3. / 4.` (the struck
 * line is a lazy continuation of item 1, not an item) previews as 1, 2, 3
 * while the source reads 1, 3, 4. This stamps each listItem with
 * `hProperties.value = <source number>` so remark-rehype emits
 * `<li value="n">` and the marker matches what the writer typed.
 *
 * file.value is the exact markdown string the tree's positions index into
 * (the preprocessed string handed to processSync). Items whose source has no
 * parseable `N.` / `N)` marker, or without offsets, are left untouched.
 */
const ITEM_NUMBER = /^(\d{1,9})[.)]/;

export function remarkSourceListNumbers() {
  return (tree: any, file: any) => {
    const src = typeof file?.value === 'string' ? file.value : null;
    if (src === null) return;
    const visit = (node: any) => {
      const kids = Array.isArray(node?.children) ? node.children : [];
      if (node.type === 'list' && node.ordered) {
        for (const item of kids) {
          const offset = item?.type === 'listItem' ? item.position?.start?.offset : undefined;
          if (typeof offset !== 'number') continue;
          const m = ITEM_NUMBER.exec(src.slice(offset, offset + 11));
          if (!m) continue;
          item.data = { ...item.data, hProperties: { ...item.data?.hProperties, value: Number(m[1]) } };
        }
      }
      for (const child of kids) visit(child);
    };
    visit(tree);
  };
}
