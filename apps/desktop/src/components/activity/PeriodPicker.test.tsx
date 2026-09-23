// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from '@/i18n';
import { PeriodPicker } from './PeriodPicker';
import { quickRange, addDays, startOfDay, formatPeriodRange } from './period';

// Locale-dependent assertions (今天/本周): force zh like PetContextMenu.test.tsx,
// since direct vitest runs from apps/desktop skip test/setup.desktop.ts.
void i18n.changeLanguage('zh');

const today = new Date();

afterEach(() => cleanup());

const openPicker = () => {
  const onPeriodChange = vi.fn();
  const period = quickRange('today', today);
  render(<PeriodPicker period={period} onPeriodChange={onPeriodChange} />);
  // Trigger button is labeled by the formatted range text; click opens the popover.
  fireEvent.click(screen.getByRole('button', { name: formatPeriodRange(period, i18n.language) }));
  expect(screen.getByText('今天')).toBeTruthy();
  return onPeriodChange;
};

const dayButton = (d: Date) => screen.getByText(String(d.getDate()));

describe('PeriodPicker popover auto-close', () => {
  it('closes after clicking a quick tab (今天/本周/本月)', () => {
    const onPeriodChange = openPicker();
    fireEvent.click(screen.getByText('本周'));
    expect(onPeriodChange).toHaveBeenCalledWith(quickRange('week', today));
    expect(screen.queryByText('今天')).toBeNull(); // popover closed
  });

  it('closes when a two-click range completes, stays open after the first click', () => {
    openPicker();
    const d1 = addDays(startOfDay(today), -10);
    const d2 = addDays(startOfDay(today), -8);
    fireEvent.click(dayButton(d1));
    expect(screen.getByText('今天')).toBeTruthy(); // still open, awaiting second click
    fireEvent.click(dayButton(d2));
    expect(screen.queryByText('今天')).toBeNull(); // range done → closed
  });
});
