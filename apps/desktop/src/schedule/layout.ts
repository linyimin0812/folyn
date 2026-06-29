import type { ScheduleEvent, ScheduleTask } from './types';

export interface LayoutItem {
  id: string;
  start: number;
  end: number;
}

export interface LayoutResult {
  colCount: number;
  colIndex: number;
}

/**
 * Compute parallel-column layout for items that may overlap in time.
 * Items in the same transitive overlap cluster share a column count (= the
 * cluster's max overlap depth); each item gets a greedy-assigned colIndex so
 * non-overlapping items reuse columns. Singleton items get colCount=1.
 */
export function computeOverlapGroups(items: LayoutItem[]): Map<string, LayoutResult> {
  const result = new Map<string, LayoutResult>();
  if (items.length === 0) return result;

  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);

  let cluster: LayoutItem[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    if (cluster.length === 1) {
      result.set(cluster[0].id, { colCount: 1, colIndex: 0 });
      cluster = [];
      return;
    }
    const colLastEnd: number[] = [];
    const itemCol: number[] = [];
    for (const it of cluster) {
      let placed = -1;
      for (let c = 0; c < colLastEnd.length; c++) {
        if (colLastEnd[c] <= it.start) {
          placed = c;
          break;
        }
      }
      if (placed < 0) {
        placed = colLastEnd.length;
        colLastEnd.push(it.end);
      } else {
        colLastEnd[placed] = it.end;
      }
      itemCol.push(placed);
    }
    const colCount = colLastEnd.length;
    cluster.forEach((it, idx) => {
      result.set(it.id, { colCount, colIndex: itemCol[idx] });
    });
    cluster = [];
  };

  for (const it of sorted) {
    if (it.start >= clusterEnd) {
      flush();
      cluster = [it];
      clusterEnd = it.end;
    } else {
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.end);
    }
  }
  flush();
  return result;
}

/** Helper: build a LayoutItem list from a day's events + scheduled tasks. */
export function buildDayLayout(
  events: ScheduleEvent[],
  tasks: ScheduleTask[],
): Map<string, LayoutResult> {
  const items: LayoutItem[] = [
    ...events.map((e) => ({ id: e.id, start: e.start, end: e.end })),
    ...tasks
      .filter((t) => t.scheduledStart != null && t.scheduledEnd != null)
      .map((t) => ({ id: t.id, start: t.scheduledStart!, end: t.scheduledEnd! })),
  ];
  return computeOverlapGroups(items);
}
