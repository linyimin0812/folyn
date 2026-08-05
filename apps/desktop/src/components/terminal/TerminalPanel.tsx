import { useTerminalStore } from '@/store/terminalStore';
import { useTranslation } from 'react-i18next';
import { TerminalView } from './TerminalView';

export function TerminalPanel() {
  const { t } = useTranslation();
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const addSession = useTerminalStore((s) => s.addSession);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeSession = useTerminalStore((s) => s.closeSession);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#1e1e2e]">
      <div className="flex items-center gap-1 h-[30px] shrink-0 px-2 border-b border-brd bg-panel overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-1.5 h-[22px] px-2 rounded-[5px] text-[11px] cursor-pointer whitespace-nowrap shrink-0 border-none transition-colors duration-150 ${
              s.id === activeId ? 'bg-[#313244] text-t1' : 'text-t3 hover:bg-hov hover:text-t2'
            }`}
            onClick={() => setActive(s.id)}
          >
            <span className="flex items-center">
              {s.status === 'running' ? (
                <span className="w-[6px] h-[6px] rounded-full bg-green-500 shrink-0" />
              ) : s.status === 'exited' ? (
                <span className="w-[6px] h-[6px] rounded-full bg-red-500 shrink-0" />
              ) : (
                <span className="w-[6px] h-[6px] rounded-full bg-amber-400 shrink-0" />
              )}
            </span>
            <span className="max-w-[110px] overflow-hidden text-ellipsis">{s.title}</span>
            {s.status === 'exited' && (
              <button
                className="shrink-0 w-[14px] h-[14px] flex items-center justify-center rounded-[3px] text-t3 hover:bg-hov hover:text-t1 border-none bg-transparent cursor-pointer"
                title={t('terminal:restart')}
                onClick={(e) => {
                  e.stopPropagation();
                  // Kill the dead session and open a fresh one.
                  closeSession(s.id);
                  const id = addSession();
                  setActive(id);
                }}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeLinecap="round" />
                  <path d="M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <button
              className="opacity-0 group-hover:opacity-100 shrink-0 w-[14px] h-[14px] flex items-center justify-center rounded-[3px] text-t3 hover:text-red hover:bg-hov border-none bg-transparent cursor-pointer"
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
          className="shrink-0 w-[24px] h-[22px] flex items-center justify-center rounded-[5px] text-t3 border-none bg-transparent cursor-pointer transition-colors duration-150 hover:bg-hov hover:text-t1"
          title={t('terminal:new')}
          onClick={addSession}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <line x1="8" y1="2.5" x2="8" y2="13.5" /><line x1="2.5" y1="8" x2="13.5" y2="8" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {sessions.map((s) => (
          <TerminalView key={s.id} id={s.id} active={s.id === activeId} />
        ))}
        {sessions.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-t3 bg-[#1e1e2e]">
            <svg width="36" height="36" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" className="opacity-70">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
              <path d="M4.5 6l2.5 2-2.5 2M8.5 10.5h3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-xs">{t('terminal:empty')}</span>
            <button
              className="px-3 py-1.5 rounded-[6px] bg-acc text-white text-xs border-none cursor-pointer transition-opacity hover:opacity-90"
              onClick={addSession}
            >
              {t('terminal:new')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
