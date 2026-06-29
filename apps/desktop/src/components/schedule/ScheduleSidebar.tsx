import type { WorkbenchView } from './ScheduleWorkbenchPage';

interface Props {
  view: WorkbenchView;
  onSwitchView: (v: WorkbenchView) => void;
  onNew: () => void;
  onPlanMyDay?: () => void;
}

export function ScheduleSidebar({ view, onSwitchView, onNew, onPlanMyDay }: Props) {
  return (
    <aside className="sw-sidebar">
      <div className="sw-panel-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        <span>日程工作台</span>
        <button className="sw-add-btn" onClick={onNew} title="新建">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>

      <div className="sw-nav-group">
        <button type="button" className={`sw-nav-item ${view === 'schedule' ? 'active' : ''}`} onClick={() => onSwitchView('schedule')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          <span>日程</span>
        </button>
        <button type="button" className={`sw-nav-item ${view === 'board' ? 'active' : ''}`} onClick={() => onSwitchView('board')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="6" height="18" rx="1" /><rect x="10" y="3" width="6" height="12" rx="1" /><rect x="17" y="3" width="4" height="8" rx="1" /></svg>
          <span>任务看板</span>
        </button>
      </div>

      <div className="sw-nav-group">
        <button type="button" className="sw-plan-trigger" onClick={onPlanMyDay} title="AI 规划今日 (⌘P)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M13.5 8.5a5.5 5.5 0 01-6-6 5.5 5.5 0 106 6z" /></svg>
          <span>AI 规划今日</span>
        </button>
      </div>

    </aside>
  );
}
