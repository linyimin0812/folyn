import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { moveTableRow, moveTableColumn, CellSelection, selectedRect } from '@tiptap/pm/tables';
import {
  TableCellsMerge,
  TableCellsSplit,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  Paintbrush,
  Eraser,
} from 'lucide-react';
import type { EditorProps } from '../types';
import {
  deserializeToContent,
  emptyDoc,
  serializeToDisk,
  shouldApplyExternalContent,
} from './richTextContent';
import { RichTextImage } from './RichTextImage';
import { RichTextToolbar } from './RichTextToolbar';
import {
  RichTextSlashExtension,
  computeSlashState,
  INITIAL_SLASH_STATE,
  writeSlashState,
  type SlashCommandState,
} from './RichTextSlashExtension';
import { RichTextSlashMenu } from './RichTextSlashMenu';
import { TableControlsOverlay, domCellToPos } from './TableControlsOverlay';
import { TableMenu, type TableMenuItem } from './TableMenu';
import { RichTextTableCell, RichTextTableHeader } from './RichTextTableCell';

// ponytail: anti-write-back-loop guard — drawio loadedXml + loadedXmlRef
// pattern, adapted for tiptap (no iframe). User edits update the ref ONLY
// (no setLoadedContent) and debounce onChange; external content changes
// (AI apply via setContentExternal → remount; AI reject via revertEditorTab
// → updateTabContent WITHOUT a version bump → in-place setContent) call
// editor.commands.setContent(parsed, { emitUpdate: false }) so onUpdate
// does not fire and the loop is broken. The pending debounce timer is
// cleared before setContent so a stale user save can't clobber the just-
// applied external content (race guard).
//
// Why not mount-only + remount like the drawio editor in this repo: a
// remount destroys tiptap cursor + undo history on every external change.
// The in-place setContent preserves the editor instance; revertEditorTab
// (reject path) deliberately routes through updateTabContent (no version
// bump) so this effect fires. The accept path bumps externalContentVersion
// and remounts — also fine, the effect is a no-op on a fresh mount (ref
// initialized from content).

