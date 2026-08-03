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
  Undo,
  Redo,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Baseline,
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

  // ponytail: split buttons into two segments so the font/color/align
  // controls can render between text marks (bold/italic/underline/strike)
  // and block types (headings/lists). The new controls need custom UI
  // (combobox, swatch button, three align buttons) — not the icon-button
  // pattern the mapped array uses.
  const buttonsEarly: ToolButton[] = [
    { icon: Bold, title: 'Bold', active: editor.isActive('bold'), disabled: !editor.can().toggleBold(), onClick: () => editor.chain().focus().toggleBold().run() },
    { icon: Italic, title: 'Italic', active: editor.isActive('italic'), disabled: !editor.can().toggleItalic(), onClick: () => editor.chain().focus().toggleItalic().run() },
    { icon: Underline, title: 'Underline', active: editor.isActive('underline'), disabled: !editor.can().toggleUnderline(), onClick: () => editor.chain().focus().toggleUnderline().run() },
    { icon: Strikethrough, title: 'Strikethrough', active: editor.isActive('strike'), disabled: !editor.can().toggleStrike(), onClick: () => editor.chain().focus().toggleStrike().run() },
  ];

  // ponytail: font family combobox — native <select> styled to match
  // the toolbar. Common system + web-safe fonts incl. system default.
  // Tiptap's FontFamily extension stores the value as a textStyle mark
  // attr; value is a CSS font-family string.
  const FONT_OPTIONS: { label: string; value: string }[] = [
    { label: 'Default', value: '' },
    { label: 'Inter', value: 'Inter, sans-serif' },
    { label: 'System UI', value: 'system-ui, sans-serif' },
    { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
    { label: 'Helvetica', value: 'Helvetica, sans-serif' },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'Times', value: '"Times New Roman", Times, serif' },
    { label: 'Garamond', value: '"EB Garamond", Garamond, serif' },
    { label: 'Courier', value: '"Courier New", Courier, monospace' },
    { label: 'Mono', value: 'ui-monospace, SFMono-Regular, monospace' },
    { label: 'Verdana', value: 'Verdana, sans-serif' },
    { label: 'Tahoma', value: 'Tahoma, sans-serif' },
    { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' },
    { label: 'Comic Sans', value: '"Comic Sans MS", "Comic Sans", cursive' },
  ];
  const currentFont = (editor.getAttributes('textStyle').fontFamily as string | undefined) ?? '';

  // ponytail: text color button — opens a small popover with the same
  // 10-swatch palette as table cell bg (kept inline here to avoid a new
  // shared module just for this list). Custom color opens native
  // <input type="color">; unsetColor removes the mark.
  const [colorOpen, setColorOpen] = useState(false);
  const currentColor = (editor.getAttributes('textStyle').color as string | undefined) ?? '#000000';
  const colorSwatches = ['#000000', '#52525b', '#a1a1aa', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'];

  const alignButtons: ToolButton[] = [
    { icon: AlignLeft, title: 'Align left', active: editor.isActive({ textAlign: 'left' }) || (!editor.isActive({ textAlign: 'center' }) && !editor.isActive({ textAlign: 'right' })), disabled: !editor.can().setTextAlign('left'), onClick: () => editor.chain().focus().setTextAlign('left').run() },
    { icon: AlignCenter, title: 'Align center', active: editor.isActive({ textAlign: 'center' }), disabled: !editor.can().setTextAlign('center'), onClick: () => editor.chain().focus().setTextAlign('center').run() },
    { icon: AlignRight, title: 'Align right', active: editor.isActive({ textAlign: 'right' }), disabled: !editor.can().setTextAlign('right'), onClick: () => editor.chain().focus().setTextAlign('right').run() },
  ];

  const buttonsRest: ToolButton[] = [
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

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-[2px] px-2 py-1 border-b border-brd bg-surf2">
        {buttonsEarly.map((b, i) => (
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
        {/* ponytail: font family combobox — native <select> over a custom
            dropdown; same reasoning as the URL modal (avoid window.prompt).
            Width auto-sizes to the longest label so it doesn't jump. */}
        <select
          title="Font family"
          value={currentFont}
          onChange={(e) => {
            const v = e.target.value;
            if (v) editor.chain().focus().setFontFamily(v).run();
            else editor.chain().focus().unsetFontFamily().run();
          }}
          className="h-7 px-1 rounded text-t2 text-xs bg-transparent border-none hover:bg-hov hover:text-t1 cursor-pointer outline-none"
        >
          {FONT_OPTIONS.map((opt) => (
            <option key={opt.value || 'default'} value={opt.value} style={{ fontFamily: opt.value || undefined }}>
              {opt.label}
            </option>
          ))}
        </select>
        {/* ponytail: text color button — A icon with a colored bar under
            it reflecting the active color. Click opens the swatch popover
            (same palette as table cell bg). */}
        <div className="relative">
          <button
            type="button"
            title="Text color"
            onClick={() => setColorOpen((v) => !v)}
            className="relative inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1"
          >
            <Baseline size={15} strokeWidth={1.6} />
            <span
              className="absolute left-1 right-1 bottom-1 h-[3px] rounded-sm"
              style={{ backgroundColor: currentColor }}
            />
          </button>
          {colorOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setColorOpen(false)} aria-hidden />
              <div
                className="absolute top-full left-0 mt-1 z-50 p-2 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)] grid grid-cols-5 gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                {colorSwatches.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => {
                      editor.chain().focus().setColor(c).run();
                      setColorOpen(false);
                    }}
                    className="w-6 h-6 rounded-md border border-brd hover:scale-110 transition-transform"
                    style={{ backgroundColor: c }}
                  />
                ))}
                <button
                  type="button"
                  title="Clear color"
                  onClick={() => {
                    editor.chain().focus().unsetColor().run();
                    setColorOpen(false);
                  }}
                  className="col-span-5 mt-1 py-1 rounded text-[10px] text-t3 hover:bg-hov"
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>
        {/* ponytail: align buttons — three icon buttons, active state per
            alignment. textAlign defaults to left when unset (the OR
            clause in alignButtons covers that). */}
        {alignButtons.map((b, i) => (
          <button
            key={`al-${i}`}
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
        {buttonsRest.map((b, i) => (
          <button
            key={`rest-${i}`}
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
            on outside click (no window.prompt — same reason as UrlModal).
            All other table ops (merge/split/align/insert row-col/delete)
            live on the table itself: row-left + col-top hover handles in
            TableControlsOverlay, and the cell right-click context menu in
            RichTextEditor. */}
        <div className="relative">
          <button
            type="button"
            title={t('editor:table.insertButton.title')}
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
