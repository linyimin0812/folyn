import { useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { findTable, TableMap } from '@tiptap/pm/tables';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftFromLine,
  ArrowRightToLine,
  Trash2,
  Rows3,
  Columns3,
  Plus,
} from 'lucide-react';
import { TableMenu, type TableMenuItem } from './TableMenu';

// ponytail: row-left / col-top hover handles + the existing +row/+col
// quick-append buttons, all in one overlay (single positioning system,
// single transaction listener). Right-click context menu lives in
// RichTextEditor (different trigger, different items) but shares TableMenu.
//
// Positioning: wrapper-relative coords (table.rect − wrapper.rect), scroll-
// invariant — both rects shift by the same delta on scroll, no re-measure
// needed. Hover handles are recomputed on each render from the live DOM
// rect of the hovered tr/cell; mouseover fires on cell entry (not every
// pixel), so no thrash. Toggle-header items only show when hovering the
// first row/col — TableKit's toggleHeaderRow/Column always affects the
// table's first row/col, so showing it elsewhere is misleading.
//
// Cell-pos lookup: view.posAtDOM(cell, 0) → resolve → walk up to the
// tableCell/tableHeader node → before(d). One helper, used by both row
// and col handles. setCellSelection({anchorCell}) then runs the command
// on the current cell's row/column — we don't need explicit row/col
// indices because addRowBefore/After, deleteRow, addColumnBefore/After,
// deleteColumn all operate on the selected cell's row/col.

interface TableControlsOverlayProps {
  editor: Editor;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface BtnPos {
  left: number;
  top: number;
}

interface HoverState {
  rowTr: HTMLTableRowElement | null;
  colCell: HTMLTableCellElement | null;
}

interface MenuState {
  items: TableMenuItem[];
  x: number;
  y: number;
}

function findCurrentTableDom(editor: Editor): HTMLTableElement | null {
  const { state, view } = editor;
  if (!view) return null;
  const { $from } = state.selection;
  try {
    const { node } = view.domAtPos($from.pos);
    const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
    return el?.closest('table') ?? null;
  } catch {
    return null;
  }
}

function selectCellAndRun(
  editor: Editor,
  row: number,
  col: number,
  command: 'addRowAfter' | 'addColumnAfter',
): boolean {
  const { $from } = editor.state.selection;
  const found = findTable($from);
  if (!found) return false;
  const map = TableMap.get(found.node);
  const cellPos = found.start + map.positionAt(row, col, found.node);
  return editor.chain().focus().setCellSelection({ anchorCell: cellPos })[command]().run();
}

function domCellToPos(editor: Editor, cellEl: HTMLElement): number | null {
  const { view, state } = editor;
  if (!view) return null;
  try {
    const inner = view.posAtDOM(cellEl, 0);
    const $pos = state.doc.resolve(inner);
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d);
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        return $pos.before(d);
      }
    }
  } catch {
    // fall through
  }
  return null;
}

function runOnCell(
  editor: Editor,
  cellEl: HTMLElement,
  command: 'addRowBefore' | 'addRowAfter' | 'deleteRow' | 'addColumnBefore' | 'addColumnAfter' | 'deleteColumn',
): void {
  const cellPos = domCellToPos(editor, cellEl);
  if (cellPos == null) return;
  editor.chain().focus().setCellSelection({ anchorCell: cellPos })[command]().run();
}

