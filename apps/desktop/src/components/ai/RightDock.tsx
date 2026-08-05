import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useTerminalStore } from '@/store/terminalStore';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { AiPanel } from './AiPanel';
import { TerminalPanel } from '../terminal/TerminalPanel';

const MIN_WIDTH = 300;
const MAX_WIDTH = 760;
const DEFAULT_WIDTH = 380;

/**
 * Right-hand dock that hosts the AI panel and the terminal panel behind a
 * slim AI / Terminal tab switcher. Owns the shared width + resize handle;
 * both panels render `embedded` (they fill whatever width the dock gives).
 */
export function RightDock() {
  const { t } = useTranslation();
  const aiPanelVisible = useEditorViewStateStore((s) => s.aiPanelVisible);
  const terminalPanelVisible = useEditorViewStateStore((s) => s.terminalPanelVisible);
  const rightDockTab = useEditorViewStateStore((s) => s.rightDockTab);
  const setRightDockTab = useEditorViewStateStore((s) => s.setRightDockTab);
  const closeRightDock = useEditorViewStateStore((s) => s.closeRightDock);
  const terminalSessions = useTerminalStore((s) => s.sessions);
  const terminalActiveId = useTerminalStore((s) => s.activeId);
  const terminalAdd = useTerminalStore((s) => s.addSession);
  const terminalSetActive = useTerminalStore((s) => s.setActive);
  const terminalClose = useTerminalStore((s) => s.closeSession);

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

  const tabButton = (tab: 'ai' | 'terminal', label: string, icon: React.ReactNode) => (
    <button
      className={`flex items-center gap-1.5 h-[22px] px-2.5 rounded-[5px] text-[11px] font-medium cursor-pointer border-none transition-colors duration-150 ${
        rightDockTab === tab ? 'bg-hov text-t1' : 'text-t3 hover:bg-hov hover:text-t2'
      }`}
      onClick={() => setRightDockTab(tab)}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      className="h-full bg-panel flex flex-col overflow-hidden relative shrink-0 border-l border-brd"
      style={{ width }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 cursor-col-resize z-10 bg-transparent transition-[background] duration-[140ms] hover:bg-acc hover:opacity-30"
        onMouseDown={startResize}
      />
      <div className="flex items-center gap-1 h-[26px] shrink-0 pl-3 pr-1.5 border-b border-brd">
        {tabButton('ai', t('shell:rightDock.ai'), (
          <span className="text-acc text-[12px] leading-none">✦</span>
        ))}
        {tabButton('terminal', t('shell:rightDock.terminal'), (
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <path d="M4.5 6l2.5 2-2.5 2M8.5 10.5h3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ))}
        {rightDockTab === 'terminal' && (
          <>
            <div className="w-px h-[14px] bg-brd2 mx-1 shrink-0" />
            <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {terminalSessions.map((s) => (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1 h-[22px] px-2 rounded-[5px] text-[11px] font-mono cursor-pointer whitespace-nowrap shrink-0 transition-colors duration-150 select-none ${
                    s.id === terminalActiveId
                      ? 'bg-surf2 text-t1'
                      : 'text-t3 hover:bg-hov hover:text-t2'
                  }`}
                  onClick={() => terminalSetActive(s.id)}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className={`shrink-0 ${s.id === terminalActiveId ? 'text-acc' : 'text-t4'}`}
                  >
                    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
                    <path d="M4.5 6l2.5 2-2.5 2M8.5 10.5h3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className={`max-w-[110px] overflow-hidden text-ellipsis ${s.status === 'exited' ? 'opacity-50' : ''}`}>
                    {s.title}
                  </span>
                  {s.status === 'exited' && (
                    <button
                      className="shrink-0 w-[14px] h-[14px] flex items-center justify-center rounded-[3px] text-t3 hover:bg-hov hover:text-t1 border-none bg-transparent cursor-pointer"
                      title={t('terminal:restart')}
                      onClick={(e) => {
                        e.stopPropagation();
                        terminalClose(s.id);
                        terminalSetActive(terminalAdd());
                      }}
                    >
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeLinecap="round" />
                        <path d="M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                  <button
                    className="opacity-0 group-hover:opacity-100 shrink-0 w-[14px] h-[14px] flex items-center justify-center rounded-[3px] text-t3 hover:bg-hov hover:text-red border-none bg-transparent cursor-pointer"
                    title={t('terminal:close')}
                    onClick={(e) => {
                      e.stopPropagation();
                      terminalClose(s.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-[5px] text-t3 border-none bg-transparent cursor-pointer transition-colors duration-150 hover:bg-hov hover:text-t1"
                title={t('terminal:new')}
                onClick={terminalAdd}
              >
                <Plus size={11} />
              </button>
            </div>
          </>
        )}
        {rightDockTab !== 'terminal' && <div className="flex-1" />}
        <button
          className="w-[22px] h-[22px] flex items-center justify-center rounded-[5px] border-none bg-transparent text-t3 cursor-pointer transition-colors duration-150 hover:bg-hov hover:text-t1"
          onClick={closeRightDock}
          title={t('shell:rightDock.close')}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>
      {rightDockTab === 'ai' && aiPanelVisible ? (
        <AiPanel embedded />
      ) : rightDockTab === 'terminal' && terminalPanelVisible ? (
        <TerminalPanel />
      ) : aiPanelVisible ? (
        <AiPanel embedded />
      ) : (
        <TerminalPanel />
      )}
    </div>
  );
}
