import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { AiPanel } from './AiPanel';
import { TerminalPanel } from '../terminal/TerminalPanel';

const MIN_WIDTH = 300;
const MAX_WIDTH = 760;
const DEFAULT_WIDTH = 380;

/**
 * Right-hand dock hosting the AI panel and the terminal panel as two
 * independent columns (no tab bar, no stacking). Each panel has its own
 * header/close and its own width + left-edge resize handle.
 */
export function RightDock() {
  const aiPanelVisible = useEditorViewStateStore((s) => s.aiPanelVisible);
  const terminalPanelVisible = useEditorViewStateStore((s) => s.terminalPanelVisible);

  const [aiWidth, setAiWidth] = useState(DEFAULT_WIDTH);
  const [termWidth, setTermWidth] = useState(DEFAULT_WIDTH);
  const aiRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ which: 'ai' | 'term'; rightEdge: number } | null>(null);

  const startResize = useCallback((which: 'ai' | 'term', e: React.MouseEvent) => {
    e.preventDefault();
    const el = which === 'ai' ? aiRef.current : termRef.current;
    const rightEdge = el ? el.getBoundingClientRect().right : window.innerWidth;
    draggingRef.current = { which, rightEdge };
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
      if (drag.which === 'ai') {
        setAiWidth(clamped);
      } else {
        setTermWidth(clamped);
      }
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

  if (!aiPanelVisible && !terminalPanelVisible) return null;

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
            onMouseDown={(e) => startResize('ai', e)}
          />
          <AiPanel embedded showClose />
        </div>
      )}
      {terminalPanelVisible && (
        <div
          ref={termRef}
          className="h-full flex flex-col overflow-hidden relative shrink-0 border-l border-brd"
          style={{ width: termWidth }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-0.5 cursor-col-resize z-10 bg-transparent transition-[background] duration-[140ms] hover:bg-acc hover:opacity-30"
            onMouseDown={(e) => startResize('term', e)}
          />
          <TerminalPanel />
        </div>
      )}
    </div>
  );
}
