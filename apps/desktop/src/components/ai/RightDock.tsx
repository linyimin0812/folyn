import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { AiPanel } from './AiPanel';
import { TerminalPanel } from '../terminal/TerminalPanel';

const MIN_WIDTH = 300;
const MAX_WIDTH = 760;
const DEFAULT_WIDTH = 380;

/**
 * Right-hand dock hosting the AI panel and the terminal panel. No tab bar —
 * each panel has its own header/close; when both are open they stack
 * (AI on top, terminal below), like Codex's chat + terminal sidebar.
 */
export function RightDock() {
  const aiPanelVisible = useEditorViewStateStore((s) => s.aiPanelVisible);
  const terminalPanelVisible = useEditorViewStateStore((s) => s.terminalPanelVisible);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const draggingRef = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.documentElement.classList.add('is-resizing');
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      // The dock is anchored right; width = window width - pointer x.
      const w = window.innerWidth - e.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)));
    };
    const stopResize = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.documentElement.classList.remove('is-resizing');
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stopResize);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stopResize);
    };
  }, []);

  if (!aiPanelVisible && !terminalPanelVisible) return null;

  return (
    <div
      className="h-full bg-panel flex flex-col overflow-hidden relative shrink-0 border-l border-brd"
      style={{ width }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 cursor-col-resize z-10 bg-transparent transition-[background] duration-[140ms] hover:bg-acc hover:opacity-30"
        onMouseDown={startResize}
      />
      {aiPanelVisible && (
        <div className="flex-1 min-h-0">
          <AiPanel embedded showClose />
        </div>
      )}
      {terminalPanelVisible && <TerminalPanel />}
    </div>
  );
}
