import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sameDay } from '@/features/schedule/dailyScan';

interface Props {
  selectedDate: Date;
  onSelect: (d: Date) => void;
}

export function MiniCalendar({ selectedDate, onSelect }: Props) {
  const { t } = useTranslation();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [cursor, setCursor] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const total = startPad + daysInMonth;
  const trail = (7 - (total % 7)) % 7;
  for (let i = 1; i <= trail; i++) cells.push(null);

  const shift = (n: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const dowArr = t('schedule:miniCal.dow', { returnObjects: true }) as string[];

  return (
    <div className="sw-rail-block">
      <div className="sw-mini-cal-head">
        <span className="sw-mini-cal-month">{t('schedule:miniCal.monthTitle', { y, m: m + 1 })}</span>
        <div className="sw-mini-cal-nav">
          <button onClick={() => shift(-1)} aria-label={t('schedule:miniCal.prevMonth')}>‹</button>
          <button onClick={() => shift(1)} aria-label={t('schedule:miniCal.nextMonth')}>›</button>
        </div>
      </div>
      <div className="sw-mini-cal-grid">
        {dowArr.map((d) => <div key={d} className="sw-dow">{d}</div>)}
        {cells.map((day, idx) => {
          if (day === null) {
            const isPrev = idx < startPad;
            const num = isPrev ? prevDays - startPad + idx + 1 : idx - total + 1;
            return <div key={`e-${idx}`} className="sw-d muted">{num}</div>;
          }
          const dd = new Date(y, m, day);
          const cls = ['sw-d'];
          if (sameDay(dd, today)) cls.push('today');
          if (sameDay(dd, selectedDate)) cls.push('selected');
          return (
            <div key={day} className={cls.join(' ')} onClick={() => onSelect(dd)}>{day}</div>
          );
        })}
      </div>
    </div>
  );
}
