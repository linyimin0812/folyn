import { useState } from 'react';
import { formatTime } from '@/schedule/markdown';
import { setDragPayload } from '@/schedule/dnd';
import type { ModalIntent } from './ScheduleModal';
import type { EventCategory } from '@/schedule/types';

interface Props {
  category: EventCategory;
  title: string;
  start: number;
  end: number;
  note?: string;
  taskId?: string;
  eventId?: string;
  colCount?: number;
  colIndex?: number;
  onOpenModal: (intent: ModalIntent) => void;
}

export function EventBlock({ category, title, start, end, note, taskId, eventId, colCount = 1, colIndex = 0, onOpenModal }: Props) {
  const [dragging, setDragging] = useState(false);
  const short = end - start < 0.25;
  // 用 CSS var(--hour-h) 计算，与 .sw-slot 高度永远一致，避免硬编码漂移。
  const top = `calc(${start} * var(--hour-h))`;
  const height = `calc(${end - start} * var(--hour-h) - 2px)`;
  // 并列布局：colCount 等分宽度，colIndex 决定横向位置。colCount=1 时等价于 left:4px right:4px。
  const left = `calc(${colIndex} * (100% / ${colCount}) + 4px)`;
  const width = `calc(100% / ${colCount} - 8px)`;
  const cls = `sw-event ${category}${short ? ' short' : ''}${dragging ? ' dragging' : ''}`;

  return (
    <div
      className={cls}
      style={{ top, height, left, width }}
      title={`${title}\n${formatTime(start)} – ${formatTime(end)}${note ? '\n' + note : ''}`}
      draggable
      onDragStart={(e) => {
        if (eventId) {
          setDragPayload(e, { kind: 'event', id: eventId, dur: end - start, startOffset: start - Math.floor(start) });
          setDragging(true);
        } else if (taskId) {
          setDragPayload(e, { kind: 'task', id: taskId });
          setDragging(true);
        }
      }}
      onDragEnd={() => {
        setDragging(false);
        document.querySelectorAll('.sw-day-col.drop-target, .sw-slot.drop-target').forEach((s) => s.classList.remove('drop-target'));
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (dragging) return;
        if (eventId) onOpenModal({ kind: 'eventDetail', eventId });
        else if (taskId) onOpenModal({ kind: 'taskDetail', taskId });
      }}
    >
      {!short && <span className="sw-time">{formatTime(start)} – {formatTime(end)}</span>}
      <span className="sw-title">{title}</span>
    </div>
  );
}
