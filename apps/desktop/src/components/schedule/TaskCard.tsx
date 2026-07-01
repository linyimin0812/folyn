import { useState } from 'react';
import { useScheduleStore } from '@/store/scheduleStore';
import { dueState } from '@/features/schedule/markdown';
import { TASK_CATEGORY_LABEL } from '@/features/schedule/types';
import type { ScheduleTask } from '@/features/schedule/types';

export function TaskCard({ task }: { task: ScheduleTask }) {
  const [dragging, setDragging] = useState(false);
  const toast = useScheduleStore((s) => s.toast);

  const ds = dueState(task.due);
  const dueClass = ds === 'over' ? 'due-over' : ds === 'soon' ? 'due-soon' : '';
  const showProgress = task.column === 'doing' || task.column === 'review';

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
      <div className="sw-card-top">
        <span className={`sw-tag ${task.category}`}>{TASK_CATEGORY_LABEL[task.category]}</span>
        <span className={`sw-prio ${task.priority}`} title="优先级" />
      </div>
      <h4>{task.title}</h4>
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
              已排程
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {showProgress && (
            <div className="sw-progress">
              <div className="sw-bar"><i style={{ width: `${task.progress}%` }} /></div>
              <span className="sw-pct">{task.progress}%</span>
            </div>
          )}
          <div className="sw-sub-avatars">
            {task.assignees.map((a) => (
              <div key={a} className="sw-card-av" title={a}>{a}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
