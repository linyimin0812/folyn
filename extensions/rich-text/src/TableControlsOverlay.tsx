import { useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftFromLine,
  ArrowRightToLine,
  Trash2,
  Rows3,
  Columns3,
} from 'lucide-react';
import { TableMenu, type TableMenuItem } from './TableMenu';

// ponytail: row-left / col-top hover handles only. The previous +row/+col
// quick-append buttons were removed (row/col hover menus + right-click
// cover insert). Right-click context menu lives in RichTextEditor.
//
// Hover-stickiness: the handle is positioned outside the table (22px gap),
// so the mouse must cross that gap to click it. The naive `mouseover`
// handler cleared hover when target left the table — which happened as
// soon as the mouse entered the gap, making the handle vanish mid-motion.
// Fix: on mouseover, (a) if target is the handle itself (data-table-handle),
// no-op; (b) if target is outside the current table, no-op (don't clear);
// (c) only update hover when target is inside the current table. Clearing
// is delegated to wrapper `mouseleave` + editor `transaction` (which
// recomputes rowBtn/colBtn to null when the cursor leaves the table →
// overlay returns null).
//
// Toggle-header items only show when hovering the first row/col —
// TableKit's toggleHeaderRow/Column always affects the table's first
// row/col, so showing it elsewhere is misleading.

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

