import { useState, useMemo } from 'react';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { VaultEntry } from '@quill/vault-provider';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDailyNoteDates(
  entries: VaultEntry[],
  dailyDir: string,
): Set<string> {
  const dates = new Set<string>();
  const dateRegex = /^(\d{4}-\d{2}-\d{2})\.md$/;

  function scan(items: VaultEntry[]) {
    for (const entry of items) {
      if (entry.type === 'dir' && entry.name === dailyDir && entry.children) {
        for (const child of entry.children) {
          if (child.type === 'file') {
            const match = child.name.match(dateRegex);
            if (match) dates.add(match[1]);
          }
        }
      } else if (entry.type === 'dir' && entry.children) {
        scan(entry.children);
      }
    }
  }

  scan(entries);
  return dates;
}

export function CalendarPanel() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const fileTree = useVaultStore((s) => s.fileTree);
  const dailyDir = useSettingsStore((s) => s.dailyNotesDir || 'daily');
  const openDailyNote = useEditorStore((s) => s.openDailyNote);

  const noteDates = useMemo(
    () => extractDailyNoteDates(fileTree, dailyDir),
    [fileTree, dailyDir],
  );

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);

  const todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleDayClick = (day: number) => {
    const dateStr = formatDateStr(viewYear, viewMonth, day);
    openDailyNote(dateStr);
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="calendar-panel">
      <div className="calendar-header">
        <button className="calendar-nav" onClick={handlePrevMonth}>‹</button>
        <span className="calendar-title">
          {viewYear} 年 {viewMonth + 1} 月
        </span>
        <button className="calendar-nav" onClick={handleNextMonth}>›</button>
      </div>
      <div className="calendar-weekdays">
        {WEEKDAYS.map((wd) => (
          <span key={wd} className="calendar-wd">{wd}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((day, idx) => {
          if (day === null) {
            return <span key={`empty-${idx}`} className="calendar-cell empty" />;
          }
          const dateStr = formatDateStr(viewYear, viewMonth, day);
          const hasNote = noteDates.has(dateStr);
          const isToday = dateStr === todayStr;

          return (
            <button
              key={dateStr}
              className={`calendar-cell ${isToday ? 'today' : ''} ${hasNote ? 'has-note' : ''}`}
              onClick={() => handleDayClick(day)}
              title={hasNote ? `${dateStr} (有笔记)` : dateStr}
            >
              {day}
              {hasNote && <span className="calendar-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
