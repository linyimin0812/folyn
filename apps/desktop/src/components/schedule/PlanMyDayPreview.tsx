// AI 规划今日 — preview overlay (PR2).
//
// Renders the AI-proposed plan on a single-day timeline that mirrors
// ScheduleView / WeekGrid's coordinate system: `start`/`end` are hour-floating
// (9.5 == 09:30) and a block's vertical position is `start * var(--hour-h)`,
// height `(end - start) * var(--hour-h)`, exactly like `EventBlock.tsx`.
//
// Proposed blocks are drawn semi-transparent + dashed (distinct from the
// confirmed solid `sw-event` blocks). Each block has a ✓/✗ toggle (default ✓)
// and can be drag-tweaked to move its `start` (duration preserved, snapped to
// 15-min). Accept passes only the ✓-ed items' indices as a PlanAcceptance.
//
// NOTE on target date: the plan targets TODAY (PR1's `gatherPlanContext` is
// today-only; the prd scopes multi-day planning out). `boardAnchorDate` is the
// *board* view's anchor, not the schedule view's selected day, so it is not
// used here — the button always plans for today. (See prd.md "Out of Scope:
// Multi-day planning (today only)".)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useScheduleStore } from '@/store/scheduleStore';
import { formatTime } from '@/features/schedule/markdown';
import { computeOverlapGroups, type LayoutItem } from '@/features/schedule/layout';
import type {
  Plan,
  PlanAcceptance,
  PlannedEvent,
  PlannedNewTask,
  PlannedScheduledTask,
} from '@/services/planMyDayService';
import type { EventCategory } from '@/features/schedule/types';

// ── Pure helpers (exported for unit tests) ───────────────────────────────────

export interface BlockBox {
  top: number;
  height: number;
}

/**
 * Pixel geometry for a block on the day timeline, mirroring EventBlock's
 * `calc(${start} * var(--hour-h))` math. Pure: takes hourH in px, returns px.
 */
export function computeBlockBox(start: number, end: number, hourH: number): BlockBox {
  return {
    top: start * hourH,
    height: Math.max(0, (end - start) * hourH - 2),
  };
}

/** Snap step in hours (15 minutes). */
export const SNAP_STEP = 0.25;

/**
 * Snap a candidate start to {@link SNAP_STEP}, clamp to [minHour, maxHour -
 * duration] so the block stays inside the day. Pure.
 */
export function snapStart(
  candidate: number,
  duration: number,
  snapStep = SNAP_STEP,
  minHour = 0,
  maxHour = 24,
): number {
  const maxStart = maxHour - duration;
  if (maxStart < minHour) return minHour;
  const snapped = Math.round(candidate / snapStep) * snapStep;
  return Math.min(maxStart, Math.max(minHour, snapped));
}

export interface CheckedState {
  scheduled: boolean[];
  newTask: boolean[];
  newEvent: boolean[];
}

/** Build a {@link CheckedState} from a plan, defaulting every item to ✓. */
export function defaultChecked(plan: Plan): CheckedState {
  return {
    scheduled: plan.scheduledTasks.map(() => true),
    newTask: plan.newTasks.map(() => true),
    newEvent: plan.newEvents.map(() => true),
  };
}

/**
 * Build a {@link PlanAcceptance} (sorted index arrays) from a checked state.
 * Pure — this is the single source of truth for "which indices are accepted".
 */
export function buildAcceptance(checked: CheckedState): PlanAcceptance {
  const indices = (flags: boolean[]): number[] =>
    flags.reduce<number[]>((acc, on, i) => (on ? [...acc, i] : acc), []);
  return {
    scheduledTaskIndices: indices(checked.scheduled),
    newTaskIndices: indices(checked.newTask),
    newEventIndices: indices(checked.newEvent),
  };
}

// ── Internal block model (with local drag edits applied) ─────────────────────

interface BlockEdit {
  start: number;
  end: number;
}

function toLayoutItems(blocks: BlockEdit[], ids: string[]): LayoutItem[] {
  return blocks.map((b, i) => ({ id: ids[i], start: b.start, end: b.end }));
}

