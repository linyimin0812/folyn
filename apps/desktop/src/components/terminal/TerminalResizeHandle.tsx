import { useEffect, useState } from 'react';

/**
 * 2px visible separator with an 8px hit target. The line sits at the TOP
 * edge of the handle so clicking ON the line (and a comfortable strip below
 * it, over the terminal header) starts the drag — not just a few pixels
 * above the line. The strip below the line matches the header color, so
 * only the line separates the editor from the terminal.
 */
export function TerminalResizeHandle({
  height,
  onHeightChange,
}: {
  height: number;
  onHeightChange: (height: number) => void;
}) {
  const [dragging, setDragging] = useState<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e: MouseEvent) => {
      const delta = dragging.startY - e.clientY;
      const next = Math.max(100, Math.min(600, dragging.startHeight + delta));
      onHeightChange(next);
    };
    const stop = () => {
      setDragging(null);
      document.body.style.cursor = '';
      document.documentElement.classList.remove('is-resizing');
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stop);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stop);
    };
  }, [dragging]);

  return (
    <div
      className="shrink-0 h-[8px] relative cursor-row-resize bg-panel"
      onMouseDown={(e) => {
        e.preventDefault();
        setDragging({ startY: e.clientY, startHeight: height });
        document.body.style.cursor = 'row-resize';
        document.documentElement.classList.add('is-resizing');
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-brd transition-colors duration-150 hover:bg-acc hover:opacity-60" />
    </div>
  );
}