export function TableControlsOverlay({ editor, containerRef }: TableControlsOverlayProps) {
  const [rowBtn, setRowBtn] = useState<BtnPos | null>(null);
  const [colBtn, setColBtn] = useState<BtnPos | null>(null);
  const [hover, setHover] = useState<HoverState>({ rowTr: null, colCell: null });
  const [menu, setMenu] = useState<MenuState | null>(null);
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    if (!editor) return;
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const table = findCurrentTableDom(editor);
        const c = containerRef.current;
        if (!table || !c || !editor.isEditable) {
          setRowBtn(null);
          setColBtn(null);
          return;
        }
        const tr = table.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const left = tr.left - cr.left;
        const top = tr.top - cr.top;
        setRowBtn({ left, top: top + tr.height });
        setColBtn({ left: left + tr.width, top });
      });
    };

    measure();
    editor.on('transaction', measure);
    window.addEventListener('resize', measure);
    return () => {
      editor.off('transaction', measure);
      window.removeEventListener('resize', measure);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [editor, containerRef]);

  // ponytail: hover handle tracking. mouseover fires on cell entry, not
  // every pixel-move — no throttle needed. mouseleave on the wrapper
  // (the positioned ancestor) clears both handles. We store the DOM
  // element directly; positions are recomputed in render from live rects.
  useLayoutEffect(() => {
    if (!editor) return;
    const wrapper = containerRef.current;
    if (!wrapper) return;
    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const table = findCurrentTableDom(editor);
      if (!table || !table.contains(target)) {
        setHover({ rowTr: null, colCell: null });
        return;
      }
      const tr = target.closest('tr') as HTMLTableRowElement | null;
      const cell = target.closest('td, th') as HTMLTableCellElement | null;
      setHover((cur) => ({
        rowTr: tr && table.contains(tr) ? tr : cur.rowTr,
        colCell: cell && table.contains(cell) ? cell : cur.colCell,
      }));
    };
    const onLeave = () => setHover({ rowTr: null, colCell: null });
    wrapper.addEventListener('mouseover', onOver);
    wrapper.addEventListener('mouseleave', onLeave);
    return () => {
      wrapper.removeEventListener('mouseover', onOver);
      wrapper.removeEventListener('mouseleave', onLeave);
    };
  }, [editor, containerRef]);

  if (!rowBtn || !colBtn) return null;

  const container = containerRef.current;
  const cr = container?.getBoundingClientRect();
  // ponytail: handle positions — wrapper-relative, computed from live rects
  // on each render. Cheap: two getBoundingClientRect per render when hover
  // is non-null. On scroll, both rects shift together → handle stays glued.
  const rowHandle =
    hover.rowTr && cr
      ? (() => {
          const r = hover.rowTr.getBoundingClientRect();
          return {
            left: r.left - cr.left - 22,
            top: r.top - cr.top + r.height / 2 - 10,
          };
        })()
      : null;
  const colHandle =
    hover.colCell && cr
      ? (() => {
          const r = hover.colCell.getBoundingClientRect();
          return {
            left: r.left - cr.left + r.width / 2 - 10,
            top: r.top - cr.top - 22,
          };
        })()
      : null;

  const quickBtnClass =
    'pointer-events-auto absolute w-5 h-5 rounded-full border border-brd bg-panel shadow flex items-center justify-center text-t2 hover:bg-hov hover:text-t1';
  const handleBtnClass =
    'pointer-events-auto absolute w-5 h-5 rounded border border-brd2 bg-panel shadow flex items-center justify-center text-t2 hover:bg-hov hover:text-t1';

  const openRowMenu = (e: React.MouseEvent, tr: HTMLTableRowElement) => {
    e.preventDefault();
    e.stopPropagation();
    const isFirst = tr.rowIndex === 0;
    // ponytail: row ops need a cell pos (TableKit's row commands operate
    // on the selected cell's row). Use the row's first cell — for spans
    // the first cell in DOM order is what setCellSelection accepts.
    const firstCell = tr.cells[0] as HTMLTableCellElement | undefined;
    const runRow = (cmd: 'addRowBefore' | 'addRowAfter' | 'deleteRow') => {
      if (firstCell) runOnCell(editor, firstCell, cmd);
    };
    const items: TableMenuItem[] = [
      { label: 'Insert row above', icon: ArrowUpFromLine, onClick: () => runRow('addRowBefore') },
      { label: 'Insert row below', icon: ArrowDownToLine, onClick: () => runRow('addRowAfter') },
      { label: 'Delete row', icon: Trash2, danger: true, onClick: () => runRow('deleteRow') },
    ];
    if (isFirst) {
      items.push({ label: '---', onClick: () => {} });
      items.push({ label: 'Toggle header row', icon: Rows3, onClick: () => editor.chain().focus().toggleHeaderRow().run() });
    }
    setMenu({ items, x: e.clientX, y: e.clientY });
  };

  const openColMenu = (e: React.MouseEvent, cell: HTMLTableCellElement) => {
    e.preventDefault();
    e.stopPropagation();
    const isFirst = cell.cellIndex === 0;
    const items: TableMenuItem[] = [
      { label: 'Insert column left', icon: ArrowLeftFromLine, onClick: () => runOnCell(editor, cell, 'addColumnBefore') },
      { label: 'Insert column right', icon: ArrowRightToLine, onClick: () => runOnCell(editor, cell, 'addColumnAfter') },
      { label: 'Delete column', icon: Trash2, danger: true, onClick: () => runOnCell(editor, cell, 'deleteColumn') },
    ];
    if (isFirst) {
      items.push({ label: '---', onClick: () => {} });
      items.push({ label: 'Toggle header column', icon: Columns3, onClick: () => editor.chain().focus().toggleHeaderColumn().run() });
    }
    setMenu({ items, x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {/* +row quick append (bottom-left) */}
        <button
          type="button"
          title="Add row"
          className={quickBtnClass}
          style={{ left: rowBtn.left, top: rowBtn.top - 10 }}
          onClick={() => {
            const found = findTable(editor.state.selection.$from);
            if (!found) return;
            const lastRow = TableMap.get(found.node).height - 1;
            selectCellAndRun(editor, lastRow, 0, 'addRowAfter');
          }}
        >
          <Plus size={12} strokeWidth={2} />
        </button>
        {/* +col quick append (top-right) */}
        <button
          type="button"
          title="Add column"
          className={quickBtnClass}
          style={{ left: colBtn.left - 10, top: colBtn.top }}
          onClick={() => {
            const found = findTable(editor.state.selection.$from);
            if (!found) return;
            const lastCol = TableMap.get(found.node).width - 1;
            selectCellAndRun(editor, 0, lastCol, 'addColumnAfter');
          }}
        >
          <Plus size={12} strokeWidth={2} />
        </button>
        {/* row-left hover handle */}
        {rowHandle && (
          <button
            type="button"
            title="Row actions"
            className={handleBtnClass}
            style={{ left: rowHandle.left, top: rowHandle.top }}
            onClick={(e) => hover.rowTr && openRowMenu(e, hover.rowTr)}
          >
            <Rows3 size={11} strokeWidth={2} />
          </button>
        )}
        {/* col-top hover handle */}
        {colHandle && (
          <button
            type="button"
            title="Column actions"
            className={handleBtnClass}
            style={{ left: colHandle.left, top: colHandle.top }}
            onClick={(e) => hover.colCell && openColMenu(e, hover.colCell)}
          >
            <Columns3 size={11} strokeWidth={2} />
          </button>
        )}
      </div>
      {menu && (
        <TableMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
