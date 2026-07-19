import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';
import { setDragPayload } from '@/features/schedule/dnd';
import type { TaskCategory } from '@/features/schedule/types';

export function UnschedDock() {
  const { t } = useTranslation();
  const tasks = useScheduleStore((s) => s.tasks);
  const list = tasks
    .filter((t) => !t.done && !t.scheduledDate)
    .sort((a, b) => {
      if (a.noteDate !== b.noteDate) return a.noteDate < b.noteDate ? 1 : -1;
      return b.lineIndex - a.lineIndex;
    });

  return (
    <div className="sw-rail-block">
      <p className="sw-section-label">
        {t('schedule:unschedDock.title')}
        <span style={{ color: 'var(--muted)', float: 'right', fontFamily: 'var(--font-mono)' }}>{list.length}</span>
      </p>
      <div className="sw-unsched-dock">
        {list.length === 0 ? (
          <div className="sw-dock-empty">{t('schedule:unschedDock.allDone')}</div>
        ) : (
          list.map((t) => <DockChip key={t.id} taskId={t.id} title={t.title} prio={t.priority} cat={t.category} />)
        )}
      </div>
      <p className="sw-section-hint">{t('schedule:unschedDock.hint')}</p>
    </div>
  );
}

function DockChip({ taskId, title, prio, cat }: { taskId: string; title: string; prio: 'high' | 'med' | 'low'; cat: TaskCategory }) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`sw-dock-chip${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        setDragPayload(e, { kind: 'task', id: taskId });
        setDragging(true);
      }}
      onDragEnd={() => {
        setDragging(false);
        document.querySelectorAll('.sw-day-col.drop-target, .sw-slot.drop-target').forEach((s) => s.classList.remove('drop-target'));
      }}
      onClick={() => useScheduleStore.getState().toast(t('schedule:unschedDock.dragToast'))}
    >
      <span className={`sw-prio ${prio}`} />
      <span className="sw-label">{title}</span>
      <span className="sw-cat">{t(`schedule:category.task.${cat}`)}</span>
      <button
        className="sw-dock-del"
        onClick={(e) => {
          e.stopPropagation();
          void useScheduleStore.getState().deleteTask(taskId);
        }}
        aria-label={t('schedule:unschedDock.delete')}
        type="button"
      >
        ✕
      </button>
    </div>
  );
}
