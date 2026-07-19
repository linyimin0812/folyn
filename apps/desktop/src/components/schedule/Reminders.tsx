import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';
import { startOfWeek, addDays, sameDay } from '@/features/schedule/dailyScan';
import { formatTime } from '@/features/schedule/markdown';
import { getColumnLabel } from '@/features/schedule/columns';

export function Reminders() {
  const { t } = useTranslation();
  const events = useScheduleStore((s) => s.events);
  const tasks = useScheduleStore((s) => s.tasks);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ws = startOfWeek(today);
  const dowArr = t('schedule:weekGrid.dow', { returnObjects: true }) as string[];

  const items = useMemo(() => {
    const ev = events
      .filter((e) => {
        const d = new Date(e.noteDate + 'T00:00:00');
        return sameDay(d, today) || (d > today && d < addDays(ws, 7));
      })
      .slice(0, 2)
      .map((e) => ({
        time: dowArr[(new Date(e.noteDate + 'T00:00:00').getDay() + 6) % 7] + ' ' + formatTime(e.start),
        body: `<b>${escapeHtml(e.title)}</b>${e.note ? ' · ' + escapeHtml(e.note) : ''}`,
      }));
    const tk = tasks
      .filter((t) => !t.done && t.due)
      .slice(0, 3)
      .map((task) => ({
        time: task.due!,
        body: t('schedule:reminders.dueBody', { title: escapeHtml(task.title), column: escapeHtml(getColumnLabel(task.column)) }),
      }));
    return [...ev, ...tk];
  }, [events, tasks, today, ws, t, dowArr]);

  return (
    <div className="sw-rail-block">
      <p className="sw-section-label">{t('schedule:reminders.upcoming')}</p>
      <div>
        {items.length === 0 ? (
          <div className="sw-reminder">
            <span className="sw-rtime">—</span>
            <span className="sw-rbody">{t('schedule:reminders.empty')}</span>
          </div>
        ) : (
          items.map((r, i) => (
            <div key={i} className="sw-reminder">
              <span className="sw-rtime">{r.time}</span>
              <span className="sw-rbody" dangerouslySetInnerHTML={{ __html: r.body }} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
