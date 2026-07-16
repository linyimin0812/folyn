import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useScheduleStore } from './scheduleStore';
import { storageClient } from '@/utils/storageClient';
import { hydrateAllStores } from './settingsPersistence';
import { DEFAULT_BOARD_COLUMNS, COLUMN_COLOR_PALETTE } from '@/features/schedule/types';

beforeEach(() => {
  storageClient.__resetForTesting();
  vi.useFakeTimers();
  useScheduleStore.setState({
    events: [],
    tasks: [],
    loading: false,
    lastScan: 0,
    calendarFilter: { work: true, personal: true, family: true, health: true, task: true },
    boardAnchorDate: '2026-07-16',
    boardColumns: DEFAULT_BOARD_COLUMNS.map((c) => ({ ...c })),
    pomo: { mode: 'work', remaining: 25 * 60, running: false, round: 1 },
    toastMsg: '',
    toastAction: null,
    _toastTimer: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useScheduleStore boardColumns', () => {
  it('defaults to DEFAULT_BOARD_COLUMNS with 4 cols incl one isDone', () => {
    const cols = useScheduleStore.getState().boardColumns;
    expect(cols.length).toBe(4);
    expect(cols.some((c) => c.isDone)).toBe(true);
  });

  it('addBoardColumn appends a new column with a palette color + id', () => {
    const id = useScheduleStore.getState().addBoardColumn('新列');
    expect(id).toBeTruthy();
    const cols = useScheduleStore.getState().boardColumns;
    expect(cols.length).toBe(5);
    const added = cols[cols.length - 1];
    expect(added.id).toBe(id);
    expect(added.name).toBe('新列');
    expect(COLUMN_COLOR_PALETTE).toContain(added.color);
  });

  it('addBoardColumn defaults empty name to "新列"', () => {
    const id = useScheduleStore.getState().addBoardColumn('');
    const added = useScheduleStore.getState().boardColumns.find((c) => c.id === id)!;
    expect(added.name).toBe('新列');
  });

  it('renameBoardColumn updates the name', () => {
    useScheduleStore.getState().renameBoardColumn('todo', '待办事项');
    expect(useScheduleStore.getState().boardColumns.find((c) => c.id === 'todo')!.name).toBe('待办事项');
  });

  it('reorderBoardColumns moves a column', () => {
    useScheduleStore.getState().reorderBoardColumns('todo', 'done');
    const ids = useScheduleStore.getState().boardColumns.map((c) => c.id);
    expect(ids[ids.length - 1]).toBe('todo');
  });

  it('reorderBoardColumns is a no-op when fromId === toId', () => {
    const before = useScheduleStore.getState().boardColumns.map((c) => c.id);
    useScheduleStore.getState().reorderBoardColumns('todo', 'todo');
    expect(useScheduleStore.getState().boardColumns.map((c) => c.id)).toEqual(before);
  });

  it('setBoardColumns replaces the array', () => {
    useScheduleStore.getState().setBoardColumns([
      { id: 'x', name: 'X', color: 'var(--t3)' },
      { id: 'y', name: 'Y', color: 'var(--green)', isDone: true },
    ]);
    expect(useScheduleStore.getState().boardColumns.length).toBe(2);
  });

  it('addBoardColumn persists', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useScheduleStore.getState().addBoardColumn('persisted');
    vi.advanceTimersByTime(400);
    expect(setSpy).toHaveBeenCalled();
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(Array.isArray(payload.boardColumns)).toBe(true);
    setSpy.mockRestore();
  });

  it('hydrate falls back to DEFAULT_BOARD_COLUMNS on empty/invalid array', () => {
    useScheduleStore.setState({ boardColumns: [] });
    hydrateAllStores({ boardColumns: [] });
    expect(useScheduleStore.getState().boardColumns.length).toBe(4);
    expect(useScheduleStore.getState().boardColumns.some((c) => c.isDone)).toBe(true);
  });

  it('hydrate keeps a valid persisted array', () => {
    const valid = [
      { id: 'todo', name: '待办', color: 'var(--t3)' },
      { id: 'done', name: '已完成', color: 'var(--green)', isDone: true },
    ];
    hydrateAllStores({ boardColumns: valid });
    expect(useScheduleStore.getState().boardColumns).toEqual(valid);
  });

  it('hydrate falls back when no isDone column present', () => {
    const noDone = [
      { id: 'a', name: 'A', color: 'var(--t3)' },
      { id: 'b', name: 'B', color: 'var(--acc)' },
    ];
    hydrateAllStores({ boardColumns: noDone });
    expect(useScheduleStore.getState().boardColumns.length).toBe(4);
    expect(useScheduleStore.getState().boardColumns.some((c) => c.isDone)).toBe(true);
  });
});
