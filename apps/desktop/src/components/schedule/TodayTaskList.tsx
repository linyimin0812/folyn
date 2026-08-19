import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';
import { dateToString } from '@/features/schedule/dailyScan';
import { useBoardColumns } from '@/features/schedule/columns';

export function TodayTaskList() {
  const { t } = useTranslation();
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
        {t('schedule:todayTaskList.title')}
        <span style={{ color: 'var(--muted)', float: 'right' }}>{done}/{tasks.length}</span>
      </p>
      <ul className="sw-task-list">
        {todays.map((task) => (
          <li
            key={task.id}
            className={`sw-task${task.done ? ' done' : ''}`}
            onClick={() => toggleTask(task.id)}
          >
            <span className="sw-check">✓</span>
            <span>
              <span className="sw-body">{task.title}</span>
              <span className="sw-meta">
                <span className="sw-src">{t(`schedule:category.task.${task.category}`)}</span>
                {task.due ? t('schedule:todayTaskList.duePrefix', { due: task.due }) : ''}{labelOf(task.column)}
              </span>
            </span>
            <span className={`sw-prio ${task.priority}`} />
          </li>
        ))}
        {todays.length === 0 && (
          <li style={{ color: 'var(--muted)', fontSize: '12px', padding: '8px' }}>{t('schedule:todayTaskList.empty')}</li>
        )}
      </ul>
    </div>
  );
}
