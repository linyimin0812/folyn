import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';

export function WeeklyStats() {
  const { t } = useTranslation();
  const events = useScheduleStore((s) => s.events);
  const tasks = useScheduleStore((s) => s.tasks);
  return (
    <div className="sw-rail-block">
      <p className="sw-section-label">{t('schedule:calendarCategory.week')}</p>
      <div className="sw-stat-row">
        <div className="sw-stat-card accent">
          <div className="sw-v">{events.length}</div>
          <div className="sw-l">{t('schedule:calendarCategory.totalEvents')}</div>
        </div>
        <div className="sw-stat-card">
          <div className="sw-v">{tasks.filter((t) => !t.done).length}</div>
          <div className="sw-l">{t('schedule:calendarCategory.incompleteTasks')}</div>
        </div>
      </div>
    </div>
  );
}
