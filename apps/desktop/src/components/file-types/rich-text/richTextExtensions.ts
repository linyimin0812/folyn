import type { Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { FontFamily } from '@tiptap/extension-font-family';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { RichTextIndent } from './RichTextIndent';
import { RichTextTableCell, RichTextTableHeader } from './RichTextTableCell';
import { RichTextImage } from './RichTextImage';
import { RichTextSlashExtension } from './RichTextSlashExtension';

/**
 * Single source of truth for the rich-text editor's extension stack. Used by
 * both RichTextEditor (live editor) and the HTML export pipeline
 * (services/export/richtext.ts → generateHTML) so the exported HTML matches
 * the in-editor schema exactly — adding a new node/mark to the editor
 * automatically makes it exportable, no second list to keep in sync.
 */
export function getRichTextExtensions(): Extensions {
  return [
    StarterKit.configure({ codeBlock: { enableTabIndentation: true, tabSize: 2 } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    FontFamily.configure({ types: ['textStyle'] }),
    TextAlign.configure({ types: ['paragraph', 'heading'] }),
    Highlight.configure({ multicolor: true }),
    RichTextIndent,
    TableKit.configure({
      table: { allowTableNodeSelection: true, resizable: true },
      tableCell: false,
      tableHeader: false,
    }),
    RichTextTableCell,
    RichTextTableHeader,
    RichTextImage,
    RichTextSlashExtension,
  ];
}
