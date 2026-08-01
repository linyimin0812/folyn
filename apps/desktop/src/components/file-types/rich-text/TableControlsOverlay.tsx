import { useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { findTable, TableMap } from '@tiptap/pm/tables';
import { Plus } from 'lucide-react';

// ponytail: Option A from the PRD — a React overlay (NOT a custom NodeView) that
// renders "+" buttons to append a row (bottom-left of the table) and a column
// (top-right of the table) when the cursor is inside a table. We do NOT touch
// TableKit's TableView, so cell-selection / resize / colgroup keep working.
//
// Positioning: the overlay is an abspos child of the content wrapper (relative,
// NOT a scroll container) — so the buttons scroll with the content and stay
// glued to the table. Coords are wrapper-relative (table.rect − wrapper.rect),
// scroll-invariant: scrolling moves both by the same delta, so no re-measure
// on scroll and no scroll offset needed. Recompute only on editor transaction
// (cursor move / edit changes which table is active or its size) and on window
// resize, rAF-debounced so a flapping cursor doesn't thrash layout.
//
// Append semantics: TableKit's addRowAfter/addColumnAfter add relative to the
// CURRENT cell selection. To append at the end we first setCellSelection to the
// last row's first cell (for addRowAfter) / last column's first-row cell (for
// addColumnAfter), then run the command. Positions come from prosemirror-tables
// TableMap.positionAt; map entries are relative to table content start, so
// absolute cell pos = found.start + positionAt(...). Ceiling: if the last row
// is spanned by an earlier merged cell, the row is added after that cell's
// actual row — not the table bottom. Acceptable for MVP (rare with merges).

interface TableControlsOverlayProps {
  editor: Editor;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface BtnPos {
  left: number;
  top: number;
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

// Set cell selection to the cell covering (row, col) of the current table,
// then run a chained command. Returns the chain result.
function selectCellAndRun(editor: Editor, row: number, col: number, command: 'addRowAfter' | 'addColumnAfter'): boolean {
  const { $from } = editor.state.selection;
  const found = findTable($from);
  if (!found) return false;
  const map = TableMap.get(found.node);
  const cellPos = found.start + map.positionAt(row, col, found.node);
  return editor.chain().focus().setCellSelection({ anchorCell: cellPos })[command]().run();
}

export function TableControlsOverlay({ editor, containerRef }: TableControlsOverlayProps) {
  const [rowBtn, setRowBtn] = useState<BtnPos | null>(null);
  const [colBtn, setColBtn] = useState<BtnPos | null>(null);
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
        // wrapper-relative — both shift identically on scroll, no offset needed
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

  if (!rowBtn || !colBtn) return null;

  const btnClass =
    'pointer-events-auto absolute w-5 h-5 rounded-full border border-brd bg-panel shadow flex items-center justify-center text-t2 hover:bg-hov hover:text-t1';

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <button
        type="button"
        title="Add row"
        className={btnClass}
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
      <button
        type="button"
        title="Add column"
        className={btnClass}
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
    </div>
  );
}
