import { useTranslation } from 'react-i18next';
import type { WorkbenchView } from './ScheduleWorkbenchPage';

interface Props {
  view: WorkbenchView;
  onSwitchView: (v: WorkbenchView) => void;
  onNew: () => void;
}

export function ScheduleSidebar({ view, onSwitchView, onNew }: Props) {
  const { t } = useTranslation();
  return (
    <aside className="sw-sidebar">
      <div className="sw-panel-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        <span>{t('schedule:title')}</span>
        <button className="sw-add-btn" onClick={onNew} title={t('schedule:new')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>

      <div className="sw-nav-group">
        <button type="button" className={`sw-nav-item ${view === 'schedule' ? 'active' : ''}`} onClick={() => onSwitchView('schedule')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          <span>{t('schedule:views.schedule')}</span>
        </button>
        <button type="button" className={`sw-nav-item ${view === 'board' ? 'active' : ''}`} onClick={() => onSwitchView('board')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="6" height="18" rx="1" /><rect x="10" y="3" width="6" height="12" rx="1" /><rect x="17" y="3" width="4" height="8" rx="1" /></svg>
          <span>{t('schedule:views.board')}</span>
        </button>
      </div>

    </aside>
  );
}
