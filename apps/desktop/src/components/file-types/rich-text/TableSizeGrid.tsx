import { useState } from 'react';

// ponytail: 8x8 hover grid picker for table size. Parent owns positioning
// (rendered as an absolutely-positioned popover from the toolbar table
// button) and click-outside dismissal — this component is just the grid +
// the "{rows} × {cols}" label. Matches the Notion/Google Docs convention.

const MAX = 8;

interface TableSizeGridProps {
  onSelect: (rows: number, cols: number) => void;
}

export function TableSizeGrid({ onSelect }: TableSizeGridProps) {
  const [hover, setHover] = useState({ rows: 1, cols: 1 });

  return (
    <div className="p-2 rounded-lg border border-brd bg-panel shadow-lg">
      <div
        className="grid gap-[2px]"
        style={{ gridTemplateRows: `repeat(${MAX}, 16px)`, gridAutoFlow: 'column' }}
        onMouseLeave={() => setHover({ rows: 1, cols: 1 })}
      >
        {Array.from({ length: MAX * MAX }, (_, i) => {
          const r = (i % MAX) + 1;
          const c = Math.floor(i / MAX) + 1;
          const active = r <= hover.rows && c <= hover.cols;
          return (
            <button
              key={i}
              type="button"
              className={`rounded-sm border border-brd2 ${active ? 'bg-acc' : 'bg-surf2 hover:bg-hov'}`}
              onMouseEnter={() => setHover({ rows: r, cols: c })}
              onClick={() => onSelect(r, c)}
              aria-label={`${r} × ${c}`}
            />
          );
        })}
      </div>
      <div className="text-center text-t2 text-[length:var(--ui-font-size)] mt-1.5">
        {hover.rows} × {hover.cols}
      </div>
    </div>
  );
}
