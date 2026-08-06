import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { AiPanel } from './AiPanel';

const MIN_WIDTH = 300;
const MAX_WIDTH = 760;
const DEFAULT_WIDTH = 380;

/**
 * Right-hand dock hosting the AI panel. The terminal can also dock here as a
 * separate right-side column (see App.tsx / TerminalPanel). The AI column has
 * its own width and left-edge resize handle.
 */
export function RightDock() {
  const aiPanelVisible = useEditorViewStateStore((s) => s.aiPanelVisible);

  const [aiWidth, setAiWidth] = useState(DEFAULT_WIDTH);
  const aiRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ rightEdge: number } | null>(null);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = aiRef.current;
    const rightEdge = el ? el.getBoundingClientRect().right : window.innerWidth;
    draggingRef.current = { rightEdge };
    document.body.style.cursor = 'col-resize';
    document.documentElement.classList.add('is-resizing');
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = draggingRef.current;
      if (!drag) return;
      // Column width = its right edge (captured at drag start) - pointer x.
      const w = drag.rightEdge - e.clientX;
      const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
      setAiWidth(clamped);
    };
    const stopResize = () => {
      draggingRef.current = null;
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

  if (!aiPanelVisible) return null;

  return (
    <div className="h-full flex items-stretch overflow-hidden shrink-0">
      {aiPanelVisible && (
        <div
          ref={aiRef}
          className="h-full flex flex-col overflow-hidden relative shrink-0 border-l border-brd"
          style={{ width: aiWidth }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-0.5 cursor-col-resize z-10 bg-transparent transition-[background] duration-[140ms] hover:bg-acc hover:opacity-30"
            onMouseDown={startResize}
          />
          <AiPanel embedded showClose />
        </div>
      )}
    </div>
  );
}
