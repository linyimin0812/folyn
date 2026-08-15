import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { EditorState } from '@tiptap/pm/state';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
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
  AlignJustify,
  Type,
  Heading,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  Sigma,
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
  zoom: number;
  onZoomChange: (z: number) => void;
  /** Opens the LaTeX math-insert modal (also reachable via slash menu). */
  onInsertMath: () => void;
}

interface ToolButton {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export type TextAlignValue = 'left' | 'center' | 'right' | 'justify' | null;

/**
 * Alignment shared by every textblock under the selection. Unset textAlign
 * attrs count as the default 'left'; returns null when the selection covers
 * mixed alignments (or no textblock) so the toolbar highlights at most one
 * alignment button — and none for mixed selections, matching Word/Google
 * Docs. Pure so it's unit-testable without mounting a prosemirror view.
 *
 * Why not editor.isActive({ textAlign }): isActive is true when ANY node in
 * the selection range matches, and this toolbar's old left-button fallback
 * (!center && !right) forgot 'justify' — so a justified paragraph highlighted
 * Left AND Justify at the same time.
 */
export function selectionTextAlign(state: EditorState): TextAlignValue {
  const { from, to } = state.selection;
  const aligns = new Set<string | null>();
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isTextblock) aligns.add((node.attrs.textAlign as string | undefined) ?? null);
  });
  if (aligns.size !== 1) return null;
  return (aligns.values().next().value as TextAlignValue | undefined) ?? 'left';
}

type ModalKind = 'link' | null;

// ponytail: shared button className for toolbar icon buttons — kept here so
// the inline table-insert button (rendered outside the buttons[] array for
// its relative popover anchor) stays visually identical to the mapped ones.
const TOOL_BTN_CLASS =
  'inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-default';

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

