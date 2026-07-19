import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';
import type { EventCategory } from '@/features/schedule/types';

const CATS: { key: EventCategory; color: string }[] = [
  { key: 'work', color: 'var(--cal-work)' },
  { key: 'personal', color: 'var(--cal-personal)' },
  { key: 'family', color: 'var(--cal-family)' },
  { key: 'health', color: 'var(--cal-health)' },
  { key: 'task', color: 'var(--cal-task)' },
];

export function CalendarCategoryList() {
  const { t } = useTranslation();
  const filter = useScheduleStore((s) => s.calendarFilter);
  const setFilter = useScheduleStore((s) => s.setCalendarFilter);
  const events = useScheduleStore((s) => s.events);
  const tasks = useScheduleStore((s) => s.tasks);

  const count = (k: EventCategory) => {
    if (k === 'task') return tasks.filter((t) => t.scheduledDate && !t.done).length;
    return events.filter((e) => e.category === k).length;
  };

  return (
    <div className="sw-rail-block">
      <p className="sw-section-label">{t('schedule:calendarCategory.calendar')}</p>
      <div className="sw-cal-list">
        {CATS.map((c) => (
          <div
            key={c.key}
            className={`sw-cal-item ${filter[c.key] ? '' : 'off'}`}
            onClick={() => setFilter(c.key, !filter[c.key])}
          >
            <span className="sw-cal-swatch" style={{ background: c.color }} />
            {t(`schedule:category.event.${c.key}`)}
            <span className="sw-count">{count(c.key)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
