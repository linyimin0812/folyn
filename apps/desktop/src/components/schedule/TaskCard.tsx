import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';
import { dueState } from '@/features/schedule/markdown';
import type { ScheduleTask } from '@/features/schedule/types';

export function TaskCard({ task }: { task: ScheduleTask }) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const toast = useScheduleStore((s) => s.toast);
  const deleteTask = useScheduleStore((s) => s.deleteTask);

  const ds = dueState(task.due);
  const dueClass = ds === 'over' ? 'due-over' : ds === 'soon' ? 'due-soon' : '';
  const showProgress = task.column === 'doing' || task.column === 'review';
  const hasMeta = Boolean(task.due) || task.subtasks > 0 || Boolean(task.scheduledDate);

  return (
    <div
      className={`sw-card${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.setData('application/x-task', task.id);
        setDragging(true);
      }}
      onDragEnd={() => {
        setDragging(false);
        document.querySelectorAll('.sw-col-body').forEach((b) => b.classList.remove('drop-target'));
        document.querySelectorAll('.sw-daycal-grid .sw-d').forEach((b) => b.classList.remove('cal-drop-target'));
      }}
      onClick={() => { if (!dragging) toast(`「${task.title}」`); }}
    >
      <button
        className="sw-card-del"
        title={t('schedule:taskCard.delete')}
        onClick={(e) => { e.stopPropagation(); void deleteTask(task.id); }}
      >✕</button>
      <div className="sw-card-top">
        <span className={`sw-prio ${task.priority}`} title={t('schedule:taskCard.priorityTitle')} />
        <span className={`sw-tag ${task.category}`}>{t(`schedule:category.task.${task.category}`)}</span>
      </div>
      <h4>{task.title}</h4>
      {(hasMeta || showProgress) && (
        <div className="sw-card-foot">
          <div className="sw-card-meta">
            {task.due && (
              <span className={`sw-chip ${dueClass}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                {task.due}
              </span>
            )}
            {task.subtasks > 0 && (
              <span className="sw-chip">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                {task.subtasks}
              </span>
            )}
            {task.scheduledDate && (
              <span className="sw-chip">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                {t('schedule:taskCard.scheduled')}
              </span>
            )}
          </div>
          {showProgress && (
            <div className="sw-progress">
              <div className="sw-bar"><i style={{ width: `${task.progress}%` }} /></div>
              <span className="sw-pct">{task.progress}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
