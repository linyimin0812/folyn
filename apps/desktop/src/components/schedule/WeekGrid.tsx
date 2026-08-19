import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';
import { dateToString, startOfWeek, addDays, sameDay } from '@/features/schedule/dailyScan';
import { formatTime } from '@/features/schedule/markdown';
import { hasDragPayload, readDragPayload } from '@/features/schedule/dnd';
import { buildDayLayout } from '@/features/schedule/layout';
import { EventBlock } from './EventBlock';
import { NowLine } from './NowLine';
import type { ModalIntent } from './ScheduleModal';

interface Props {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onOpenModal: (intent: ModalIntent) => void;
}

export function WeekGrid({ cursor, onCursorChange, selectedDate, onSelectDate, onOpenModal }: Props) {
  const { t } = useTranslation();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const events = useScheduleStore((s) => s.events);
  const tasks = useScheduleStore((s) => s.tasks);
  const scheduleTask = useScheduleStore((s) => s.scheduleTask);
  const moveEvent = useScheduleStore((s) => s.moveEvent);

  const ws = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));

  const go = (n: number) => onCursorChange(addDays(cursor, n));
  const goToday = () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    onSelectDate(t);
  };

  const rangeLabel = () => {
    const end = addDays(ws, 6);
    return t('schedule:weekGrid.weekRange', {
      y: ws.getFullYear(),
      ms: ws.getMonth() + 1,
      ds: ws.getDate(),
      me: end.getMonth() + 1,
      de: end.getDate(),
    });
  };

  return (
    <div className="sw-cal-main">
      <div className="sw-cal-toolbar">
        <div className="sw-left">
          <button className="sw-nav-btn" onClick={() => go(-7)}>‹</button>
          <button className="sw-today-btn" onClick={goToday}>{t('schedule:weekGrid.today')}</button>
          <button className="sw-nav-btn" onClick={() => go(7)}>›</button>
          <div className="sw-range-label">{rangeLabel()}</div>
        </div>
      </div>

      <div className="sw-cal-scroll">
        <div className="sw-week-grid">
          <div className="sw-week-head">
            <div className="sw-corner" />
            {days.map((d) => {
              const cls = `sw-day-col-head${sameDay(d, today) ? ' today' : ''}${sameDay(d, selectedDate) ? ' selected' : ''}`;
              return (
                <div
                  key={d.toISOString()}
                  className={cls}
                  onClick={() => onSelectDate(d)}
                  style={{ cursor: 'pointer' }}
                  title={t('schedule:weekGrid.selectDay')}
                >
                  <div className="sw-dow">{(t('schedule:weekGrid.dow', { returnObjects: true }) as string[])[(d.getDay() + 6) % 7]}</div>
                  <div className="sw-dom">{d.getDate()}</div>
                </div>
              );
            })}
          </div>

          <div className="sw-hour-col">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="sw-hour-cell">{`${String(h).padStart(2, '0')}:00`}</div>
            ))}
          </div>

          {days.map((d, dayIdx) => {
            const dStr = dateToString(d);
            const dayEvents = events.filter((e) => e.noteDate === dStr);
            const dayTasks = tasks.filter(
              (t) => t.scheduledDate === dStr && !t.done,
            );
            return (
              <div
                key={d.toISOString()}
                className={`sw-day-col${sameDay(d, today) ? ' today-col' : ''}${sameDay(d, selectedDate) ? ' selected-col' : ''}`}
                data-day={dayIdx}
                onDragOver={(e) => {
                  if (!hasDragPayload(e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  // 只高亮鼠标下方的那一个时间格，不整列高亮
                  const col = e.currentTarget as HTMLElement;
                  const slots = col.querySelectorAll('.sw-slot');
                  const firstSlot = slots[0] as HTMLElement | undefined;
                  if (!firstSlot) return;
                  const slotRect = firstSlot.getBoundingClientRect();
                  const hourH = slotRect.height; // 渲染后的一小时高度（含边框）
                  const h = Math.max(0, Math.min(23, Math.floor((e.clientY - slotRect.top) / hourH)));
                  slots.forEach((s) => s.classList.remove('drop-target'));
                  slots[h]?.classList.add('drop-target');
                }}
                onDragLeave={(e) => {
                  if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
                  (e.currentTarget as HTMLElement).querySelectorAll('.sw-slot').forEach((s) => s.classList.remove('drop-target'));
                }}
                onDrop={(e) => {
                  const p = readDragPayload(e);
                  if (!p) return;
                  e.preventDefault();
                  const col = e.currentTarget as HTMLElement;
                  col.querySelectorAll('.sw-slot').forEach((s) => s.classList.remove('drop-target'));
                  // 以第一个 .sw-slot 的实际渲染矩形为坐标原点和单位，避免列高/box-sizing 偏差
                  const firstSlot = col.querySelector('.sw-slot') as HTMLElement | null;
                  if (!firstSlot) return;
                  const slotRect = firstSlot.getBoundingClientRect();
                  const hourH = slotRect.height; // 渲染后的一小时高度（含边框）
                  const hourFloat = (e.clientY - slotRect.top) / hourH;
                  const snapped = Math.max(0, Math.min(23, Math.floor(hourFloat)));
                  if (p.kind === 'event' && p.id) {
                    const dur = p.dur ?? 1;
                    const startOffset = p.startOffset ?? 0;
                    const finalStart = snapped + startOffset;
                    moveEvent(p.id, dStr, finalStart, Math.min(finalStart + dur, 24));
                  } else if (p.kind === 'task' && p.id) {
                    scheduleTask(p.id, dStr, snapped, Math.min(snapped + 1, 24));
                    useScheduleStore.getState().toast(t('schedule:weekGrid.scheduledToast', { day: (t('schedule:weekGrid.dow', { returnObjects: true }) as string[])[(d.getDay() + 6) % 7], time: formatTime(snapped) }));
                  }
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="sw-slot"
                    data-hour={h}
                    data-day={dayIdx}
                    onClick={() => onOpenModal({ kind: 'event', day: dStr, hour: h })}
                  />
                ))}
                {(() => {
                  const layout = buildDayLayout(dayEvents, dayTasks);
                  const ev = (id: string) => layout.get(id) ?? { colCount: 1, colIndex: 0 };
                  return (
                    <>
                      {dayEvents.map((e) => (
                        <EventBlock
                          key={e.id}
                          title={e.title}
                          note={e.note}
                          start={e.start}
                          end={e.end}
                          eventId={e.id}
                          colCount={ev(e.id).colCount}
                          colIndex={ev(e.id).colIndex}
                          onOpenModal={onOpenModal}
                        />
                      ))}
                      {dayTasks.map((t) => {
                        const li = ev(t.id);
                        return (
                          <EventBlock
                            key={t.id}
                            title={t.title}
                            start={t.scheduledStart!}
                            end={t.scheduledEnd!}
                            taskId={t.id}
                            colCount={li.colCount}
                            colIndex={li.colIndex}
                            onOpenModal={onOpenModal}
                          />
                        );
                      })}
                    </>
                  );
                })()}
                {sameDay(d, today) && <NowLine />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
