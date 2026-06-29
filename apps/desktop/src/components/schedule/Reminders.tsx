import { useMemo } from 'react';
import { useScheduleStore } from '@/store/scheduleStore';
import { startOfWeek, addDays, sameDay } from '@/schedule/dailyScan';
import { formatTime } from '@/schedule/markdown';
import { getColumnLabel } from '@/schedule/columns';

const DOW_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function Reminders() {
  const events = useScheduleStore((s) => s.events);
  const tasks = useScheduleStore((s) => s.tasks);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ws = startOfWeek(today);

  const items = useMemo(() => {
    const ev = events
      .filter((e) => {
        const d = new Date(e.noteDate + 'T00:00:00');
        return sameDay(d, today) || (d > today && d < addDays(ws, 7));
      })
      .slice(0, 2)
      .map((e) => ({
        time: DOW_CN[(new Date(e.noteDate + 'T00:00:00').getDay() + 6) % 7] + ' ' + formatTime(e.start),
        body: `<b>${escapeHtml(e.title)}</b>${e.note ? ' · ' + escapeHtml(e.note) : ''}`,
      }));
    const tk = tasks
      .filter((t) => !t.done && t.due)
      .slice(0, 3)
      .map((t) => ({
        time: t.due!,
        body: `<b>${escapeHtml(t.title)}</b> · 截止 · ${escapeHtml(getColumnLabel(t.column))}`,
      }));
    return [...ev, ...tk];
  }, [events, tasks, today, ws]);

  return (
    <div className="sw-rail-block">
      <p className="sw-section-label">即将到来</p>
      <div>
        {items.length === 0 ? (
          <div className="sw-reminder">
            <span className="sw-rtime">—</span>
            <span className="sw-rbody">暂无即将到来的事项</span>
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
