import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';
import { dateToString } from '@/features/schedule/dailyScan';
import { formatTime } from '@/features/schedule/markdown';
import { useBoardColumns } from '@/features/schedule/columns';
import type { Priority, TaskCategory, TaskColumn } from '@/features/schedule/types';

export type ModalIntent =
  | { kind: 'event'; day: string; hour: number }
  | { kind: 'task'; col: TaskColumn }
  | { kind: 'eventDetail'; eventId: string }
  | { kind: 'taskDetail'; taskId: string };

interface Props {
  intent: ModalIntent;
  onClose: () => void;
}

const TASK_CATS: TaskCategory[] = ['design', 'dev', 'bug', 'growth', 'ops', 'learn'];
const PRIOS: Priority[] = ['high', 'med', 'low'];

/** "HH:MM" → 小时浮点。 */
function toH(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h + (m || 0) / 60;
}

export function ScheduleModal({ intent, onClose }: Props) {
  const { t } = useTranslation();
  const addEvent = useScheduleStore((s) => s.addEvent);
  const addTask = useScheduleStore((s) => s.addTask);
  const updateEvent = useScheduleStore((s) => s.updateEvent);
  const updateTask = useScheduleStore((s) => s.updateTask);
  const deleteEvent = useScheduleStore((s) => s.deleteEvent);
  const unscheduleTask = useScheduleStore((s) => s.unscheduleTask);
  const { columns: boardColumns, doneId } = useBoardColumns();

  const event = useScheduleStore((s) =>
    intent.kind === 'eventDetail' ? s.events.find((e) => e.id === intent.eventId) : undefined,
  );
  const task = useScheduleStore((s) =>
    intent.kind === 'taskDetail' ? s.tasks.find((t) => t.id === intent.taskId) : undefined,
  );

  const isEdit = intent.kind === 'eventDetail' || intent.kind === 'taskDetail';
  const editingEvent = event;
  const editingTask = task;

  const initialType: 'event' | 'task' =
    intent.kind === 'event' || intent.kind === 'eventDetail' ? 'event' : 'task';
  const initialTitle = editingEvent?.title ?? editingTask?.title ?? '';
  const initialDesc = editingEvent?.note ?? '';
  const initialStart = (() => {
    if (intent.kind === 'event') return formatTime(intent.hour);
    if (editingEvent?.start != null) return formatTime(editingEvent.start);
    if (editingTask?.scheduledStart != null) return formatTime(editingTask.scheduledStart);
    return '09:00';
  })();
  const initialEnd = (() => {
    if (intent.kind === 'event') return formatTime(intent.hour + 1);
    if (editingEvent?.end != null) return formatTime(editingEvent.end);
    if (editingTask?.scheduledEnd != null) return formatTime(editingTask.scheduledEnd);
    return '10:00';
  })();
  const initialCol: TaskColumn =
    intent.kind === 'task' ? intent.col : (editingTask?.column ?? 'todo');
  const initialCat: TaskCategory = editingTask?.category ?? 'design';
  const initialPrio: Priority = editingTask?.priority ?? 'med';

  const [type, setType] = useState<'event' | 'task'>(initialType);
  const [title, setTitle] = useState(initialTitle);
  const [desc, setDesc] = useState(initialDesc);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [col, setCol] = useState<TaskColumn>(initialCol);
  const [cat, setCat] = useState<TaskCategory>(initialCat);
  const [prio, setPrio] = useState<Priority>(initialPrio);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.getElementById('sw-modal-title-input') as HTMLInputElement | null;
      el?.focus();
      if (isEdit) el?.select();
    }, 50);
    return () => clearTimeout(t);
  }, [isEdit]);

  const day = intent.kind === 'event' ? intent.day : dateToString(new Date());

  const save = async () => {
    if (saving) return;
    if (!title.trim()) {
      useScheduleStore.getState().toast(t('schedule:modal.toastTitleRequired'));
      return;
    }
    setSaving(true);
    try {
      if (type === 'event') {
      const s = toH(start);
      const e = toH(end);
      if (e <= s) {
        useScheduleStore.getState().toast(t('schedule:modal.toastEndAfterStart'));
        return;
      }
      if (isEdit && editingEvent) {
        await updateEvent(editingEvent.id, {
          title: title.trim(),
          start: s,
          end: e,
          note: desc.trim() || undefined,
        });
      } else {
        await addEvent(day, {
          start: s,
          end: e,
          title: title.trim(),
          note: desc.trim() || undefined,
        });
      }
      } else {
      if (isEdit && editingTask) {
        const s = toH(start);
        const e = toH(end);
        if (e <= s) {
          useScheduleStore.getState().toast(t('schedule:modal.toastEndAfterStart'));
          return;
        }
        await updateTask(editingTask.id, {
          title: title.trim(),
          scheduledStart: s,
          scheduledEnd: e,
          category: cat,
          column: col,
          priority: prio,
        });
      } else {
        await addTask(day, {
          title: title.trim(),
          column: col,
          category: cat,
          priority: prio,
          due: undefined,
          progress: col === doneId ? 100 : 0,
          subtasks: 0,
          assignees: ['YL'],
        });
      }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sw-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sw-modal" role="dialog" aria-modal="true">
        <h3>{isEdit ? t('schedule:modal.titleEdit', { kind: type === 'event' ? t('schedule:modal.kindEvent') : t('schedule:modal.kindTask') }) : t('schedule:modal.titleNew', { kind: type === 'event' ? t('schedule:modal.kindEvent') : t('schedule:modal.kindTask') })}</h3>

        <div className="sw-field">
          <label>{t('schedule:modal.typeLabel')}</label>
          <div className="sw-seg-inline">
            {(['event', 'task'] as const).map((kind) => (
              <label key={kind}>
                <input
                  type="radio"
                  name="sw-type"
                  checked={type === kind}
                  onChange={() => setType(kind)}
                  disabled={isEdit}
                />
                <span>{kind === 'event' ? t('schedule:modal.typeEvent') : t('schedule:modal.typeTask')}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="sw-field">
          <label>{t('schedule:modal.titleLabel')}</label>
          <input
            id="sw-modal-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('schedule:modal.titlePlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          />
        </div>

        <div className="sw-field">
          <label>{t('schedule:modal.descLabel')}</label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={t('schedule:modal.descPlaceholder')}
          />
        </div>

        {type === 'event' && (
          <div className="sw-row2">
            <div className="sw-field">
              <label>{t('schedule:modal.start')}</label>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="sw-field">
              <label>{t('schedule:modal.end')}</label>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        )}

        {type === 'task' && (
          <>
            <div className="sw-field">
              <label>{t('schedule:modal.column')}</label>
              <select
                value={col}
                onChange={(e) => setCol(e.target.value as TaskColumn)}
              >
                {boardColumns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.isDone ? t('schedule:modal.columnDoneSuffix') : ''}</option>
                ))}
              </select>
            </div>
            <div className="sw-field">
              <label>{t('schedule:modal.category')}</label>
              <div className="sw-seg-inline">
                {TASK_CATS.map((c) => (
                  <label key={c}>
                    <input
                      type="radio"
                      name="sw-cat"
                      checked={cat === c}
                      onChange={() => setCat(c)}
                    />
                    <span>{t(`schedule:category.task.${c}`)}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="sw-field">
          <label>{t('schedule:modal.priority')}</label>
          <div className="sw-seg-inline">
            {PRIOS.map((p) => (
              <label key={p}>
                <input
                  type="radio"
                  name="sw-prio"
                  checked={prio === p}
                  onChange={() => setPrio(p)}
                />
                <span>{p === 'high' ? t('schedule:modal.priorityHigh') : p === 'med' ? t('schedule:modal.priorityMed') : t('schedule:modal.priorityLow')}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="sw-actions">
          <button className="sw-btn sw-btn-ghost" onClick={onClose} disabled={saving}>{isEdit ? t('schedule:modal.close') : t('schedule:modal.cancel')}</button>
          <button className="sw-btn sw-btn-primary" onClick={save} disabled={saving}>{isEdit ? t('schedule:modal.save') : t('schedule:modal.create')}</button>
          {isEdit && (
            type === 'event' ? (
              <button
                className="sw-btn sw-btn-danger"
                onClick={async () => { if (editingEvent) await deleteEvent(editingEvent.id); onClose(); }}
              >
                {t('schedule:modal.delete')}
              </button>
            ) : (
              <button
                className="sw-btn sw-btn-danger"
                onClick={async () => { if (editingTask) await unscheduleTask(editingTask.id); onClose(); }}
              >
                {t('schedule:modal.unschedule')}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
