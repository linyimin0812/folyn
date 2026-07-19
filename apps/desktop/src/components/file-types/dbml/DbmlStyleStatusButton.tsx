import { useEffect, useRef, useState } from 'react';
import { extractDbmlMeta, type DbmlMeta } from './parseDbml';

// ponytail: read-only status button at the bottom-right of the CodeMirror
// editor pane for .dbml tabs. Reads the trailing `<!-- dbml:meta -->` block
// straight from the tab content — no shared runtime state with ErDiagramX6,
// purely derived from what's persisted in the file. Click opens a popover
// summarizing positions count / zoom / grid; click-vs-drag is guarded so
// a CodeMirror selection-drag that ends on the button doesn't toggle.
export function DbmlStyleStatusButton({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<DbmlMeta | undefined>(undefined);

  useEffect(() => {
    const { meta } = extractDbmlMeta(content);
    setMeta(meta);
  }, [content]);

  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const handleMouseDown = (e: React.MouseEvent) => {
    downPosRef.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseUp = (e: React.MouseEvent) => {
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (dx * dx + dy * dy > 16) return;
    setOpen((v) => !v);
  };

  const positionsCount = meta ? Object.keys(meta.positions).length : 0;
  const zoomPct = meta?.view?.zoomPct ?? 100;
  const showGrid = meta?.view?.showGrid ?? false;

  return (
    <>
      <button
        type="button"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        aria-label="查看已持久化的样式"
        aria-expanded={open}
        className="absolute bottom-2 right-2 z-20 flex items-center gap-1.5 h-6 px-2.5 bg-[var(--bg)] border border-[var(--brd)] rounded-md text-[11px] text-[var(--t2)] hover:bg-[var(--hov)] hover:text-[var(--t1)] shadow-sm transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v6M5 8h6" />
        </svg>
        <span>样式</span>
      </button>
      {open && (
        <div className="absolute bottom-10 right-2 z-20 w-[240px] bg-[var(--bg)] border border-[var(--brd)] rounded-md shadow-md text-[12px] text-[var(--t1)] py-2 px-3">
          <div className="text-[10px] font-semibold text-[var(--t3)] uppercase tracking-[0.08em] mb-1.5">已持久化样式</div>
          <dl className="flex flex-col gap-1">
            <div className="flex justify-between">
              <dt className="text-[var(--t3)]">节点位置</dt>
              <dd className="tabular-nums">{positionsCount} 个</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--t3)]">缩放</dt>
              <dd className="tabular-nums">{zoomPct}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--t3)]">网格</dt>
              <dd>{showGrid ? '显示' : '隐藏'}</dd>
            </div>
          </dl>
          <div className="mt-2 pt-1.5 border-t border-[var(--brd)] text-[10px] text-[var(--t3)] leading-[1.5]">
            拖动节点、缩放或切换网格后，会自动写入文件末尾的 <code className="text-[var(--t2)]">&lt;!-- dbml:meta --&gt;</code> 注释块。
          </div>
        </div>
      )}
    </>
  );
}
