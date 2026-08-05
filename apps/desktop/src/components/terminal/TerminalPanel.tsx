import { useEffect, useRef, useState } from 'react';
import { useTerminalStore } from '@/store/terminalStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useTranslation } from 'react-i18next';
import { TerminalView } from './TerminalView';
import { Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import terminalIcon from '@/assets/terminal.svg';

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 240;

/**
 * Terminal panel: session-tab header + xterm body, docked at the BOTTOM of
 * the editor page. The header's toggle button collapses/expands the panel;
 * the strip above the header is a drag handle that resizes the panel height
 * vertically. Owns its own height so collapse/reopen keeps the user's size.
 */
export function TerminalPanel() {
  const { t } = useTranslation();
  const terminalPanelVisible = useEditorViewStateStore((s) => s.terminalPanelVisible);
  const closeTerminalPanel = useEditorViewStateStore((s) => s.closeTerminalPanel);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const addSession = useTerminalStore((s) => s.addSession);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeSession = useTerminalStore((s) => s.closeSession);

  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Vertical resize: dragging the top strip changes the panel height.
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = drag.startY - e.clientY;
      const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, drag.startHeight + delta));
      setHeight(next);
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
  }, []);

  return (
    <div
      className="shrink-0 flex flex-col overflow-hidden bg-bg border-t border-brd"
      style={{ height }}
    >
      {/* Resize handle: 5px invisible hit target with a 1px visible line, so
          the separator stays slim but the grab area is easy to hit. */}
      <div
        className="shrink-0 h-[5px] cursor-row-resize bg-transparent relative"
        onMouseDown={(e) => {
          e.preventDefault();
          dragRef.current = { startY: e.clientY, startHeight: height };
          document.body.style.cursor = 'row-resize';
          document.documentElement.classList.add('is-resizing');
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-px bg-brd transition-colors duration-150 hover:bg-acc hover:opacity-60" />
      </div>

      <div className="flex items-center gap-0.5 h-[34px] shrink-0 px-2 bg-panel border-b border-brd overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-1.5 h-[24px] px-2.5 rounded-[6px] text-[11px] font-mono cursor-pointer whitespace-nowrap shrink-0 transition-colors duration-150 select-none ${
              s.id === activeId
                ? 'bg-surf2 text-t1'
                : 'text-t3 hover:bg-hov hover:text-t2'
            }`}
            onClick={() => setActive(s.id)}
          >
            <img
              src={terminalIcon}
              alt=""
              width="11"
              height="11"
              className={`shrink-0 ${s.id === activeId ? '' : 'opacity-50'}`}
            />
            <span className={`max-w-[120px] overflow-hidden text-ellipsis ${s.status === 'exited' ? 'opacity-50' : ''}`}>{s.title}</span>
            {s.status === 'exited' && (
              <button
                className="shrink-0 w-[15px] h-[15px] flex items-center justify-center rounded-[3px] text-t3 hover:bg-hov hover:text-t1 border-none bg-transparent cursor-pointer"
                title={t('terminal:restart')}
                onClick={(e) => {
                  e.stopPropagation();
                  // Kill the dead session and open a fresh one.
                  closeSession(s.id);
                  setActive(addSession());
                }}
              >
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeLinecap="round" />
                  <path d="M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <button
              className="opacity-0 group-hover:opacity-100 shrink-0 w-[15px] h-[15px] flex items-center justify-center rounded-[3px] text-t3 hover:bg-hov hover:text-red border-none bg-transparent cursor-pointer"
              title={t('terminal:close')}
              onClick={(e) => {
                e.stopPropagation();
                closeSession(s.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="shrink-0 w-[24px] h-[24px] flex items-center justify-center rounded-[5px] text-t3 border-none bg-transparent cursor-pointer transition-colors duration-150 hover:bg-hov hover:text-t1"
          title={t('terminal:new')}
          onClick={addSession}
        >
          <Plus size={12} />
        </button>
        <div className="flex-1 min-w-0" />
        <button
          className="shrink-0 w-[24px] h-[24px] flex items-center justify-center rounded-[5px] text-t3 border-none bg-transparent cursor-pointer transition-colors duration-150 hover:bg-hov hover:text-t1"
          title={terminalPanelVisible ? t('terminal:collapseToBottom') : t('terminal:openAtBottom')}
          onClick={() => (terminalPanelVisible ? closeTerminalPanel() : useEditorViewStateStore.getState().openTerminalDock())}
        >
          {terminalPanelVisible ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button
          className="shrink-0 w-[24px] h-[24px] flex items-center justify-center rounded-[5px] text-t3 border-none bg-transparent cursor-pointer transition-colors duration-150 hover:bg-hov hover:text-t1"
          title={t('terminal:closePanel')}
          onClick={closeTerminalPanel}
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {sessions.map((s) => (
          <TerminalView key={s.id} id={s.id} active={s.id === activeId} />
        ))}
        {sessions.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg">
            <div className="w-[44px] h-[44px] rounded-[10px] bg-hov border border-brd flex items-center justify-center">
              <img src={terminalIcon} alt="" width="18" height="18" className="opacity-70" />
            </div>
            <span className="text-xs text-t3">{t('terminal:empty')}</span>
            <button
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] bg-acc text-white text-xs border-none cursor-pointer transition-opacity hover:opacity-90 font-medium"
              onClick={addSession}
            >
              <Plus size={12} />
              {t('terminal:new')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
