import { useTerminalStore } from '@/store/terminalStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useTranslation } from 'react-i18next';
import { TerminalView } from './TerminalView';
import { Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import terminalIcon from '@/assets/terminal.svg';

const DEFAULT_HEIGHT = 240;

/**
 * Terminal panel: session-tab header + xterm body, docked at the BOTTOM of
 * the editor page. The header's toggle button collapses/expands the panel;
 * the height is lifted to the bottom strip (BottomTerminal) so the resize
 * handle and the panel share one source of truth; collapse/reopen keeps the
 * user's size.
 */
export function TerminalPanel({
  height = DEFAULT_HEIGHT,
}: {
  height?: number;
}) {
  const { t } = useTranslation();
  const terminalPanelVisible = useEditorViewStateStore((s) => s.terminalPanelVisible);
  const closeTerminalPanel = useEditorViewStateStore((s) => s.closeTerminalPanel);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const addSession = useTerminalStore((s) => s.addSession);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeSession = useTerminalStore((s) => s.closeSession);

  return (
    <div
      className="shrink-0 flex flex-col overflow-hidden bg-bg"
      style={{ height }}
    >
      <div className="flex items-stretch gap-1 h-[28px] shrink-0 px-2 bg-panel border-b border-brd overflow-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex-1 min-w-0 flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group self-center flex items-center gap-1.5 h-[26px] px-2 rounded-[6px] text-[13px] leading-none font-mono cursor-pointer whitespace-nowrap shrink-0 transition-colors duration-150 select-none ${
                s.id === activeId
                  ? 'bg-surf2 text-t1'
                  : 'text-t3 hover:bg-hov hover:text-t2'
              }`}
              onClick={() => setActive(s.id)}
            >
              <img
                src={terminalIcon}
                alt=""
                width="14"
                height="14"
                className={`shrink-0 block ${s.id === activeId ? '' : 'opacity-50'}`}
              />
              <span className={`max-w-[120px] overflow-hidden text-ellipsis leading-none ${s.status === 'exited' ? 'opacity-50' : ''}`}>{s.title}</span>
              {s.status === 'exited' && (
                <button
                  className="shrink-0 w-[18px] h-[18px] flex items-center justify-center rounded-[3px] text-t3 hover:bg-hov hover:text-t1 border-none bg-transparent cursor-pointer"
                  title={t('terminal:restart')}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Kill the dead session and open a fresh one.
                    closeSession(s.id);
                    setActive(addSession());
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeLinecap="round" />
                    <path d="M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              <button
                className="opacity-0 group-hover:opacity-100 shrink-0 w-[18px] h-[18px] flex items-center justify-center rounded-[3px] text-[11px] text-t3 hover:bg-hov hover:text-red border-none bg-transparent cursor-pointer"
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
            className="self-center shrink-0 w-[24px] h-[26px] flex items-center justify-center rounded-[5px] text-t3 border-none bg-transparent cursor-pointer transition-colors duration-150 hover:bg-hov hover:text-t1"
            title={t('terminal:new')}
            onClick={addSession}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="shrink-0 flex items-center justify-end">
          <button
            className="self-center shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-[5px] text-t3 border-none bg-transparent cursor-pointer transition-colors duration-150 hover:bg-hov hover:text-t1"
            title={terminalPanelVisible ? t('terminal:collapseToBottom') : t('terminal:openAtBottom')}
            onClick={() => (terminalPanelVisible ? closeTerminalPanel() : useEditorViewStateStore.getState().openTerminalDock())}
          >
            {terminalPanelVisible ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          <button
            className="self-center shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-[5px] text-t3 border-none bg-transparent cursor-pointer transition-colors duration-150 hover:bg-hov hover:text-t1"
            title={t('terminal:closePanel')}
            onClick={closeTerminalPanel}
          >
            <X size={16} />
          </button>
        </div>
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
