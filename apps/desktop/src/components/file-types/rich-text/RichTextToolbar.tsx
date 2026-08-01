import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Code2,
  Minus,
  Link as LinkIcon,
  Image as ImageIcon,
  Table as TableIcon,
  Columns3,
  Rows3,
  TableCellsMerge,
  TableCellsSplit,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Plus,
  Trash2,
  Undo,
  Redo,
} from 'lucide-react';
import { isTauri } from '@/utils/platform';
import { persistImageBytes } from './RichTextImage';
import { TableSizeGrid } from './TableSizeGrid';

// ponytail: icon-only buttons with title= attributes — no visible text, so
// no i18n namespace sprawl. Active state via editor.isActive(); disabled
// when the command is unavailable (no selection / not editable). One row,
// wraps on narrow widths. Matches the host-drawn toolbar pattern from
// file-type-editors.md (GrapesJS: panels disabled, host self-draws).
//
// Link + image-by-URL entry use a small inline modal (local useState) instead
// of window.prompt — userscripts can intercept window.prompt and the codebase
// avoids it (see PetSettings.tsx). Tauri-only bits (file picker, fs read) are
// gated on isTauri().

interface RichTextToolbarProps {
  editor: Editor;
}

interface ToolButton {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

type ModalKind = 'link' | null;

// ponytail: shared button className for toolbar icon buttons — kept here so
// the inline table-insert button (rendered outside the buttons[] array for
// its relative popover anchor) stays visually identical to the mapped ones.
const TOOL_BTN_CLASS =
  'inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-default';

// ponytail: one modal serves both link and image-URL entry — same shape (a URL
// input + OK/Cancel). title + placeholder differ. Reused rather than forked.
function UrlModal({
  title,
  placeholder,
  initial,
  onConfirm,
  onCancel,
}: {
  title: string;
  placeholder: string;
  initial: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = () => {
    onConfirm(value.trim());
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div
        className="w-[360px] rounded-lg border border-brd bg-panel shadow-lg p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[length:calc(var(--ui-font-size)+1px)] font-semibold text-t1 mb-2">{title}</div>
        <input
          autoFocus
          type="url"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          className="w-full px-2 py-1.5 rounded border border-brd2 bg-surf text-t1 text-[length:var(--ui-font-size)] outline-none focus:border-acc"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 rounded text-t2 hover:bg-hov text-[length:var(--ui-font-size)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value}
            className="px-3 py-1 rounded bg-acc text-white hover:opacity-90 disabled:opacity-40 text-[length:var(--ui-font-size)]"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export function RichTextToolbar({ editor }: RichTextToolbarProps) {
  const { t } = useTranslation();
  const [modal, setModal] = useState<ModalKind>(null);
  // The initial URL the modal opens with (prev link href, or '' for image).
  const [modalInitial, setModalInitial] = useState('');
  // ponytail: table-size grid popover anchored under the insert-table button.
  // Replaces the old fixed 2x2 insertTable call. Click-outside dismisses.
  const [tablePickerOpen, setTablePickerOpen] = useState(false);

  const openLinkModal = () => {
    setModalInitial((editor.getAttributes('link').href as string | undefined) ?? '');
    setModal('link');
  };
  const confirmLink = (url: string) => {
    setModal(null);
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  // ponytail: native file picker for image insertion. Reads the picked file's
  // bytes via @tauri-apps/plugin-fs, hash-names, writes to the vault, inserts
  // a vault-relative-src Image node. Shares persistImageBytes with paste/drop.
  // isTauri() gate: no-op outside Tauri (browser dev) — paste/drop still work.
  // Image-by-URL entry is covered by the paste plugin's bare-URL detection
  // (RichTextImage.tsx), so no separate URL modal here.
  const pickImageFile = async () => {
    if (!isTauri()) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({
        multiple: false,
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] },
        ],
      });
      if (!picked || Array.isArray(picked)) return;
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = new Uint8Array(await readFile(picked as string));
      const ext = (picked as string).toLowerCase().match(/\.([^.]+)$/)?.[1] ?? 'png';
      const relPath = await persistImageBytes(bytes, ext);
      editor.chain().focus().setImage({ src: relPath }).run();
    } catch (err) {
      console.warn('[rich-text] image pick failed:', err);
    }
  };

  const inTable = editor.isActive('table');
  const cellAlign = editor.getAttributes('tableCell').align as string | undefined;

  const buttons: ToolButton[] = [
    // ponytail: slash-command trigger button. Inserts '/' at cursor; the
    // RichTextSlashExtension's computeSlashState detects it on the next
    // transaction and opens the menu. Same effect as the Mod-/ shortcut.
    {
      icon: Plus,
      title: t('editor:slashMenu.richText.triggerButton'),
      disabled: !editor.isEditable,
      onClick: () => editor.chain().focus().insertContent('/').run(),
    },
    { icon: Bold, title: 'Bold', active: editor.isActive('bold'), disabled: !editor.can().toggleBold(), onClick: () => editor.chain().focus().toggleBold().run() },
    { icon: Italic, title: 'Italic', active: editor.isActive('italic'), disabled: !editor.can().toggleItalic(), onClick: () => editor.chain().focus().toggleItalic().run() },
    { icon: Underline, title: 'Underline', active: editor.isActive('underline'), disabled: !editor.can().toggleUnderline(), onClick: () => editor.chain().focus().toggleUnderline().run() },
    { icon: Strikethrough, title: 'Strikethrough', active: editor.isActive('strike'), disabled: !editor.can().toggleStrike(), onClick: () => editor.chain().focus().toggleStrike().run() },
    { icon: Heading1, title: 'Heading 1', active: editor.isActive('heading', { level: 1 }), disabled: !editor.can().toggleHeading({ level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { icon: Heading2, title: 'Heading 2', active: editor.isActive('heading', { level: 2 }), disabled: !editor.can().toggleHeading({ level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: Heading3, title: 'Heading 3', active: editor.isActive('heading', { level: 3 }), disabled: !editor.can().toggleHeading({ level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { icon: List, title: 'Bullet list', active: editor.isActive('bulletList'), disabled: !editor.can().toggleBulletList(), onClick: () => editor.chain().focus().toggleBulletList().run() },
    { icon: ListOrdered, title: 'Ordered list', active: editor.isActive('orderedList'), disabled: !editor.can().toggleOrderedList(), onClick: () => editor.chain().focus().toggleOrderedList().run() },
    { icon: ListChecks, title: 'Task list', active: editor.isActive('taskList'), disabled: !editor.can().toggleTaskList(), onClick: () => editor.chain().focus().toggleTaskList().run() },
    { icon: Quote, title: 'Blockquote', active: editor.isActive('blockquote'), disabled: !editor.can().toggleBlockquote(), onClick: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: Code, title: 'Inline code', active: editor.isActive('code'), disabled: !editor.can().toggleCode(), onClick: () => editor.chain().focus().toggleCode().run() },
    { icon: Code2, title: 'Code block', active: editor.isActive('codeBlock'), disabled: !editor.can().toggleCodeBlock(), onClick: () => editor.chain().focus().toggleCodeBlock().run() },
    { icon: Minus, title: 'Horizontal rule', disabled: !editor.can().setHorizontalRule(), onClick: () => editor.chain().focus().setHorizontalRule().run() },
    { icon: LinkIcon, title: 'Link', active: editor.isActive('link'), disabled: !editor.can().toggleLink({ href: '' }), onClick: openLinkModal },
    { icon: ImageIcon, title: 'Insert image', onClick: () => { void pickImageFile(); } },
  ];

  // ponytail: trailing Undo/Redo rendered after the inline table-insert
  // popover button so the popover anchor sits between image and undo (its
  // original toolbar slot).
  const trailingButtons: ToolButton[] = [
    { icon: Undo, title: 'Undo', disabled: !editor.can().undo(), onClick: () => editor.chain().focus().undo().run() },
    { icon: Redo, title: 'Redo', disabled: !editor.can().redo(), onClick: () => editor.chain().focus().redo().run() },
  ];

  // ponytail: table cell-context controls — shown only when the cursor is
  // inside a table. Merge/split/align are the new ops (align sets the cell's
  // built-in `align` attribute → renders as `text-align`). Structural
  // add/del col/row use Columns3/Rows3/Minus instead of all-Plus so col vs
  // row is distinguishable at a glance; before/after share an icon (title
  // distinguishes) — same as Tiptap's own demo. Header toggle + delete table
  // round it out.
  const tableButtons: ToolButton[] = inTable
    ? [
        { icon: TableCellsMerge, title: 'Merge cells', disabled: !editor.can().mergeCells(), onClick: () => editor.chain().focus().mergeCells().run() },
        { icon: TableCellsSplit, title: 'Split cell', disabled: !editor.can().splitCell(), onClick: () => editor.chain().focus().splitCell().run() },
        { icon: AlignLeft, title: 'Align left', active: !cellAlign || cellAlign === 'left', onClick: () => editor.chain().focus().setCellAttribute('align', 'left').run() },
        { icon: AlignCenter, title: 'Align center', active: cellAlign === 'center', onClick: () => editor.chain().focus().setCellAttribute('align', 'center').run() },
        { icon: AlignRight, title: 'Align right', active: cellAlign === 'right', onClick: () => editor.chain().focus().setCellAttribute('align', 'right').run() },
        { icon: Columns3, title: 'Add column before', onClick: () => editor.chain().focus().addColumnBefore().run() },
        { icon: Columns3, title: 'Add column after', onClick: () => editor.chain().focus().addColumnAfter().run() },
        { icon: Rows3, title: 'Add row before', onClick: () => editor.chain().focus().addRowBefore().run() },
        { icon: Rows3, title: 'Add row after', onClick: () => editor.chain().focus().addRowAfter().run() },
        { icon: Minus, title: 'Delete column', onClick: () => editor.chain().focus().deleteColumn().run() },
        { icon: Minus, title: 'Delete row', onClick: () => editor.chain().focus().deleteRow().run() },
        { icon: TableIcon, title: 'Toggle header row', onClick: () => editor.chain().focus().toggleHeaderRow().run() },
        { icon: Trash2, title: 'Delete table', onClick: () => editor.chain().focus().deleteTable().run() },
      ]
    : [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-[2px] px-2 py-1 border-b border-brd bg-surf2">
        {buttons.map((b, i) => (
          <button
            key={i}
            type="button"
            title={b.title}
            disabled={b.disabled}
            onClick={b.onClick}
            className={`inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-default ${
              b.active ? 'bg-accdim text-acc' : ''
            }`}
          >
            <b.icon size={15} strokeWidth={1.6} />
          </button>
        ))}
        {/* ponytail: table-insert is a relative-wrapped button so the size
            grid can anchor under it; a transparent fixed backdrop dismisses
            on outside click (no window.prompt — same reason as UrlModal). */}
        <div className="relative">
          <button
            type="button"
            title="Insert table"
            disabled={!editor.isEditable}
            onClick={() => setTablePickerOpen((v) => !v)}
            className={TOOL_BTN_CLASS}
          >
            <TableIcon size={15} strokeWidth={1.6} />
          </button>
          {tablePickerOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setTablePickerOpen(false)} aria-hidden />
              <div className="absolute top-full right-0 mt-1 z-50" onClick={(e) => e.stopPropagation()}>
                <TableSizeGrid
                  onSelect={(rows, cols) => {
                    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
                    setTablePickerOpen(false);
                  }}
                />
              </div>
            </>
          )}
        </div>
        {trailingButtons.map((b, i) => (
          <button
            key={`tr-${i}`}
            type="button"
            title={b.title}
            disabled={b.disabled}
            onClick={b.onClick}
            className={TOOL_BTN_CLASS}
          >
            <b.icon size={15} strokeWidth={1.6} />
          </button>
        ))}
        {tableButtons.length > 0 && (
          <>
            <span className="mx-1 h-5 w-px bg-brd" aria-hidden />
            {tableButtons.map((b, i) => (
              <button
                key={`tb-${i}`}
                type="button"
                title={b.title}
                disabled={b.disabled}
                onClick={b.onClick}
                className={`inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-default ${
                  b.active ? 'bg-accdim text-acc' : ''
                }`}
              >
                <b.icon size={15} strokeWidth={1.6} />
              </button>
            ))}
          </>
        )}
      </div>
      {modal === 'link' && (
        <UrlModal
          title="Link URL"
          placeholder="https://"
          initial={modalInitial}
          onConfirm={confirmLink}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  );
}
