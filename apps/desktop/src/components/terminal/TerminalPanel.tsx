import { useTerminalStore } from '@/store/terminalStore';
import { useTranslation } from 'react-i18next';
import { TerminalView } from './TerminalView';
import { Terminal, Plus } from 'lucide-react';

/** Terminal body only — session tabs live in the right-dock header row. */
export function TerminalPanel() {
  const { t } = useTranslation();
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const addSession = useTerminalStore((s) => s.addSession);

  return (
    <div className="flex-1 min-h-0 relative bg-bg">
      {sessions.map((s) => (
        <TerminalView key={s.id} id={s.id} active={s.id === activeId} />
      ))}
      {sessions.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg">
          <div className="w-[44px] h-[44px] rounded-[10px] bg-hov border border-brd flex items-center justify-center">
            <Terminal size={18} className="text-t3" />
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
  );
}
