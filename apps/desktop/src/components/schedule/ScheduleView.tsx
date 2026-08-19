import { useState } from 'react';
import { startOfWeek } from '@/features/schedule/dailyScan';
import { MiniCalendar } from './MiniCalendar';
import { WeekGrid } from './WeekGrid';
import { QuickAdd } from './QuickAdd';
import { Pomodoro } from './Pomodoro';
import { TodayTaskList } from './TodayTaskList';
import { Reminders } from './Reminders';
import { UnschedDock } from './UnschedDock';
import type { ModalIntent } from './ScheduleModal';

interface Props {
  onOpenModal: (intent: ModalIntent) => void;
}

export function ScheduleView({ onOpenModal }: Props) {
  const [cursor, setCursor] = useState(() => startOfWeek(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // 选中某天：标记为选中日，并把周游标移到含该天的周。
  const selectDay = (d: Date) => {
    const dd = new Date(d);
    dd.setHours(0, 0, 0, 0);
    setSelectedDate(dd);
    setCursor(startOfWeek(dd));
  };

  return (
    <section className="sw-view sw-view-schedule active">
      <aside className="sw-rail">
        <MiniCalendar selectedDate={selectedDate} onSelect={selectDay} />
      </aside>

      <WeekGrid cursor={cursor} onCursorChange={setCursor} selectedDate={selectedDate} onSelectDate={selectDay} onOpenModal={onOpenModal} />

      <aside className="sw-rail right">
        <QuickAdd />
        <Pomodoro />
        <TodayTaskList />
        <Reminders />
        <UnschedDock />
      </aside>
    </section>
  );
}
