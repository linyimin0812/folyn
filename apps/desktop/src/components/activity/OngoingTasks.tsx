/**
 * Ongoing-tasks module (design §4.4/§7.1): schedule-window task entities from
 * `activity_daily_digest_input.ongoingTasks`, rendered as "第 X/Y 天" progress
 * bars. Shown only while browsing the current period (parent hides it).
 */

import { useTranslation } from 'react-i18next';
import type { ActivityEntityRow } from '@/services/activity/api';
import { taskDayProgress } from './period';

interface OngoingTasksProps {
  tasks: ActivityEntityRow[];
}

interface TaskMeta {
  status?: unknown;
  progressNote?: unknown;
  startDate?: unknown;
  dueDate?: unknown;
}

export function OngoingTasks({ tasks }: OngoingTasksProps) {
  const { t } = useTranslation();
  if (tasks.length === 0) return null;
  const today = new Date();

  return (
    <div className="mb-6">
      <p className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 m-0 mb-3">
        {t('activity:ongoing.title')}
      </p>
      {tasks.map((task) => {
        const meta = (task.metadata ?? {}) as TaskMeta;
        const startDate = typeof meta.startDate === 'number' ? meta.startDate : null;
        const dueDate = typeof meta.dueDate === 'number' ? meta.dueDate : null;
        const name = task.displayName || task.identityKey;
        const note =
          typeof meta.progressNote === 'string' && meta.progressNote
            ? meta.progressNote
            : t('activity:ongoing.noUpdate');
        const pct =
          startDate != null && dueDate != null && dueDate > startDate
            ? Math.round((((today.getTime() - startDate) / (dueDate - startDate)) * 100))
            : 0;
        const clampedPct = Math.min(100, Math.max(0, pct));
        return (
          <div key={task.id} className="border border-brd rounded-lg p-3.5 mb-3 bg-panel">
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <p className="m-0 text-[length:calc(var(--ui-font-size)+1px)] text-t1 truncate">{name}</p>
              {startDate != null && dueDate != null && (
                <p className="m-0 text-[12px] text-t3 whitespace-nowrap">
                  {(() => {
                    const { current, total } = taskDayProgress(startDate, dueDate, today);
                    return t('activity:ongoing.dayN', { current, total });
                  })()}
                </p>
              )}
            </div>
            <div className="h-1.5 rounded bg-surf2 overflow-hidden mb-2">
              <div className="h-full bg-acc" style={{ width: `${clampedPct}%` }} />
            </div>
            <p className="m-0 text-[12px] text-t3 truncate" title={note}>
              {note}
            </p>
          </div>
        );
      })}
    </div>
  );
}
