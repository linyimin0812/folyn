import { TableCell as BaseTableCell } from '@tiptap/extension-table/cell';
import { TableHeader as BaseTableHeader } from '@tiptap/extension-table';

// ponytail: extend Tiptap's TableCell + TableHeader to add a `background`
// attr (renders as `style: background-color`). The base node ships
// colspan/rowspan/colwidth/align only — no background. We add it here
// rather than reinvent the cell node, reusing the base's parseHTML/
// renderHTML/empty-content backfill. TableKit is configured with
// `tableCell: false, tableHeader: false` and these custom extensions are
// registered alongside, so setCellAttribute('background', color) works
// (the attr must be declared in the schema or PM rejects the transaction).

function backgroundAttribute() {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => {
      const bg = (element.style.backgroundColor || '').trim();
      return bg || null;
    },
    renderHTML: (attributes: { background?: string | null }) => {
      if (!attributes.background) return {};
      return { style: `background-color: ${attributes.background}` };
    },
  };
}

export const RichTextTableCell = BaseTableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      background: backgroundAttribute(),
    };
  },
});

export const RichTextTableHeader = BaseTableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      background: backgroundAttribute(),
    };
  },
});

