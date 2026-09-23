/**
 * Period picker (design §7.1): 今天/本周/本月 quick tabs + a calendar popover
 * with month navigation and click-to-pick range selection (prototype-validated
 * semantics — see period.ts `pickDay`). Future days are disabled.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type Period,
  calendarGrid,
  formatPeriodRange,
  isCurrentPeriod,
  pickDay,
  quickRange,
  sameDay,
} from './period';

interface PeriodPickerProps {
  period: Period;
  onPeriodChange: (p: Period) => void;
}

export function PeriodPicker({ period, onPeriodChange }: PeriodPickerProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pickStart, setPickStart] = useState<Date | null>(null);
  const [calY, setCalY] = useState(period.start.getFullYear());
  const [calM, setCalM] = useState(period.start.getMonth());
  const wrapRef = useRef<HTMLDivElement>(null);

  const today = new Date();

  // Click-outside closes the popover and resets the pending pick.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPickStart(null);
      }
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  const quick = (mode: 'today' | 'week' | 'month') => {
    setPickStart(null);
    onPeriodChange(quickRange(mode, today));
  };

  const onPick = (day: Date) => {
    if (day > today) return;
    const { pickStart: next, period: p } = pickDay(pickStart, day);
    setPickStart(next);
    onPeriodChange(p);
  };

  const shiftMonth = (delta: number) => {
    const next = new Date(calY, calM + delta, 1);
    if (next > new Date(today.getFullYear(), today.getMonth(), 1)) return;
    setCalY(next.getFullYear());
    setCalM(next.getMonth());
  };

  const grid = calendarGrid(calY, calM);
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((d) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(
      new Date(2024, 0, d), // 2024-01-01 is a Monday
    ),
  );
  const cur = !isCurrentPeriod(period, today);

  return (
    <div className="flex items-center gap-2 relative" ref={wrapRef}>
      {cur && (
        <button
          className="btn btn-g btn-sm"
          onClick={() => quick('today')}
          title={t('activity:period.backToToday')}
        >
          {t('activity:period.backToToday')}
        </button>
      )}
      <div className="inline-flex rounded-md border border-brd overflow-hidden">
        {(['today', 'week', 'month'] as const).map((m) => (
          <button
            key={m}
            className={`px-3 py-1 text-[length:calc(var(--ui-font-size)-1px)] border-l border-brd first:border-l-0 ${
              period.mode === m
                ? 'bg-accdim text-acc'
                : 'bg-panel text-t2 hover:bg-hov'
            }`}
            onClick={() => quick(m)}
          >
            {t(`activity:period.${m}`)}
          </button>
        ))}
      </div>
      {/* Fixed width so the row (and the right-anchored popover) never shifts
          when the label changes between modes. Sized to the longest label
          (start – end in full y-m-d); truncate as ceiling. */}
      <button
        className="btn btn-g btn-sm inline-flex items-center justify-center gap-1.5 w-[200px]"
        onClick={(e) => {
          e.stopPropagation();
          if (!open) {
            setCalY(period.start.getFullYear());
            setCalM(period.start.getMonth());
          }
          setOpen(!open);
        }}
      >
        <span className="text-t2 truncate">
          {formatPeriodRange(period, i18n.language)}
        </span>
        <CalendarDays size={14} className="text-t3 shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 bg-panel border border-brd2 rounded-lg p-3 shadow-xl w-[280px]">
          <div className="flex items-center justify-between mb-2">
            <button className="btn btn-g btn-sm px-1.5 py-0.5" onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={14} />
            </button>
            <span className="text-[length:calc(var(--ui-font-size)-1px)] text-t1">
              {new Intl.DateTimeFormat(i18n.language, {
                year: 'numeric',
                month: 'long',
              }).format(new Date(calY, calM, 1))}
            </span>
            <button className="btn btn-g btn-sm px-1.5 py-0.5" onClick={() => shiftMonth(1)}>
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {weekdays.map((w) => (
              <div key={w} className="text-[10px] text-t3 text-center py-0.5">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {grid.map((day, i) => {
              if (!day) return <div key={`x${i}`} />;
              const future = day > today;
              const sel = sameDay(day, period.start) || sameDay(day, period.end);
              const inRange = day > period.start && day < period.end;
              return (
                <button
                  key={day.getTime()}
                  disabled={future}
                  className={`h-7 text-[11px] rounded-md ${
                    future
                      ? 'text-t3 opacity-40 cursor-default'
                      : sel
                        ? 'bg-accdim text-acc font-medium'
                        : inRange
                          ? 'bg-surf2 text-acc hover:bg-hov'
                          : 'text-t1 hover:bg-hov'
                  }`}
                  onClick={() => onPick(day)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-t3 mt-2 mb-0">
            {t('activity:period.rangeHint')}
          </p>
        </div>
      )}
    </div>
  );
}