// ── Proposed block subcomponent ──────────────────────────────────────────────

interface ProposedBlockProps {
  title: string;
  start: number;
  end: number;
  checked: boolean;
  variant: 'scheduled' | 'newTask' | 'newEvent';
  colCount: number;
  colIndex: number;
  onToggle: () => void;
  onDragStart: () => void;
  dragging: boolean;
}

function ProposedBlock({
  title,
  start,
  end,
  checked,
  variant,
  colCount,
  colIndex,
  onToggle,
  onDragStart,
  dragging,
}: ProposedBlockProps) {
  const short = end - start < 0.25;
  const top = `calc(${start} * var(--hour-h))`;
  const height = `calc(${(end - start)} * var(--hour-h) - 2px)`;
  const left = `calc(${colIndex} * (100% / ${colCount}) + 4px)`;
  const width = `calc(100% / ${colCount} - 8px)`;
  const cls = `sw-event sw-plan-block ${variant}${short ? ' short' : ''}${checked ? '' : ' unchecked'}${dragging ? ' dragging' : ''}`;

  return (
    <div
      className={cls}
      style={{ top, height, left, width }}
      title={`${title}\n${formatTime(start)} – ${formatTime(end)}`}
      onMouseDown={(e) => {
        // Left button only; don't start a drag from the checkbox (it has its
        // own click target). Prevent text selection while dragging.
        if (e.button !== 0) return;
        e.preventDefault();
        onDragStart();
      }}
    >
      <span
        className="sw-plan-check"
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onToggle();
          }
        }}
      >
        {checked ? '✓' : '✗'}
      </span>
      {!short && (
        <span className="sw-time">
          {formatTime(start)} – {formatTime(end)}
        </span>
      )}
      <span className="sw-title">{title}</span>
      {/* bottom resize handle keeps the block grabbable & signals drag affordance */}
      <span
        className="sw-plan-handle"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          onDragStart();
        }}
      />
    </div>
  );
}

// ── Main overlay ─────────────────────────────────────────────────────────────

export interface PlanMyDayPreviewProps {
  plan: Plan;
  /** YYYY-MM-DD — the day the plan targets (today, per gatherPlanContext). */
  targetDate: string;
  onAccept: (accepted: PlanAcceptance) => void;
  onReject: () => void;
}

