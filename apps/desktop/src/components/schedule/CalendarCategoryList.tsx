import { useScheduleStore } from '@/store/scheduleStore';
import type { EventCategory } from '@/features/schedule/types';
import { EVENT_CATEGORY_LABEL } from '@/features/schedule/types';

const CATS: { key: EventCategory; color: string }[] = [
  { key: 'work', color: 'var(--cal-work)' },
  { key: 'personal', color: 'var(--cal-personal)' },
  { key: 'family', color: 'var(--cal-family)' },
  { key: 'health', color: 'var(--cal-health)' },
  { key: 'task', color: 'var(--cal-task)' },
];

export function CalendarCategoryList() {
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
      <p className="sw-section-label">日历</p>
      <div className="sw-cal-list">
        {CATS.map((c) => (
          <div
            key={c.key}
            className={`sw-cal-item ${filter[c.key] ? '' : 'off'}`}
            onClick={() => setFilter(c.key, !filter[c.key])}
          >
            <span className="sw-cal-swatch" style={{ background: c.color }} />
            {EVENT_CATEGORY_LABEL[c.key]}
            <span className="sw-count">{count(c.key)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeeklyStats() {
  const events = useScheduleStore((s) => s.events);
  const tasks = useScheduleStore((s) => s.tasks);
  return (
    <div className="sw-rail-block">
      <p className="sw-section-label">本周</p>
      <div className="sw-stat-row">
        <div className="sw-stat-card accent">
          <div className="sw-v">{events.length}</div>
          <div className="sw-l">事件总数</div>
        </div>
        <div className="sw-stat-card">
          <div className="sw-v">{tasks.filter((t) => !t.done).length}</div>
          <div className="sw-l">未完成任务</div>
        </div>
      </div>
    </div>
  );
}
