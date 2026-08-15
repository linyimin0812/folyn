import type { Extensions } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { FontFamily } from '@tiptap/extension-font-family';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Mathematics } from '@tiptap/extension-mathematics';
import { RichTextIndent } from './RichTextIndent';
import { RichTextTableCell, RichTextTableHeader } from './RichTextTableCell';
import { RichTextImage, type ImagePasteHandler } from './RichTextImage';
import { RichTextSlashExtension } from './RichTextSlashExtension';

export type MathEditKind = 'inline' | 'block';

/** Live-editor handler invoked when the user clicks an existing math node. */
export type MathEditHandler = (node: PMNode, pos: number, kind: MathEditKind) => void;

// Re-exported so RichTextEditor can type its onImagePaste ref without a
// direct dep on RichTextImage (which pulls in the tiptap/pm/state Plugin).
export type { ImagePasteHandler } from './RichTextImage';

export interface RichTextExtensionsOptions {
  /**
   * When provided (live editor only), clicking an inline/block math node
   * routes here so the host can open its LaTeX editor. The HTML export
   * pipeline calls getRichTextExtensions() without it — generateHTML never
   * runs NodeViews, so the onClick wiring is purely an editor concern.
   */
  onMathEdit?: MathEditHandler;
  /**
   * When provided (live editor only), pasting/dropping image FILES routes
   * here instead of being persisted directly to the vault. The host opens
   * ImagePasteDialog for target/format/size selection, then inserts the
   * resulting Image node. Mirrors the markdown editor's onImagePaste flow.
   * Export pipeline omits it (no live editor, no paste).
   */
  onImagePaste?: ImagePasteHandler;
}

/**
 * Single source of truth for the rich-text editor's extension stack. Used by
 * both RichTextEditor (live editor) and the HTML export pipeline
 * (services/export/richtext.ts → generateHTML) so the exported HTML matches
 * the in-editor schema exactly — adding a new node/mark to the editor
 * automatically makes it exportable, no second list to keep in sync.
 *
 * Mathematics (KaTeX-rendered inline + block LaTeX nodes) ships in the same
 * stack; the export pipeline additionally post-processes the math elements
 * into rendered KaTeX HTML (see services/export/richtext.ts) because
 * generateHTML only emits the node's static HTML, not NodeView output.
 */
export function getRichTextExtensions(options: RichTextExtensionsOptions = {}): Extensions {
  const { onMathEdit, onImagePaste } = options;
  return [
    StarterKit.configure({ codeBlock: { enableTabIndentation: true, tabSize: 2 } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    FontFamily.configure({ types: ['textStyle'] }),
    TextAlign.configure({ types: ['paragraph', 'heading'] }),
    Highlight.configure({ multicolor: true }),
    Mathematics.configure({
      // throwOnError:false — invalid LaTeX renders the raw source (KaTeX red
      // error styling) instead of throwing and killing the NodeView.
      katexOptions: { throwOnError: false },
      inlineOptions: onMathEdit ? { onClick: (node, pos) => onMathEdit(node, pos, 'inline') } : undefined,
      blockOptions: onMathEdit ? { onClick: (node, pos) => onMathEdit(node, pos, 'block') } : undefined,
    }),
    RichTextIndent,
    TableKit.configure({
      table: { allowTableNodeSelection: true, resizable: true },
      tableCell: false,
      tableHeader: false,
    }),
    RichTextTableCell,
    RichTextTableHeader,
    RichTextImage.configure({ onImagePaste }),
    RichTextSlashExtension,
  ];
}