export function PlanMyDayPreview({ plan, targetDate, onAccept, onReject }: PlanMyDayPreviewProps) {
  // Existing today events (context — confirmed, solid). Read via granular
  // selector so the overlay only re-renders when events change.
  const events = useScheduleStore((s) => s.events);
  const todayEvents = useMemo(
    () => events.filter((e) => e.noteDate === targetDate),
    [events, targetDate],
  );

  // Local edits: per-block start/end overrides from drag-tweaks.
  const [scheduledEdits, setScheduledEdits] = useState<BlockEdit[]>(() =>
    plan.scheduledTasks.map((t) => ({ start: t.start, end: t.end })),
  );
  const [newTaskEdits, setNewTaskEdits] = useState<BlockEdit[]>(() =>
    plan.newTasks.map((t) => ({ start: t.start, end: t.end })),
  );
  const [newEventEdits, setNewEventEdits] = useState<BlockEdit[]>(() =>
    plan.newEvents.map((t) => ({ start: t.start, end: t.end })),
  );

  const [checked, setChecked] = useState<CheckedState>(() => defaultChecked(plan));

  // Drag state: which block is being moved + the timeline's origin (px).
  const dragRef = useRef<{
    group: 'scheduled' | 'newTask' | 'newEvent';
    index: number;
    duration: number;
    timelineTop: number;
    hourH: number;
  } | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const timelineRef = useRef<HTMLDivElement | null>(null);

  // Re-measure hourH from the rendered timeline (CSS var --hour-h = 48px by
  // default). Measuring the live DOM avoids hardcoding drift if the var changes.
  const measureHourH = useCallback((): number => {
    const el = timelineRef.current?.querySelector('.sw-slot');
    if (!el) return 48;
    return el.getBoundingClientRect().height || 48;
  }, []);

  const startDrag = useCallback(
    (group: 'scheduled' | 'newTask' | 'newEvent', index: number) => {
      const edits = group === 'scheduled' ? scheduledEdits : group === 'newTask' ? newTaskEdits : newEventEdits;
      const block = edits[index];
      if (!block) return;
      const tl = timelineRef.current?.getBoundingClientRect();
      if (!tl) return;
      dragRef.current = {
        group,
        index,
        duration: block.end - block.start,
        timelineTop: tl.top,
        hourH: measureHourH(),
      };
      setDraggingKey(`${group}:${index}`);
    },
    [scheduledEdits, newTaskEdits, newEventEdits, measureHourH],
  );

  const moveDrag = useCallback((clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const candidate = (clientY - d.timelineTop) / d.hourH;
    const next = snapStart(candidate, d.duration);
    const apply = (set: React.Dispatch<React.SetStateAction<BlockEdit[]>>) =>
      set((prev) => prev.map((b, i) => (i === d.index ? { start: next, end: next + d.duration } : b)));
    if (d.group === 'scheduled') apply(setScheduledEdits);
    else if (d.group === 'newTask') apply(setNewTaskEdits);
    else apply(setNewEventEdits);
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDraggingKey(null);
  }, []);

  // Drag uses mousemove/up on window so the pointer can leave the block.
  useEffect(() => {
    if (!draggingKey) return;
    const onMove = (e: MouseEvent) => moveDrag(e.clientY);
    const onUp = () => endDrag();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingKey, moveDrag, endDrag]);

  // Escape rejects the plan (matches the workbench's Esc-to-close convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onReject();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onReject]);

  // Overlap layout so parallel proposed blocks don't fully overlap visually.
  const scheduledIds = useMemo(() => plan.scheduledTasks.map((_, i) => `s${i}`), [plan.scheduledTasks]);
  const newTaskIds = useMemo(() => plan.newTasks.map((_, i) => `n${i}`), [plan.newTasks]);
  const newEventIds = useMemo(() => plan.newEvents.map((_, i) => `e${i}`), [plan.newEvents]);

  const proposedLayout = useMemo(() => {
    // Layout proposed blocks together so they share columns when overlapping.
    const items: LayoutItem[] = [
      ...toLayoutItems(scheduledEdits, scheduledIds),
      ...toLayoutItems(newTaskEdits, newTaskIds),
      ...toLayoutItems(newEventEdits, newEventIds),
    ];
    return computeOverlapGroups(items);
  }, [scheduledEdits, newTaskEdits, newEventEdits, scheduledIds, newTaskIds, newEventIds]);

  const layoutOf = (id: string) => proposedLayout.get(id) ?? { colCount: 1, colIndex: 0 };

  const toggle = useCallback(
    (group: 'scheduled' | 'newTask' | 'newEvent', index: number) => {
      setChecked((prev) => {
        const arr = prev[group].slice();
        arr[index] = !arr[index];
        return { ...prev, [group]: arr };
      });
    },
    [],
  );

  const handleAccept = useCallback(() => {
    onAccept(buildAcceptance(checked));
  }, [checked, onAccept]);

  const empty =
    plan.scheduledTasks.length === 0 &&
    plan.newTasks.length === 0 &&
    plan.newEvents.length === 0;

  return (
    <div className="sw-plan-overlay" role="dialog" aria-label="AI 规划今日">
      <div className="sw-plan-backdrop" onClick={onReject} />
      <div className="sw-plan-panel">
        <header className="sw-plan-header">
          <div className="sw-plan-title">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M13.5 8.5a5.5 5.5 0 01-6-6 5.5 5.5 0 106 6z" />
            </svg>
            <span>AI 规划今日</span>
            <span className="sw-plan-date">{targetDate}</span>
          </div>
          <div className="sw-plan-actions">
            <button className="sw-plan-reject" onClick={onReject}>放弃</button>
            <button className="sw-plan-accept" onClick={handleAccept} disabled={empty}>
              应用已选
            </button>
          </div>
        </header>

        {plan.notes && <p className="sw-plan-notes">{plan.notes}</p>}

        {empty && (
          <p className="sw-plan-empty">近 7 天无未完成任务，AI 也没有提议新计划。</p>
        )}

        <div className="sw-plan-timeline" ref={timelineRef}>
          <div className="sw-hour-col">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="sw-hour-cell">{`${String(h).padStart(2, '0')}:00`}</div>
            ))}
          </div>
          <div className="sw-plan-day sw-day-col today-col">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="sw-slot" data-hour={h} />
            ))}

            {/* Confirmed existing events (solid, for context). */}
            {todayEvents.map((e) => {
              const li = layoutOf(`ev-${e.id}`);
              return (
                <div
                  key={e.id}
                  className={`sw-event ${e.category} confirmed`}
                  style={{
                    top: `calc(${e.start} * var(--hour-h))`,
                    height: `calc(${(e.end - e.start)} * var(--hour-h) - 2px)`,
                    left: `calc(${li.colIndex} * (100% / ${li.colCount}) + 4px)`,
                    width: `calc(100% / ${li.colCount} - 8px)`,
                  }}
                  title={`${e.title}\n${formatTime(e.start)} – ${formatTime(e.end)}`}
                >
                  <span className="sw-time">{formatTime(e.start)} – {formatTime(e.end)}</span>
                  <span className="sw-title">{e.title}</span>
                </div>
              );
            })}

            {/* Proposed scheduled tasks (existing backlog → scheduled). */}
            {plan.scheduledTasks.map((t, i) => {
              const edit = scheduledEdits[i];
              const id = scheduledIds[i];
              const li = layoutOf(id);
              return (
                <ProposedBlock
                  key={`s:${i}`}
                  title={t.taskId}
                  start={edit.start}
                  end={edit.end}
                  checked={checked.scheduled[i]}
                  variant="scheduled"
                  colCount={li.colCount}
                  colIndex={li.colIndex}
                  onToggle={() => toggle('scheduled', i)}
                  onDragStart={() => startDrag('scheduled', i)}
                  dragging={draggingKey === `scheduled:${i}`}
                />
              );
            })}

            {/* Proposed new tasks. */}
            {plan.newTasks.map((t, i) => {
              const edit = newTaskEdits[i];
              const id = newTaskIds[i];
              const li = layoutOf(id);
              return (
                <ProposedBlock
                  key={`n:${i}`}
                  title={t.title}
                  start={edit.start}
                  end={edit.end}
                  checked={checked.newTask[i]}
                  variant="newTask"
                  colCount={li.colCount}
                  colIndex={li.colIndex}
                  onToggle={() => toggle('newTask', i)}
                  onDragStart={() => startDrag('newTask', i)}
                  dragging={draggingKey === `newTask:${i}`}
                />
              );
            })}

            {/* Proposed new events (breaks / buffers). */}
            {plan.newEvents.map((t, i) => {
              const edit = newEventEdits[i];
              const id = newEventIds[i];
              const li = layoutOf(id);
              return (
                <ProposedBlock
                  key={`e:${i}`}
                  title={t.title}
                  start={edit.start}
                  end={edit.end}
                  checked={checked.newEvent[i]}
                  variant="newEvent"
                  colCount={li.colCount}
                  colIndex={li.colIndex}
                  onToggle={() => toggle('newEvent', i)}
                  onDragStart={() => startDrag('newEvent', i)}
                  dragging={draggingKey === `newEvent:${i}`}
                />
              );
            })}
          </div>
        </div>

        <footer className="sw-plan-legend">
          <span><span className="sw-legend-dot" style={{ background: 'var(--cal-task)' }} />提议任务（拖动调整 / ✓✗ 选择）</span>
          <span><span className="sw-legend-dot" style={{ background: 'var(--cal-health)' }} />提议事件 / 休息</span>
          <span><span className="sw-legend-dot" style={{ background: 'var(--cal-work)' }} />已有事件（参考）</span>
        </footer>
      </div>
    </div>
  );
}

// Re-export types used by callers for convenience.
export type { Plan, PlanAcceptance, PlannedScheduledTask, PlannedNewTask, PlannedEvent, EventCategory };
