import { useCallback, useEffect, useRef } from 'react';
import { useEditorViewStateStore } from '@/store/editorViewState';

/** Min/max for the right-dock terminal width (px). Shared constraint with the
 *  editorViewState store default. */
const MIN_TERMINAL_RIGHT_WIDTH = 240;
const MAX_TERMINAL_RIGHT_WIDTH = 640;

/** Right-edge resize handle for the terminal dock. Drags left/right to resize
 *  the dock width (persisted in editorViewState.terminalRightWidth). */
export function TerminalRightResizeHandle() {
  const terminalRightWidth = useEditorViewStateStore((s) => s.terminalRightWidth);
  const setTerminalRightWidth = useEditorViewStateStore((s) => s.setTerminalRightWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const startResize = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: terminalRightWidth };
      document.body.style.cursor = 'col-resize';
      document.documentElement.classList.add('is-resizing');
    },
    [terminalRightWidth],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = drag.startWidth + drag.startX - e.clientX;
      setTerminalRightWidth(Math.max(MIN_TERMINAL_RIGHT_WIDTH, Math.min(MAX_TERMINAL_RIGHT_WIDTH, next)));
    };
    const stopResize = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.documentElement.classList.remove('is-resizing');
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stopResize);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stopResize);
    };
  }, [setTerminalRightWidth]);

  return (
    <div
      className="absolute left-0 top-0 bottom-0 w-0.5 cursor-col-resize z-10 bg-transparent transition-[background] duration-[140ms] hover:bg-acc hover:opacity-30"
      onMouseDown={startResize}
    />
  );
}
