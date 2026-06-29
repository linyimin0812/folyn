import { describe, it, expect } from 'vitest';
import {
  computeBlockBox,
  snapStart,
  defaultChecked,
  buildAcceptance,
  SNAP_STEP,
} from './PlanMyDayPreview';
import type { Plan } from '@/services/planMyDayService';

function makePlan(): Plan {
  return {
    scheduledTasks: [
      { taskId: 'a#0', start: 10, end: 11 },
      { taskId: 'b#1', start: 14, end: 15 },
    ],
    newTasks: [{ title: 'New', start: 16, end: 17 }],
    newEvents: [
      { title: '休息', start: 12, end: 13, category: 'health' },
      { title: '缓冲', start: 9, end: 9.5, category: 'task' },
    ],
    notes: 'plan',
  };
}

describe('computeBlockBox', () => {
  it('mirrors EventBlock calc math (top = start*hourH, height = (end-start)*hourH - 2)', () => {
    const box = computeBlockBox(9.5, 11, 48);
    expect(box.top).toBe(9.5 * 48);
    expect(box.height).toBe((11 - 9.5) * 48 - 2);
  });

  it('clamps height to >= 0 for zero/negative duration', () => {
    expect(computeBlockBox(10, 10, 48).height).toBe(0);
    expect(computeBlockBox(10, 9, 48).height).toBe(0);
  });
});

describe('snapStart', () => {
  it('snaps to 15-minute steps', () => {
    expect(snapStart(9.12, 1)).toBe(9);
    expect(snapStart(9.2, 1)).toBe(9.25);
    expect(snapStart(9.4, 1)).toBe(9.5);
  });

  it('clamps so the block stays within [0, 24]', () => {
    // 2h block starting at 23.5 → would end at 25.5; clamp to 22.
    expect(snapStart(23.5, 2)).toBe(22);
    expect(snapStart(-1, 1)).toBe(0);
  });

  it('returns minHour when duration exceeds the day', () => {
    expect(snapStart(5, 25)).toBe(0);
  });

  it('respects a custom snap step', () => {
    expect(snapStart(9.3, 1, 0.5)).toBe(9.5);
  });

  it('uses SNAP_STEP = 0.25 (15 minutes)', () => {
    expect(SNAP_STEP).toBe(0.25);
  });
});

describe('defaultChecked', () => {
  it('defaults every item to checked (✓)', () => {
    const plan = makePlan();
    const c = defaultChecked(plan);
    expect(c.scheduled).toEqual([true, true]);
    expect(c.newTask).toEqual([true]);
    expect(c.newEvent).toEqual([true, true]);
  });

  it('handles an empty plan', () => {
    const c = defaultChecked({ scheduledTasks: [], newTasks: [], newEvents: [], notes: '' });
    expect(c.scheduled).toEqual([]);
    expect(c.newTask).toEqual([]);
    expect(c.newEvent).toEqual([]);
  });
});

describe('buildAcceptance', () => {
  it('returns sorted indices of only the ✓-ed items', () => {
    const plan = makePlan();
    const c = defaultChecked(plan);
    // uncheck scheduled[0] and newEvent[1]
    c.scheduled[0] = false;
    c.newEvent[1] = false;
    const acc = buildAcceptance(c);
    expect(acc.scheduledTaskIndices).toEqual([1]);
    expect(acc.newTaskIndices).toEqual([0]);
    expect(acc.newEventIndices).toEqual([0]);
  });

  it('returns empty arrays when nothing is checked', () => {
    const plan = makePlan();
    const c = defaultChecked(plan);
    c.scheduled = c.scheduled.map(() => false);
    c.newTask = c.newTask.map(() => false);
    c.newEvent = c.newEvent.map(() => false);
    const acc = buildAcceptance(c);
    expect(acc.scheduledTaskIndices).toEqual([]);
    expect(acc.newTaskIndices).toEqual([]);
    expect(acc.newEventIndices).toEqual([]);
  });

  it('returns all indices when everything is checked', () => {
    const plan = makePlan();
    const acc = buildAcceptance(defaultChecked(plan));
    expect(acc.scheduledTaskIndices).toEqual([0, 1]);
    expect(acc.newTaskIndices).toEqual([0]);
    expect(acc.newEventIndices).toEqual([0, 1]);
  });
});
