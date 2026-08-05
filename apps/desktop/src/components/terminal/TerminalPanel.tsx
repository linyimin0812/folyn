import { useTerminalStore } from '@/store/terminalStore';
import { useTranslation } from 'react-i18next';
import { TerminalView } from './TerminalView';
import { Terminal, Plus } from 'lucide-react';

export function TerminalPanel() {
  const { t } = useTranslation();
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const addSession = useTerminalStore((s) => s.addSession);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeSession = useTerminalStore((s) => s.closeSession);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#0d1117]">
      <div className="flex items-center gap-0.5 h-[36px] shrink-0 px-2 border-b border-[#ffffff14] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-1.5 h-[26px] px-2.5 rounded-[6px] text-[11px] font-mono cursor-pointer whitespace-nowrap shrink-0 transition-colors duration-150 select-none ${
              s.id === activeId
                ? 'bg-[#ffffff14] text-[#e6edf3]'
                : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#ffffff0a]'
            }`}
            onClick={() => setActive(s.id)}
          >
            <Terminal size={11} className={s.id === activeId ? 'text-[#79c0ff] shrink-0' : 'opacity-60 shrink-0'} />
            <span className={`max-w-[120px] overflow-hidden text-ellipsis ${s.status === 'exited' ? 'opacity-50' : ''}`}>{s.title}</span>
            {s.status === 'exited' && (
              <button
                className="shrink-0 w-[15px] h-[15px] flex items-center justify-center rounded-[3px] text-[#8b949e] hover:bg-[#ffffff14] hover:text-[#e6edf3] border-none bg-transparent cursor-pointer"
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
              className="opacity-0 group-hover:opacity-100 shrink-0 w-[15px] h-[15px] flex items-center justify-center rounded-[3px] text-[#8b949e] hover:bg-[#ffffff14] hover:text-[#ff7b72] border-none bg-transparent cursor-pointer"
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
          className="shrink-0 w-[24px] h-[24px] flex items-center justify-center rounded-[5px] text-[#8b949e] border-none bg-transparent cursor-pointer transition-colors duration-150 hover:bg-[#ffffff0a] hover:text-[#e6edf3]"
          title={t('terminal:new')}
          onClick={addSession}
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {sessions.map((s) => (
          <TerminalView key={s.id} id={s.id} active={s.id === activeId} />
        ))}
        {sessions.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d1117]">
            <div className="w-[44px] h-[44px] rounded-[10px] bg-[#ffffff0a] border border-[#ffffff14] flex items-center justify-center">
              <Terminal size={18} className="text-[#8b949e]" />
            </div>
            <span className="text-xs text-[#8b949e]">{t('terminal:empty')}</span>
            <button
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] bg-[#238636] text-white text-xs border-none cursor-pointer transition-opacity hover:opacity-90 font-medium"
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
