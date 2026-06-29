import { useState, useEffect } from 'react';
import { useScheduleStore } from '@/store/scheduleStore';
import { dateToString } from '@/schedule/dailyScan';
import { formatTime } from '@/schedule/markdown';
import { useBoardColumns } from '@/schedule/columns';
import type { EventCategory, Priority, TaskCategory, TaskColumn } from '@/schedule/types';
import { EVENT_CATEGORY_LABEL, TASK_CATEGORY_LABEL } from '@/schedule/types';

export type ModalIntent =
  | { kind: 'event'; day: string; hour: number }
  | { kind: 'task'; col: TaskColumn }
  | { kind: 'eventDetail'; eventId: string }
  | { kind: 'taskDetail'; taskId: string };

interface Props {
  intent: ModalIntent;
  onClose: () => void;
}

const EVENT_CATS: EventCategory[] = ['work', 'personal', 'family', 'health'];
const TASK_CATS: TaskCategory[] = ['design', 'dev', 'bug', 'growth', 'ops'];
const PRIOS: Priority[] = ['high', 'med', 'low'];

/** "HH:MM" → 小时浮点。 */
function toH(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h + (m || 0) / 60;
}

export function ScheduleModal({ intent, onClose }: Props) {
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
  const initialCal: EventCategory = editingEvent?.category ?? 'work';
  const initialCol: TaskColumn =
    intent.kind === 'task' ? intent.col : (editingTask?.column ?? 'todo');
  const initialCat: TaskCategory = editingTask?.category ?? 'design';
  const initialPrio: Priority = editingTask?.priority ?? 'med';

  const [type, setType] = useState<'event' | 'task'>(initialType);
  const [title, setTitle] = useState(initialTitle);
  const [desc, setDesc] = useState(initialDesc);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [cal, setCal] = useState<EventCategory>(initialCal);
  const [col, setCol] = useState<TaskColumn>(initialCol);
  const [cat, setCat] = useState<TaskCategory>(initialCat);
  const [prio, setPrio] = useState<Priority>(initialPrio);

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
    if (!title.trim()) {
      useScheduleStore.getState().toast('请填写标题');
      return;
    }
    if (type === 'event') {
      const s = toH(start);
      const e = toH(end);
      if (e <= s) {
        useScheduleStore.getState().toast('结束时间需晚于开始');
        return;
      }
      if (isEdit && editingEvent) {
        await updateEvent(editingEvent.id, {
          title: title.trim(),
          start: s,
          end: e,
          category: cal,
          note: desc.trim() || undefined,
        });
      } else {
        await addEvent(day, {
          start: s,
          end: e,
          category: cal,
          title: title.trim(),
          note: desc.trim() || undefined,
        });
      }
    } else {
      if (isEdit && editingTask) {
        const s = toH(start);
        const e = toH(end);
        if (e <= s) {
          useScheduleStore.getState().toast('结束时间需晚于开始');
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
  };

  return (
    <div className="sw-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sw-modal" role="dialog" aria-modal="true">
        <h3>{isEdit ? (type === 'event' ? '编辑事件' : '编辑任务') : (type === 'event' ? '新建事件' : '新建任务')}</h3>

        <div className="sw-field">
          <label>类型</label>
          <div className="sw-seg-inline">
            {(['event', 'task'] as const).map((t) => (
              <label key={t}>
                <input
                  type="radio"
                  name="sw-type"
                  checked={type === t}
                  onChange={() => setType(t)}
                  disabled={isEdit}
                />
                <span>{t === 'event' ? '日程事件' : '看板任务'}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="sw-field">
          <label>标题</label>
          <input
            id="sw-modal-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：产品评审会"
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          />
        </div>

        <div className="sw-field">
          <label>描述</label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="背景、验收标准、相关链接…"
          />
        </div>

        {type === 'event' && (
          <>
            <div className="sw-row2">
              <div className="sw-field">
                <label>开始</label>
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="sw-field">
                <label>结束</label>
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <div className="sw-field">
              <label>日历</label>
              <div className="sw-seg-inline">
                {EVENT_CATS.map((c) => (
                  <label key={c}>
                    <input
                      type="radio"
                      name="sw-cal"
                      checked={cal === c}
                      onChange={() => setCal(c)}
                    />
                    <span>{EVENT_CATEGORY_LABEL[c]}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {type === 'task' && (
          <>
            <div className="sw-field">
              <label>所属列</label>
              <select
                value={col}
                onChange={(e) => setCol(e.target.value as TaskColumn)}
              >
                {boardColumns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.isDone ? '（完成）' : ''}</option>
                ))}
              </select>
            </div>
            <div className="sw-field">
              <label>分类</label>
              <div className="sw-seg-inline">
                {TASK_CATS.map((c) => (
                  <label key={c}>
                    <input
                      type="radio"
                      name="sw-cat"
                      checked={cat === c}
                      onChange={() => setCat(c)}
                    />
                    <span>{TASK_CATEGORY_LABEL[c]}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="sw-field">
          <label>优先级</label>
          <div className="sw-seg-inline">
            {PRIOS.map((p) => (
              <label key={p}>
                <input
                  type="radio"
                  name="sw-prio"
                  checked={prio === p}
                  onChange={() => setPrio(p)}
                />
                <span>{p === 'high' ? '高' : p === 'med' ? '中' : '低'}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="sw-actions">
          <button className="sw-btn sw-btn-ghost" onClick={onClose}>{isEdit ? '关闭' : '取消'}</button>
          <button className="sw-btn sw-btn-primary" onClick={save}>{isEdit ? '保存' : '创建'}</button>
          {isEdit && (
            type === 'event' ? (
              <button
                className="sw-btn sw-btn-danger"
                onClick={async () => { if (editingEvent) await deleteEvent(editingEvent.id); onClose(); }}
              >
                删除
              </button>
            ) : (
              <button
                className="sw-btn sw-btn-danger"
                onClick={async () => { if (editingTask) await unscheduleTask(editingTask.id); onClose(); }}
              >
                取消排程
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
