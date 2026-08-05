import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTerminalStore } from '@/store/terminalStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useTranslation } from 'react-i18next';
import { TerminalView } from './TerminalView';
import { Plus, X, Maximize2, Minimize2 } from 'lucide-react';
import terminalIcon from '@/assets/terminal.svg';

/** Terminal panel: session-tab header + xterm body. Owns its own header and
 *  close button (no dock tab bar). The header's fullscreen button expands the
 *  terminal over the whole editor page. */
export function TerminalPanel() {
  const { t } = useTranslation();
  const [fullscreen, setFullscreen] = useState(false);
  const [overlayLeft, setOverlayLeft] = useState(0);
  const terminalPanelVisible = useEditorViewStateStore((s) => s.terminalPanelVisible);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const addSession = useTerminalStore((s) => s.addSession);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const closeTerminalPanel = useEditorViewStateStore((s) => s.closeTerminalPanel);

  // Esc exits fullscreen mode.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Collapsing the panel while fullscreen exits fullscreen (the hidden column
  // keeps its content mounted).
  useEffect(() => {
    if (fullscreen && !terminalPanelVisible) setFullscreen(false);
  }, [fullscreen, terminalPanelVisible]);

  // Fullscreen covers the editor page but keeps the left file sidebar (and
  // activity bar) visible: the overlay starts at the sidebar's right edge.
  useEffect(() => {
    if (!fullscreen) return;
    const measure = () => {
      // `.sidebar-wrapper` is display:contents on desktop (zero rect); the
      // actual width lives on `.sidebar`.
      const sidebar =
        document.querySelector('.sidebar-wrapper .sidebar') ??
        document.querySelector('.sidebar');
      setOverlayLeft(sidebar ? Math.round(sidebar.getBoundingClientRect().right) : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [fullscreen]);

  const content = (
    <>
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
          title={fullscreen ? t('terminal:exitFullscreen') : t('terminal:fullscreen')}
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
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
    </>
  );

  if (fullscreen) {
    // Cover the editor page (topbar included) above every panel, starting at
    // the left sidebar's right edge so the file bar stays visible.
    return createPortal(
      <div
        className="fixed top-0 right-0 bottom-0 z-[300] flex flex-col overflow-hidden bg-bg"
        style={{ left: overlayLeft }}
      >
        {content}
      </div>,
      document.body,
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-bg">
      {content}
    </div>
  );
}
