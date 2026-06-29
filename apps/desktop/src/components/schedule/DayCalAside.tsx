import { useState } from 'react';
import { useScheduleStore } from '@/store/scheduleStore';
import { sameDay } from '@/schedule/dailyScan';
import { dueState } from '@/schedule/markdown';
import { hasDragPayload, readDragPayload } from '@/schedule/dnd';

const DOW = ['一', '二', '三', '四', '五', '六', '日'];

interface Props {
  anchorDate: Date;
  onSelect: (d: Date) => void;
}

export function DayCalAside({ anchorDate, onSelect }: Props) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [cursor, setCursor] = useState(() => new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1));
  const tasks = useScheduleStore((s) => s.tasks);
  const setTaskDue = useScheduleStore((s) => s.setTaskDue);

  // 当月有逾期任务的日期集合（MM-DD）
  const overdueDues = new Set(
    tasks.filter((t) => !t.done && t.due && dueState(t.due) === 'over').map((t) => t.due!),
  );

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const toMmDd = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const total = startPad + daysInMonth;
  const trail = (7 - (total % 7)) % 7;
  for (let i = 1; i <= trail; i++) cells.push(null);

  const shift = (n: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));

  return (
    <aside className="sw-board-daycal">
      <div className="sw-daycal-head">
        <span className="sw-daycal-month">{y} 年 {m + 1} 月</span>
        <div className="sw-daycal-nav">
          <button onClick={() => shift(-1)} aria-label="上月">‹</button>
          <button onClick={() => { const t = new Date(); t.setHours(0, 0, 0, 0); setCursor(new Date(t.getFullYear(), t.getMonth(), 1)); onSelect(t); }} aria-label="回到今天">·</button>
          <button onClick={() => shift(1)} aria-label="下月">›</button>
        </div>
      </div>
      <div className="sw-daycal-grid">
        {DOW.map((d) => <div key={d} className="sw-dow">{d}</div>)}
        {cells.map((day, idx) => {
          if (day === null) {
            const isPrev = idx < startPad;
            const num = isPrev ? prevDays - startPad + idx + 1 : idx - total + 1;
            return <div key={`e-${idx}`} className="sw-d muted">{num}</div>;
          }
          const dd = new Date(y, m, day);
          const cls = ['sw-d'];
          if (sameDay(dd, today)) cls.push('today');
          if (sameDay(dd, anchorDate)) cls.push('selected');
          if (overdueDues.has(toMmDd(dd))) cls.push('has-over');
          return (
            <div
              key={day}
              className={cls.join(' ')}
              onClick={() => onSelect(dd)}
              onDragOver={(e) => {
                if (!hasDragPayload(e)) return;
                e.preventDefault();
                (e.currentTarget as HTMLElement).classList.add('cal-drop-target');
              }}
              onDragLeave={(e) => (e.currentTarget as HTMLElement).classList.remove('cal-drop-target')}
              onDrop={(e) => {
                const p = readDragPayload(e);
                if (!p) return;
                e.preventDefault();
                (e.currentTarget as HTMLElement).classList.remove('cal-drop-target');
                // 看板日历只接受任务（设截止日）；事件拖到此忽略
                if (p.kind === 'task' && p.id) {
                  setTaskDue(p.id, toMmDd(dd));
                  onSelect(dd);
                }
              }}
            >
              {day}
            </div>
          );
        })}
      </div>
      <div className="sw-daycal-legend">
        <div><span className="sw-lg-dot" style={{ background: 'var(--acc)' }} />选中日</div>
        <div><span className="sw-lg-dot" style={{ background: 'var(--green)' }} />今日</div>
        <div><span className="sw-lg-dot" style={{ background: 'var(--red)' }} />有逾期</div>
      </div>
    </aside>
  );
}