export function RichTextEditor({ content, onChange }: EditorProps) {
  const { t } = useTranslation();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last content we handed to the editor (mount init or a
  // setContent call) OR the last JSON the user's edit emitted. Either way,
  // it's what the content prop should equal when the change originated from
  // us — so the content-prop effect sees them equal and skips the reload.
  const loadedContentRef = useRef(content);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      // ponytail: tableCell/tableHeader disabled in TableKit and replaced
      // with RichTextTableCell/Header — the base Tiptap nodes lack a
      // `background` attr, so setCellAttribute('background', …) would be
      // rejected by the schema. Custom extensions add it via
      // addAttributes(). `resizable: true` enables prosemirror-tables'
      // columnResizing plugin (drag handles between columns; colwidth
      // persists as a cell attr, survives round-trip).
      TableKit.configure({
        table: { allowTableNodeSelection: true, resizable: true },
        tableCell: false,
        tableHeader: false,
      }),
      RichTextTableCell,
      RichTextTableHeader,
      RichTextImage,
      RichTextSlashExtension,
    ],
    content: deserializeToContent(content) ?? emptyDoc(),
    onUpdate: ({ editor }) => {
      // User edit: update ref ONLY (not setState), so when our own onChange
      // flows back via updateTabContent → content prop, the effect below
      // sees content === loadedContentRef.current → no reload. Mirror
      // drawio handleAutoSave.
      const json = serializeToDisk(editor.getJSON());
      loadedContentRef.current = json;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        onChangeRef.current(json);
      }, 500);
    },
  });

  // External content change (AI / file watcher / reject-revert): apply in
  // place without remounting. emitUpdate:false breaks the loop.
  useEffect(() => {
    if (!editor) return;
    if (!shouldApplyExternalContent(content, loadedContentRef)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current); // race guard
    const parsed = deserializeToContent(content) ?? emptyDoc();
    editor.commands.setContent(parsed, { emitUpdate: false });
    loadedContentRef.current = content;
  }, [content, editor]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  // ponytail: Re-render the toolbar on editor selection / state changes so
  // active-state (bold/italic/etc.) highlights update. editor.can() and
  // editor.isActive() are reactive across transactions; bumping a tick on
  // selectionUpdate is the minimal signal. Skipping would leave the toolbar
  // stale until next keystroke. The same tick recomputes the slash-menu state
  // (storage is written here, not in a ProseMirror plugin — no extra dep).
  //
  // dismissedFromRef: after Esc closes the menu, the `/` + filter text is
  // left in the doc; without this guard, the next transaction (e.g. cursor
  // move) would re-evaluate computeSlashState, find the same trigger, and
  // immediately reopen — defeating Esc. We suppress reopening until the
  // trigger position changes.
  const [, setToolbarTick] = useState(0);
  const [slashState, setSlashState] = useState<SlashCommandState>(INITIAL_SLASH_STATE);
  const dismissedFromRef = useRef<number | null>(null);
  // ponytail: right-click cell context menu. Trigger is onContextMenu on
  // the editor wrapper — if cursor is in a table, suppress browser menu
  // and show ours; otherwise let the browser handle it (no global
  // hijacking). Menu items reuse TableKit's merge/split/align/header/delete
  // commands — no new ops, no cell-pos lookup needed (these act on the
  // current cell selection).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // ponytail: bg-color picker popover. Opened from the cell context menu's
  // "Background color" item; renders a native <input type="color"> (ponytail:
  // native platform picker over a lib — same reasoning as the URL modal).
  // On change, setCellAttribute('background', value) on the current cell
  // selection (preserved across the picker because no transaction moves the
  // cursor). "Clear" sets background to null.
  const [bgPicker, setBgPicker] = useState<{ x: number; y: number } | null>(null);
  // ponytail: capture the last right-click position so the bgColor item can
  // open the picker where the menu was. TableMenu closes itself (setCtxMenu
  // null) before firing the item onClick, so ctxMenu is stale inside the
  // onClick — this ref holds the position across that close.
  const ctxMenuPosRef = useRef<{ x: number; y: number } | null>(null);
  // ponytail: capture the last CellSelection positions so right-click can
  // restore it. PM's mousedown handler (delegated deeper in the DOM than
  // our React listener) processes the event first and the browser's
  // default action collapses the multi-cell CellSelection to the clicked
  // cell by the time contextmenu fires — leaving editor.can().mergeCells()
  // false when the menu renders. We capture {anchor, head} on mousedown
  // (CellSelection still alive) and re-apply via setCellSelection in the
  // contextmenu handler when the click landed inside the captured rect.
  const pendingCellSelRef = useRef<{ anchor: number; head: number; cellPos: number } | null>(null);
  // ponytail: capture merge/split capability AT contextmenu time (before
  // the async selectionchange collapses the CellSelection). cellCtxItems
  // reads from this state instead of editor.can() — by the time the menu
  // renders, selectionchange has fired and editor.can() returns false.
  const [cellMenuCaps, setCellMenuCaps] = useState<{ merge: boolean; split: boolean }>({ merge: false, split: false });
  // ponytail: snapshot pendingCellSelRef at cellCtxItems build time so
  // the item onClick closes over the captured positions. TableMenu's
  // button onClick fires onClose BEFORE it.onClick() — and onClose
  // clears pendingCellSelRef (so a stale snapshot doesn't leak into the
  // next menu). Without this snapshot, onClick would read null and fall
  // into the no-restore else branch, making merge/split a no-op.
  const pendingSnapshot = pendingCellSelRef.current;

  const cellCtxItems: TableMenuItem[] = [
    {
      label: t('editor:table.cellMenu.merge'),
      icon: TableCellsMerge,
      disabled: !cellMenuCaps.merge,
      onClick: () => {
        if (pendingSnapshot) {
          // ponytail: two chains, not one. Tiptap's chainable state
          // caches `selection` at chain-creation time (createChainableState
          // local var, only re-synced via state.tr getter). setCellSelection
          // mutates tr.selection but the next command in the same chain
          // reads stale state.selection → mergeCells sees single cell and
          // no-ops. Splitting forces the second chain to read live state.
          editor?.chain().setCellSelection({ anchorCell: pendingSnapshot.anchor, headCell: pendingSnapshot.head }).run();
          editor?.chain().mergeCells().run();
        } else {
          editor?.chain().focus().mergeCells().run();
        }
      },
    },
    {
      label: t('editor:table.cellMenu.split'),
      icon: TableCellsSplit,
      disabled: !cellMenuCaps.split,
      onClick: () => {
        if (pendingSnapshot) {
          editor?.chain().setCellSelection({ anchorCell: pendingSnapshot.anchor, headCell: pendingSnapshot.head }).run();
          editor?.chain().splitCell().run();
        } else {
          editor?.chain().focus().splitCell().run();
        }
      },
    },
    { label: '---', onClick: () => {} },
    {
      label: t('editor:table.cellMenu.alignLeft'),
      icon: AlignLeft,
      onClick: () => editor?.chain().focus().setCellAttribute('align', 'left').run(),
    },
    {
      label: t('editor:table.cellMenu.alignCenter'),
      icon: AlignCenter,
      onClick: () => editor?.chain().focus().setCellAttribute('align', 'center').run(),
    },
    {
      label: t('editor:table.cellMenu.alignRight'),
      icon: AlignRight,
      onClick: () => editor?.chain().focus().setCellAttribute('align', 'right').run(),
    },
    { label: '---', onClick: () => {} },
    {
      label: t('editor:table.cellMenu.toggleHeaderCell'),
      onClick: () => editor?.chain().focus().toggleHeaderCell().run(),
    },
    { label: '---', onClick: () => {} },
    {
      label: t('editor:table.cellMenu.bgColor'),
      icon: Paintbrush,
      // ponytail: bg-color submenu — 10 concrete hex swatches (neutrals
      // + hues) then a separator then "Custom color…" which opens the
      // existing native <input type="color"> picker. Hex literals, not
      // CSS vars, because setCellAttribute persists the string verbatim;
      // a var(--acc) would survive a theme switch and look wrong.
      submenu: [
        ...[
          '#ffffff', '#f4f4f5', '#a1a1aa', '#52525b', '#000000',
          '#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7',
        ].map((hex) => ({
          label: hex,
          swatch: hex,
          onClick: () => {
            const snap = pendingSnapshot;
            if (snap) {
              editor?.chain().setCellSelection({ anchorCell: snap.anchor, headCell: snap.head }).run();
              editor?.chain().setCellAttribute('background', hex).run();
            } else {
              editor?.chain().focus().setCellAttribute('background', hex).run();
            }
          },
        })),
        { label: '---', onClick: () => {} },
        {
          label: t('editor:table.cellMenu.customColor'),
          icon: Paintbrush,
          onClick: () => setBgPicker(ctxMenuPosRef.current ?? { x: 0, y: 0 }),
        },
      ],
    },
    {
      label: t('editor:table.cellMenu.clearBg'),
      icon: Eraser,
      onClick: () => editor?.chain().focus().setCellAttribute('background', null).run(),
    },
    { label: '---', onClick: () => {} },
    {
      label: t('editor:table.cellMenu.deleteTable'),
      icon: Trash2,
      danger: true,
      onClick: () => editor?.chain().focus().deleteTable().run(),
    },
  ];
  // ponytail: content wrapper ref for the table +row/+col overlay. This div
  // is the positioned ancestor (relative) of the overlay, but NOT a scroll
  // container — so the overlay's abspos buttons scroll with the content and
  // stay glued to the table (coords are wrapper-relative, scroll-invariant).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editor) return;
    const rerender = () => {
      setToolbarTick((t) => t + 1);
      const next = computeSlashState(editor);
      const suppressed =
        next.visible && dismissedFromRef.current === next.rangeFrom;
      const effective = suppressed ? INITIAL_SLASH_STATE : next;
      writeSlashState(editor, effective);
      if (!suppressed) dismissedFromRef.current = null;
      setSlashState((cur) =>
        cur.visible === effective.visible &&
        cur.rangeFrom === effective.rangeFrom &&
        cur.rangeTo === effective.rangeTo &&
        cur.filter === effective.filter
          ? cur
          : effective,
      );
    };
    editor.on('selectionUpdate', rerender);
    editor.on('transaction', rerender);
    return () => {
      editor.off('selectionUpdate', rerender);
      editor.off('transaction', rerender);
    };
  }, [editor]);

  // ponytail: register a CAPTURE-phase mousedown listener on view.dom so
  // it fires BEFORE PM's bubble-phase listener. preventDefault on right-
  // click inside the current CellSelection stops the browser's default
  // DOM-caret change, which is what triggers the async selectionchange
  // that collapses the CellSelection before contextmenu renders. React's
  // synthetic onMouseDown can't do this — React delegates at the root
  // container, so PM's listener on contentDOM fires first. The capture
  // phase runs deepest-first, so this runs before PM's bubble handler.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (e: MouseEvent) => {
      if (e.button !== 2) return;
      const { state } = editor;
      if (!(state.selection instanceof CellSelection)) return;
      const target = e.target as HTMLElement | null;
      const cellEl = target?.closest?.('td, th') as HTMLTableCellElement | null;
      if (!cellEl) return;
      const cellPos = domCellToPos(editor, cellEl);
      if (cellPos == null) return;
      try {
        const rect = selectedRect(state);
        const cr = rect.map.findCell(cellPos - rect.tableStart);
        const inSel =
          cr.left >= rect.left && cr.right <= rect.right &&
          cr.top >= rect.top && cr.bottom <= rect.bottom;
        if (inSel) {
          e.preventDefault();
          pendingCellSelRef.current = {
            anchor: state.selection.$anchorCell.pos,
            head: state.selection.$headCell.pos,
            cellPos,
          };
        }
      } catch {
        // cellPos not in map — let default run
      }
    };
    dom.addEventListener('mousedown', handler, true);
    return () => dom.removeEventListener('mousedown', handler, true);
  }, [editor]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-panel">
      {editor && <RichTextToolbar editor={editor} />}
      <div className="flex-1 overflow-auto">
        <div
          ref={scrollRef}
          className="relative mx-auto max-w-[760px] px-8 py-6 min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[60vh] [&_.ProseMirror_p]:my-2 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:my-3 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:my-3 [&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ul[data-type=taskList]]:list-none [&_.ProseMirror_ul[data-type=taskList]]:pl-0 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-brd [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:text-t3 [&_.ProseMirror_pre]:bg-surf2 [&_.ProseMirror_pre]:rounded [&_.ProseMirror_pre]:p-3 [&_.ProseMirror_code]:bg-surf2 [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:rounded [&_.ProseMirror_hr]:border-brd [&_.ProseMirror_a]:text-acc [&_.ProseMirror_a]:underline [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:w-full [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-brd [&_.ProseMirror_th]:px-2 [&_.ProseMirror_th]:py-1 [&_.ProseMirror_th]:bg-surf2 [&_.ProseMirror_th]:text-left [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-brd [&_.ProseMirror_td]:px-2 [&_.ProseMirror_td]:py-1 [&_.ProseMirror_td]:relative [&_.ProseMirror_th]:relative [&_.ProseMirror_.selectedCell]:bg-accdim [&_.ProseMirror_.column-resize]:cursor-col-resize [&_.ProseMirror_.column-resize-handle]:absolute [&_.ProseMirror_.column-resize-handle]:right-[-2px] [&_.ProseMirror_.column-resize-handle]:top-0 [&_.ProseMirror_.column-resize-handle]:bottom-0 [&_.ProseMirror_.column-resize-handle]:w-1 [&_.ProseMirror_.column-resize-handle]:z-10 [&_.ProseMirror_.column-resize-handle]:cursor-col-resize [&_.ProseMirror_.column-resize-handle:hover]:bg-acc [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:h-auto [&_.ProseMirror_selectednode]:ring-2 [&_.ProseMirror_selectednode]:ring-acc"
          onContextMenu={(e) => {
            if (!editor) return;
            if (!editor.isActive('table')) return;
            e.preventDefault();
            setCellMenuCaps({
              merge: editor.can().mergeCells(),
              split: editor.can().splitCell(),
            });
            ctxMenuPosRef.current = { x: e.clientX, y: e.clientY };
            setCtxMenu({ x: e.clientX, y: e.clientY });
            // ponytail: selectionchange is async — at contextmenu time
            // editor.state.selection is still the CellSelection, but the
            // browser collapses it on the next task tick and PM syncs
            // state, dropping the selectedCell decoration. Re-apply the
            // captured snapshot after the browser has its say so the
            // highlight survives while the menu is open.
            const snap = pendingCellSelRef.current;
            if (snap) {
              setTimeout(() => {
                editor.chain().setCellSelection({ anchorCell: snap.anchor, headCell: snap.head }).run();
              }, 0);
            }
          }}
          onDragOver={(e) => {
            // ponytail: allow row/col drag drops from the hover handles. We
            // only preventDefault when our custom MIME is on the clipboard —
            // otherwise the editor's default (text/file drop) keeps working.
            const types = e.dataTransfer.types;
            if (
              types.includes('application/x-quill-table-row') ||
              types.includes('application/x-quill-table-col')
            ) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            const dt = e.dataTransfer;
            const rowIdx = dt.getData('application/x-quill-table-row');
            const colIdx = dt.getData('application/x-quill-table-col');
            if (!editor || (rowIdx === '' && colIdx === '')) return;
            e.preventDefault();
            const target = e.target as HTMLElement | null;
            if (!target) return;
            try {
              if (rowIdx !== '') {
                const trEl = target.closest('tr') as HTMLTableRowElement | null;
                if (!trEl) return;
                const cellEl = trEl.cells[0];
                if (!cellEl) return;
                const pos = domCellToPos(editor, cellEl);
                if (pos == null) return;
                const cmd = moveTableRow({ from: Number(rowIdx), to: trEl.rowIndex, pos });
                cmd(editor.state, editor.view.dispatch.bind(editor.view));
              } else {
                const cellEl = target.closest('td, th') as HTMLTableCellElement | null;
                if (!cellEl) return;
                const pos = domCellToPos(editor, cellEl);
                if (pos == null) return;
                const cmd = moveTableColumn({ from: Number(colIdx), to: cellEl.cellIndex, pos });
                cmd(editor.state, editor.view.dispatch.bind(editor.view));
              }
            } catch {
              // swallow — bad drop shouldn't crash the editor
            }
          }}
        >
          <EditorContent editor={editor} />
          {editor && <TableControlsOverlay editor={editor} containerRef={scrollRef} />}
        </div>
      </div>
      {editor && (
        <RichTextSlashMenu
          editor={editor}
          state={slashState}
          onClose={() => {
            if (slashState.visible) dismissedFromRef.current = slashState.rangeFrom;
            setSlashState(INITIAL_SLASH_STATE);
          }}
        />
      )}
      {ctxMenu && (
        <TableMenu
          items={cellCtxItems}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => {
            setCtxMenu(null);
            pendingCellSelRef.current = null;
            setCellMenuCaps({ merge: false, split: false });
          }}
        />
      )}
      {bgPicker && (
        <div
          className="fixed z-[1000] p-2 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)] flex items-center gap-2"
          style={{ top: bgPicker.y, left: bgPicker.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="color"
            // ponytail: native color input over a lib — no wheel/palette/
            // history. onChange fires continuously while dragging the picker
            // swatch (live preview on the cell selection).
            onChange={(e) =>
              editor?.chain().focus().setCellAttribute('background', e.target.value).run()
            }
            className="w-8 h-8 cursor-pointer bg-transparent border-none p-0"
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              editor?.chain().focus().setCellAttribute('background', null).run();
              setBgPicker(null);
            }}
            className="px-2 py-1 text-xs text-t2 hover:text-t1"
          >
            {t('editor:table.cellMenu.clearBg')}
          </button>
        </div>
      )}
    </div>
  );
}
