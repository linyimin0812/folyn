import { useScheduleStore } from '@/store/scheduleStore';
import { dateToString } from '@/schedule/dailyScan';
import { useBoardColumns } from '@/schedule/columns';
import { TASK_CATEGORY_LABEL } from '@/schedule/types';

export function TodayTaskList() {
  const tasks = useScheduleStore((s) => s.tasks);
  const toggleTask = useScheduleStore((s) => s.toggleTask);
  const { labelOf } = useBoardColumns();
  const today = dateToString(new Date());

  // 今日任务：截止今日 / 排程今日 / 创建于今日，且未完成优先
  const todays = tasks
    .filter((t) => t.noteDate === today || t.scheduledDate === today || t.due === today.slice(5))
    .slice(0, 6);
  const done = tasks.filter((t) => t.done).length;

  return (
    <div className="sw-rail-block">
      <p className="sw-section-label">
        今日任务
        <span style={{ color: 'var(--muted)', float: 'right' }}>{done}/{tasks.length}</span>
      </p>
      <ul className="sw-task-list">
        {todays.map((t) => (
          <li
            key={t.id}
            className={`sw-task${t.done ? ' done' : ''}`}
            onClick={() => toggleTask(t.id)}
          >
            <span className="sw-check">✓</span>
            <span>
              <span className="sw-body">
                {t.title}
                <span className="sw-src">{TASK_CATEGORY_LABEL[t.category]}</span>
              </span>
              <span className="sw-meta">{t.due ? `截止 ${t.due} · ` : ''}{labelOf(t.column)}</span>
            </span>
            <span className={`sw-prio ${t.priority}`} />
          </li>
        ))}
        {todays.length === 0 && (
          <li style={{ color: 'var(--muted)', fontSize: '12px', padding: '8px' }}>今日暂无任务</li>
        )}
      </ul>
    </div>
  );
}