export function RichTextToolbar({ editor, zoom, onZoomChange, onInsertMath }: RichTextToolbarProps) {
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
  // a vault-relative-src Image node. Paste/drop now route through
  // ImagePasteDialog (RichTextEditor.tsx); this button keeps the hash-named
  // direct-persist path (dedup-friendly, no rename prompt).
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

  // ponytail: color dropdown — one button, one popover, two sections
  // (Text Color + Highlight). Same 10-swatch palette for both. Each
  // section's "Custom" is a <label> wrapping a hidden <input type="color">
  // positioned absolutely over the label — the browser natively forwards
  // the click to the input and anchors the picker popover to the label's
  // real screen position (no JS positioning, which macOS WKWebView
  // ignores and falls back to bottom-left corner).
  const [colorOpen, setColorOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const currentColor = (editor.getAttributes('textStyle').color as string | undefined) ?? '#000000';
  const currentHighlight = (editor.getAttributes('highlight').color as string | undefined) ?? '';
  const colorSwatches = ['#000000', '#52525b', '#a1a1aa', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'];
  const headingLevels = [1, 2, 3, 4] as const;

  // ponytail: single shared alignment for the selection — at most one button
  // active (mixed selections highlight none). See selectionTextAlign.
  const align = selectionTextAlign(editor.state);
  const alignButtons: ToolButton[] = [
    { icon: AlignLeft, title: 'Align left', active: align === 'left', disabled: !editor.can().setTextAlign('left'), onClick: () => editor.chain().focus().setTextAlign('left').run() },
    { icon: AlignCenter, title: 'Align center', active: align === 'center', disabled: !editor.can().setTextAlign('center'), onClick: () => editor.chain().focus().setTextAlign('center').run() },
    { icon: AlignRight, title: 'Align right', active: align === 'right', disabled: !editor.can().setTextAlign('right'), onClick: () => editor.chain().focus().setTextAlign('right').run() },
    { icon: AlignJustify, title: 'Align justify', active: align === 'justify', disabled: !editor.can().setTextAlign('justify'), onClick: () => editor.chain().focus().setTextAlign('justify').run() },
  ];

  const buttonsRest: ToolButton[] = [
    { icon: List, title: 'Bullet list', active: editor.isActive('bulletList'), disabled: !editor.can().toggleBulletList(), onClick: () => editor.chain().focus().toggleBulletList().run() },
    { icon: ListOrdered, title: 'Ordered list', active: editor.isActive('orderedList'), disabled: !editor.can().toggleOrderedList(), onClick: () => editor.chain().focus().toggleOrderedList().run() },
    { icon: ListChecks, title: 'Task list', active: editor.isActive('taskList'), disabled: !editor.can().toggleTaskList(), onClick: () => editor.chain().focus().toggleTaskList().run() },
    { icon: Quote, title: 'Blockquote', active: editor.isActive('blockquote'), disabled: !editor.can().toggleBlockquote(), onClick: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: Code, title: 'Inline code', active: editor.isActive('code'), disabled: !editor.can().toggleCode(), onClick: () => editor.chain().focus().toggleCode().run() },
    { icon: Code2, title: 'Code block', active: editor.isActive('codeBlock'), disabled: !editor.can().toggleCodeBlock(), onClick: () => editor.chain().focus().toggleCodeBlock().run() },
    { icon: Minus, title: 'Horizontal rule', disabled: !editor.can().setHorizontalRule(), onClick: () => editor.chain().focus().setHorizontalRule().run() },
    { icon: LinkIcon, title: 'Link', active: editor.isActive('link'), disabled: !editor.can().toggleLink({ href: '' }), onClick: openLinkModal },
    { icon: ImageIcon, title: 'Insert image', onClick: () => { void pickImageFile(); } },
    { icon: Sigma, title: t('editor:math.insertButton'), onClick: onInsertMath },
  ];

  // ponytail: undo/redo rendered as the FIRST group (leftmost), zoom
  // buttons follow, then Heading — user-requested toolbar order. The
  // remaining groups (font/color, marks, align, blocks, table) come after,
  // separated by vertical dividers.
  const undoRedoButtons: ToolButton[] = [
    { icon: Undo, title: 'Undo', disabled: !editor.can().undo(), onClick: () => editor.chain().focus().undo().run() },
    { icon: Redo, title: 'Redo', disabled: !editor.can().redo(), onClick: () => editor.chain().focus().redo().run() },
  ];

  // ponytail: page zoom — CSS `zoom` property is non-standard but works
  // in WebKit (Tauri's engine). Scales the editor content layout, not the
  // toolbar chrome. Range 0.5–2.0, step 0.1.
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2;
  const ZOOM_STEP = 0.1;
  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));
  const zoomOut = () => onZoomChange(clampZoom(zoom - ZOOM_STEP));
  const zoomIn = () => onZoomChange(clampZoom(zoom + ZOOM_STEP));

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-[2px] px-2 py-1 border-b border-brd bg-surf2">
        {/* ponytail: undo/redo — leftmost group. Same TOOL_BTN_CLASS as
            other icon buttons so visual size + press feedback match. */}
        {undoRedoButtons.map((b, i) => (
          <button
            key={`ur-${i}`}
            type="button"
            title={b.title}
            disabled={b.disabled}
            onClick={b.onClick}
            className={TOOL_BTN_CLASS}
          >
            <b.icon size={15} strokeWidth={1.6} />
          </button>
        ))}
        <div className="w-px h-4 bg-brd2 mx-1" aria-hidden />
        {/* ponytail: page zoom — CSS `zoom` applied to the editor content
            wrapper from RichTextEditor. Step 0.1, range 0.5–2.0. The
            percentage text in the middle resets to 100% on click. */}
        <button type="button" title="Zoom out" onClick={zoomOut} className={TOOL_BTN_CLASS}>
          <ZoomOut size={15} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          title={`Reset zoom (${Math.round(zoom * 100)}%)`}
          onClick={() => onZoomChange(1)}
          className="inline-flex items-center justify-center h-7 min-w-[34px] px-1 rounded text-t2 text-[10px] tabular-nums hover:bg-hov hover:text-t1 active:scale-[0.96] transition-transform"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" title="Zoom in" onClick={zoomIn} className={TOOL_BTN_CLASS}>
          <ZoomIn size={15} strokeWidth={1.6} />
        </button>
        <div className="w-px h-4 bg-brd2 mx-1" aria-hidden />
        {/* ponytail: header dropdown — toolbar button uses the lucide
            Heading SVG to match the visual weight of other toolbar
            icons. Concentric radius: outer rounded-lg (8px) + p-1 (4px)
            = inner rounded (4px). Active row gets bg-accdim + text-acc. */}
        <div className="relative">
          <button
            type="button"
            title="Heading"
            onClick={() => setHeaderOpen((v) => !v)}
            className={`inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 active:scale-[0.96] transition-transform ${headingLevels.some((l) => editor.isActive('heading', { level: l })) ? 'bg-accdim text-acc' : ''}`}
          >
            <Heading size={15} strokeWidth={1.6} />
          </button>
          {headerOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setHeaderOpen(false)} aria-hidden />
              <div
                className="absolute top-full left-0 mt-1 z-50 p-1 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)] flex flex-col gap-0.5 min-w-[140px]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  title="Text"
                  onClick={() => {
                    editor.chain().focus().setParagraph().run();
                    setHeaderOpen(false);
                  }}
                  className={`px-2 py-1 rounded flex items-baseline gap-2 text-xs text-left active:scale-[0.96] transition-colors ${
                    editor.isActive('paragraph') && !headingLevels.some((l) => editor.isActive('heading', { level: l }))
                      ? 'bg-accdim text-acc'
                      : 'text-t2 hover:bg-hov hover:text-t1'
                  }`}
                >
                  <span className="font-medium w-5 inline-block text-center">T</span>
                  <span>Text</span>
                </button>
                {headingLevels.map((level) => (
                  <button
                    key={level}
                    type="button"
                    title={`Heading ${level}`}
                    onClick={() => {
                      editor.chain().focus().toggleHeading({ level }).run();
                      setHeaderOpen(false);
                    }}
                    className={`px-2 py-1 rounded flex items-baseline gap-2 text-xs text-left active:scale-[0.96] transition-colors ${
                      editor.isActive('heading', { level })
                        ? 'bg-accdim text-acc'
                        : 'text-t2 hover:bg-hov hover:text-t1'
                    }`}
                  >
                    <span className="font-medium w-5 inline-block text-center">H<sub className="text-[0.7em]">{level}</sub></span>
                    <span>Heading {level}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="w-px h-4 bg-brd2 mx-1" aria-hidden />
        {/* ponytail: font family combobox — fixed width so the toolbar
            doesn't shift when selection changes. Width set on the wrapper;
            select fills it. appearance-none + custom chevron. */}
        <div className="relative">
          <button
            type="button"
            title="Font family"
            onClick={() => setFontOpen((v) => !v)}
            className="inline-flex items-center justify-between h-7 w-[88px] px-1.5 rounded text-t2 text-xs hover:bg-hov hover:text-t1 active:scale-[0.96] transition-transform"
          >
            <span
              className="truncate"
              style={{ fontFamily: currentFont || undefined }}
            >
              {FONT_OPTIONS.find((o) => o.value === currentFont)?.label ?? 'Default'}
            </span>
            <ChevronDown size={10} strokeWidth={1.6} className="shrink-0 ml-1" />
          </button>
          {fontOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFontOpen(false)} aria-hidden />
              <div
                className="absolute top-full left-0 mt-1 z-50 p-1 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)] flex flex-col gap-0.5 min-w-[160px] max-h-[280px] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {FONT_OPTIONS.map((opt) => {
                  const active = opt.value === currentFont;
                  return (
                    <button
                      key={opt.value || 'default'}
                      type="button"
                      title={opt.label}
                      onClick={() => {
                        if (opt.value) editor.chain().focus().setFontFamily(opt.value).run();
                        else editor.chain().focus().unsetFontFamily().run();
                        setFontOpen(false);
                      }}
                      className={`px-2 py-1 rounded text-xs text-left truncate active:scale-[0.96] transition-colors ${
                        active ? 'bg-accdim text-acc' : 'text-t2 hover:bg-hov hover:text-t1'
                      }`}
                      style={{ fontFamily: opt.value || undefined }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {/* ponytail: color dropdown — one button, one popover, two sections
            (Text Color + Highlight). Same swatch palette for both; Custom
            is a <label> wrapping a hidden <input type="color"> positioned
            over the label so the native picker anchors to the label. */}
        <div className="relative">
          <button
            type="button"
            title={t('editor:color.buttonTitle')}
            onClick={() => setColorOpen((v) => !v)}
            className="relative inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 active:scale-[0.96] transition-transform"
          >
            <Type size={15} strokeWidth={1.6} />
            <span
              className="absolute left-1/2 -translate-x-1/2 bottom-1 h-[3px] w-[15px] rounded-sm"
              style={{ backgroundColor: currentColor }}
            />
          </button>
          {colorOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setColorOpen(false)} aria-hidden />
              <div
                className="absolute top-full left-0 mt-1 z-50 p-2 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)] w-max"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-1 px-0.5">
                  <div className="text-[10px] text-t3">{t('editor:color.textColor')}</div>
                  <label className="relative cursor-pointer py-0.5 px-1.5 rounded text-[10px] text-acc hover:bg-hov hover:opacity-80">
                    {t('editor:color.custom')}
                    <input
                      type="color"
                      onChange={(e) => {
                        editor.chain().focus().setColor(e.target.value).run();
                        setColorOpen(false);
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      tabIndex={-1}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {colorSwatches.map((c) => (
                    <button
                      key={`tc-${c}`}
                      type="button"
                      title={c}
                      onClick={() => {
                        editor.chain().focus().setColor(c).run();
                        setColorOpen(false);
                      }}
                      className={`w-6 h-6 rounded-md border border-brd hover:scale-110 transition-transform ${currentColor.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-acc' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="my-2 border-t border-brd" />
                <div className="flex items-center justify-between mb-1 px-0.5">
                  <div className="text-[10px] text-t3">{t('editor:color.highlight')}</div>
                  <label className="relative cursor-pointer py-0.5 px-1.5 rounded text-[10px] text-acc hover:bg-hov hover:opacity-80">
                    {t('editor:color.custom')}
                    <input
                      type="color"
                      onChange={(e) => {
                        editor.chain().focus().toggleHighlight({ color: e.target.value }).run();
                        setColorOpen(false);
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      tabIndex={-1}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {colorSwatches.map((c) => (
                    <button
                      key={`hl-${c}`}
                      type="button"
                      title={c}
                      onClick={() => {
                        editor.chain().focus().toggleHighlight({ color: c }).run();
                        setColorOpen(false);
                      }}
                      className={`w-6 h-6 rounded-md border border-brd hover:scale-110 transition-transform ${currentHighlight.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-acc' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="w-px h-4 bg-brd2 mx-1" aria-hidden />
        {buttonsEarly.map((b, i) => (
          <button
            key={i}
            type="button"
            title={b.title}
            disabled={b.disabled}
            onClick={b.onClick}
            className={`inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-default ${
              b.active ? 'bg-accdim text-acc' : ''
            }`}
          >
            <b.icon size={15} strokeWidth={1.6} />
          </button>
        ))}
        <div className="w-px h-4 bg-brd2 mx-1" aria-hidden />
        {/* ponytail: align buttons — four icon buttons (left/center/right/justify).
            selectionTextAlign resolves the shared alignment (unset = left,
            mixed = none), so exactly one button highlights. */}
        {alignButtons.map((b, i) => (
          <button
            key={`al-${i}`}
            type="button"
            title={b.title}
            disabled={b.disabled}
            onClick={b.onClick}
            className={`inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-default ${
              b.active ? 'bg-accdim text-acc' : ''
            }`}
          >
            <b.icon size={15} strokeWidth={1.6} />
          </button>
        ))}
        <div className="w-px h-4 bg-brd2 mx-1" aria-hidden />
        {buttonsRest.map((b, i) => (
          <button
            key={`rest-${i}`}
            type="button"
            title={b.title}
            disabled={b.disabled}
            onClick={b.onClick}
            className={`inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-default ${
              b.active ? 'bg-accdim text-acc' : ''
            }`}
          >
            <b.icon size={15} strokeWidth={1.6} />
          </button>
        ))}
        <div className="w-px h-4 bg-brd2 mx-1" aria-hidden />
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
