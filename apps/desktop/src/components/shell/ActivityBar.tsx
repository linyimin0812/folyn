import { useSettingsStore } from '@/store/settingsStore';

export type ActivityPanel = 'files' | 'wiki' | 'clips' | 'analyze' | 'calendar';

interface ActivityBarProps {
  activePanel: ActivityPanel;
  onPanelChange: (panel: ActivityPanel) => void;
}

export function ActivityBar({ activePanel, onPanelChange }: ActivityBarProps) {
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage);
  const currentPage = useSettingsStore((s) => s.currentPage);
  const enableWikiPanel = useSettingsStore((s) => s.enableWikiPanel);
  const enableClipsPanel = useSettingsStore((s) => s.enableClipsPanel);
  const enableAnalyzePanel = useSettingsStore((s) => s.enableAnalyzePanel);
  const enableDailyPanel = useSettingsStore((s) => s.enableDailyPanel);
  const onSchedule = currentPage === 'schedule';
  const onStudy = currentPage === 'study';
  const onPage = onSchedule || onStudy;

  return (
    <div className="activity-bar">
      <button
        className={`activity-icon ${!onPage && activePanel === 'files' ? 'active' : ''}`}
        onClick={() => onPanelChange('files')}
        title="文件"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 7V17a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </button>

      {enableWikiPanel && (
        <button
          className={`activity-icon ${!onPage && activePanel === 'wiki' ? 'active' : ''}`}
          onClick={() => onPanelChange('wiki')}
          title="Wiki"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </button>
      )}

      {enableClipsPanel && (
        <button
          className={`activity-icon ${!onPage && activePanel === 'clips' ? 'active' : ''}`}
          onClick={() => onPanelChange('clips')}
          title="Clips"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M5 3v18l7-4 7 4V3H5z" />
          </svg>
        </button>
      )}

      {enableAnalyzePanel && (
        <button
          className={`activity-icon ${!onPage && activePanel === 'analyze' ? 'active' : ''}`}
          onClick={() => onPanelChange('analyze')}
          title="项目分析"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M21 21H4.6c-.56 0-.84 0-1.054-.109a1 1 0 01-.437-.437C3 20.24 3 19.96 3 19.4V3" />
            <path d="M7 14l4-4 4 4 6-6" />
          </svg>
        </button>
      )}

      {enableDailyPanel && (
        <button
          className={`activity-icon ${onSchedule ? 'active' : ''}`}
          onClick={() => setCurrentPage('schedule')}
          title="日程工作台 (⌘D)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      )}

      <button
        className={`activity-icon ${onStudy ? 'active' : ''}`}
        onClick={() => setCurrentPage('study')}
        title="学习工作台"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 10L12 5 2 10l10 5 10-5z" />
          <path d="M6 12v5c0 1 2.5 3 6 3s6-2 6-3v-5" />
        </svg>
      </button>

      <div className="flex-1" />

      <button
        className="activity-icon"
        onClick={() => setCurrentPage('settings')}
        title="设置"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}