export function domCellToPos(editor: Editor, cellEl: HTMLElement): number | null {
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
  const { t } = useTranslation();
  const [rowBtn, setRowBtn] = useState<BtnPos | null>(null);
  const [colBtn, setColBtn] = useState<BtnPos | null>(null);
  const [hover, setHover] = useState<HoverState>({ rowTr: null, colCell: null });
  const [edgeHover, setEdgeHover] = useState<{ right: boolean; bottom: boolean }>({ right: false, bottom: false });
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
      // Hovering a handle itself: don't update or clear (let click land).
      if (target.closest('[data-table-handle]')) return;
      const table = findCurrentTableDom(editor);
      // Outside the current table: no-op. Previously this cleared hover,
      // which killed the handle mid-motion as the mouse crossed the 22px
      // gap between cell and handle. Clearing is delegated to wrapper
      // mouseleave + transaction (measure() nulls rowBtn/colBtn when
      // cursor leaves the table → overlay returns null).
      if (!table || !table.contains(target)) return;
      const tr = target.closest('tr') as HTMLTableRowElement | null;
      const cell = target.closest('td, th') as HTMLTableCellElement | null;
      setHover((cur) => ({
        rowTr: tr && table.contains(tr) ? tr : cur.rowTr,
        colCell: cell && table.contains(cell) ? cell : cur.colCell,
      }));
    };
    const onLeave = () => {
      setHover({ rowTr: null, colCell: null });
      setEdgeHover({ right: false, bottom: false });
    };
    // ponytail: + buttons show only when the mouse is on the table's
    // right/bottom border line (6px tolerance either side). mousemove
    // fires too often to setState directly; rAF-coalesce. The zone
    // covers the full edge length (clamped by table top/bottom or
    // left/right) so the user can slide along the edge and the button
    // stays visible.
    let moveRaf = 0;
    const onMove = (e: MouseEvent) => {
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        const table = findCurrentTableDom(editor);
        if (!table) {
          setEdgeHover({ right: false, bottom: false });
          return;
        }
        const r = table.getBoundingClientRect();
        const tol = 6;
        const inX = e.clientY >= r.top && e.clientY <= r.bottom;
        const inY = e.clientX >= r.left && e.clientX <= r.right;
        const nearRight = inX && e.clientX >= r.right - tol && e.clientX <= r.right + tol;
        const nearBottom = inY && e.clientY >= r.bottom - tol && e.clientY <= r.bottom + tol;
        setEdgeHover((cur) => {
          const next = { right: nearRight, bottom: nearBottom };
          return next.right === cur.right && next.bottom === cur.bottom ? cur : next;
        });
      });
    };
    wrapper.addEventListener('mouseover', onOver);
    wrapper.addEventListener('mousemove', onMove);
    wrapper.addEventListener('mouseleave', onLeave);
    return () => {
      wrapper.removeEventListener('mouseover', onOver);
      wrapper.removeEventListener('mousemove', onMove);
      wrapper.removeEventListener('mouseleave', onLeave);
      if (moveRaf) cancelAnimationFrame(moveRaf);
    };
  }, [editor, containerRef]);

  if (!rowBtn || !colBtn) return null;

  const container = containerRef.current;
  const cr = container?.getBoundingClientRect();
  // ponytail: handle positions — wrapper-relative, computed from live rects
  // on each render. Cheap: two getBoundingClientRect per render when hover
  // is non-null. On scroll, both rects shift together → handle stays glued.
  // ponytail: row handle fills the full row height (one tall bar to
  // the left of the row); col handle fills the full column width (one
  // wide bar above the first-row cell). Width/height come from the
  // live rects so they stay glued on scroll and resize.
  const rowHandle =
    hover.rowTr && cr
      ? (() => {
          const r = hover.rowTr.getBoundingClientRect();
          return {
            left: r.left - cr.left - 11,
            top: r.top - cr.top,
            height: r.height,
          };
        })()
      : null;
  // ponytail: col handle always anchors to the first row, regardless of
  // which row the cursor is in. The handle is a column-level affordance,
  // so it reads as "this column" no matter where in the column you hover.
  // We look up the first-row cell at the hovered cell's cellIndex — same
  // DOM-order caveat as dragStart (breaks for colspan), MVP: simple tables.
  const colHandle =
    hover.colCell && cr
      ? (() => {
          const table = hover.colCell.closest('table');
          const firstRowCell = table?.rows[0]?.cells[hover.colCell.cellIndex];
          if (!firstRowCell) return null;
          const r = firstRowCell.getBoundingClientRect();
          return {
            left: r.left - cr.left,
            top: r.top - cr.top - 11,
            width: r.width,
          };
        })()
      : null;

  // ponytail: handle style — gray bg that matches the row/column span,
  // hover lifts to a stronger surface. No border/shadow — the bar shape
  // itself reads as an affordance belonging to the row/column.
  // ponytail: custom SVG dots (not lucide) so we can widen the dot
  // spacing — lucide's MoreVertical/Horizontal at size 12 packs dots
  // 4px apart which reads as a single blob; 6px reads as three.
  const handleBtnClass =
    'pointer-events-auto absolute rounded-md flex items-center justify-center text-t1 bg-surf2 hover:bg-hov';
  const rowDotsSvg = (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden>
      <circle cx="5" cy="2" r="1.5" fill="currentColor" />
      <circle cx="5" cy="8" r="1.5" fill="currentColor" />
      <circle cx="5" cy="14" r="1.5" fill="currentColor" />
    </svg>
  );
  const colDotsSvg = (
    <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden>
      <circle cx="2" cy="5" r="1.5" fill="currentColor" />
      <circle cx="8" cy="5" r="1.5" fill="currentColor" />
      <circle cx="14" cy="5" r="1.5" fill="currentColor" />
    </svg>
  );
  // ponytail: + buttons sit flush outside the table's right/bottom edge
  // (1px gap, matching the handle bars). Trigger zone is the border line
  // itself (6px tolerance either side, see mousemove in the layout effect
  // above), not the cells — so the bar appears when the user reaches for
  // the edge, not on every cell hover.
  const plusSvg = (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="1" y="4.25" width="8" height="1.5" fill="currentColor" rx="0.5" />
      <rect x="4.25" y="1" width="1.5" height="8" fill="currentColor" rx="0.5" />
    </svg>
  );
  const addColBtn =
    cr && rowBtn && colBtn && edgeHover.right
      ? (() => {
          const t = findCurrentTableDom(editor);
          if (!t) return null;
          const r = t.getBoundingClientRect();
          return { left: r.right - cr.left + 1, top: r.top - cr.top, height: r.height };
        })()
      : null;
  const addRowBtn =
    cr && rowBtn && colBtn && edgeHover.bottom
      ? (() => {
          const t = findCurrentTableDom(editor);
          if (!t) return null;
          const r = t.getBoundingClientRect();
          return { left: r.left - cr.left, top: r.bottom - cr.top + 1, width: r.width };
        })()
      : null;

  // ponytail: append row/col at the table's edge — find the last row's
  // first cell (for addRowAfter) and first row's last cell (for
  // addColumnAfter) and run the command via runOnCell which sets a
  // cell selection first (TableKit's add*After operates on the
  // selected cell's row/column).
  const onAddColRight = () => {
    const table = findCurrentTableDom(editor);
    if (!table) return;
    const firstRow = table.rows[0];
    const lastCell = firstRow?.cells[firstRow.cells.length - 1] as HTMLTableCellElement | undefined;
    if (!lastCell) return;
    runOnCell(editor, lastCell, 'addColumnAfter');
  };
  const onAddRowBottom = () => {
    const table = findCurrentTableDom(editor);
    if (!table) return;
    const lastRow = table.rows[table.rows.length - 1];
    const firstCell = lastRow?.cells[0] as HTMLTableCellElement | undefined;
    if (!firstCell) return;
    runOnCell(editor, firstCell, 'addRowAfter');
  };

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
      { label: t('editor:table.rowMenu.insertAbove'), icon: ArrowUpFromLine, onClick: () => runRow('addRowBefore') },
      { label: t('editor:table.rowMenu.insertBelow'), icon: ArrowDownToLine, onClick: () => runRow('addRowAfter') },
      { label: t('editor:table.rowMenu.delete'), icon: Trash2, danger: true, onClick: () => runRow('deleteRow') },
    ];
    if (isFirst) {
      items.push({ label: '---', onClick: () => {} });
      items.push({ label: t('editor:table.rowMenu.toggleHeader'), icon: Rows3, onClick: () => editor.chain().focus().toggleHeaderRow().run() });
    }
    // ponytail: Backspace only deletes the table when ALL cells are
    // selected (Tiptap deleteTableWhenAllCellsSelected). Surfacing
    // deleteTable here gives a one-click path without needing a full-
    // cell select first.
    items.push({ label: '---', onClick: () => {} });
    items.push({ label: t('editor:table.cellMenu.deleteTable'), icon: Trash2, danger: true, onClick: () => editor.chain().focus().deleteTable().run() });
    setMenu({ items, x: e.clientX, y: e.clientY });
  };

  const openColMenu = (e: React.MouseEvent, cell: HTMLTableCellElement) => {
    e.preventDefault();
    e.stopPropagation();
    const isFirst = cell.cellIndex === 0;
    const items: TableMenuItem[] = [
      { label: t('editor:table.colMenu.insertLeft'), icon: ArrowLeftFromLine, onClick: () => runOnCell(editor, cell, 'addColumnBefore') },
      { label: t('editor:table.colMenu.insertRight'), icon: ArrowRightToLine, onClick: () => runOnCell(editor, cell, 'addColumnAfter') },
      { label: t('editor:table.colMenu.delete'), icon: Trash2, danger: true, onClick: () => runOnCell(editor, cell, 'deleteColumn') },
    ];
    if (isFirst) {
      items.push({ label: '---', onClick: () => {} });
      items.push({ label: t('editor:table.colMenu.toggleHeader'), icon: Columns3, onClick: () => editor.chain().focus().toggleHeaderColumn().run() });
    }
    items.push({ label: '---', onClick: () => {} });
    items.push({ label: t('editor:table.cellMenu.deleteTable'), icon: Trash2, danger: true, onClick: () => editor.chain().focus().deleteTable().run() });
    setMenu({ items, x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {/* row-left hover handle */}
        {rowHandle && (
          <button
            type="button"
            title={t('editor:table.handle.rowActions')}
            data-table-handle
            draggable
            onDragStart={(e) => {
              if (!hover.rowTr) return;
              // ponytail: stash source row index in a custom MIME. drop
              // handler in RichTextEditor reads this to call moveTableRow.
              // Known ceiling: rowIndex is DOM order, not TableMap row —
              // breaks if the table ever has multiple tbody/thead sections.
              // Tiptap emits a single tbody so this matches TableMap rows.
              e.dataTransfer.setData('application/x-folyn-table-row', String(hover.rowTr.rowIndex));
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={handleBtnClass}
            style={{ left: rowHandle.left, top: rowHandle.top, height: rowHandle.height, width: 10 }}
            onClick={(e) => hover.rowTr && openRowMenu(e, hover.rowTr)}
          >
            {rowDotsSvg}
          </button>
        )}
        {/* col-top hover handle */}
        {colHandle && (
          <button
            type="button"
            title={t('editor:table.handle.colActions')}
            data-table-handle
            draggable
            onDragStart={(e) => {
              if (!hover.colCell) return;
              // ponytail: cellIndex is DOM cell order, not column index —
              // breaks for tables with colspan (a merged cell's cellIndex
              // is its DOM slot, not its column). MVP: simple tables only.
              e.dataTransfer.setData('application/x-folyn-table-col', String(hover.colCell.cellIndex));
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={handleBtnClass}
            style={{ left: colHandle.left, top: colHandle.top, width: colHandle.width, height: 10 }}
            onClick={(e) => hover.colCell && openColMenu(e, hover.colCell)}
          >
            {colDotsSvg}
          </button>
        )}
        {/* right-edge + button: append column */}
        {addColBtn && (
          <button
            type="button"
            title={t('editor:table.colMenu.insertRight')}
            data-table-handle
            className={handleBtnClass}
            style={{ left: addColBtn.left, top: addColBtn.top, height: addColBtn.height, width: 10 }}
            onClick={onAddColRight}
          >
            {plusSvg}
          </button>
        )}
        {/* bottom-edge + button: append row */}
        {addRowBtn && (
          <button
            type="button"
            title={t('editor:table.rowMenu.insertBelow')}
            data-table-handle
            className={handleBtnClass}
            style={{ left: addRowBtn.left, top: addRowBtn.top, width: addRowBtn.width, height: 10 }}
            onClick={onAddRowBottom}
          >
            {plusSvg}
          </button>
        )}
      </div>
      {menu && (
        <TableMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
