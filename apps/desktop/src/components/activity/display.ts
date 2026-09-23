/**
 * Display mapping for the activity page (design §3.1/§3.2/§7.2) — pure
 * helpers only. Collector-declared `activityDisplay` entries win; builtin
 * event types fall back to the table below; everything else falls to the
 * generic gray-dot rendering (never crashes, never drops data).
 */

import type { ActivityDetailFormat } from '@folyn/extension-host';
import type { ActivityMetricRow } from '@/services/activity/api';
import type { DisplayIndexEntry } from '@/services/activity/registry';

// ── Builtin event display (core types collectors haven't declared) ───────────

export interface BuiltinEventDisplay {
  icon: string;
  color: ActivityPalette;
  metricId?: string;
}

export type ActivityPalette = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal' | 'gray';

/** Core-native event types (design §4.1) with default icon/color/metric ids. */
export const BUILTIN_EVENT_DISPLAY: Record<string, BuiltinEventDisplay> = {
  commit: { icon: 'git-commit-horizontal', color: 'teal', metricId: 'commit_count' },
  meeting: { icon: 'calendar', color: 'purple', metricId: 'meeting_count' },
  message: { icon: 'message-circle', color: 'blue', metricId: 'active_conversations' },
  doc_edit: { icon: 'file-text', color: 'green', metricId: 'doc_edit_count' },
  task: { icon: 'square-check', color: 'amber', metricId: 'task_update_count' },
};

/** The 6 core metric ids (design §6) — default pinned (design §3.3). */
export const BUILTIN_METRIC_IDS = new Set([
  'commit_count',
  'meeting_count',
  'meeting_minutes',
  'active_conversations',
  'doc_edit_count',
  'task_update_count',
]);

/** Palette key → icon color + tint (design §3.1: fixed keys, no free hex). */
export const ACTIVITY_PALETTE: Record<ActivityPalette, { color: string; bg: string }> = {
  blue: { color: '#1f5fa8', bg: '#e3eefb' },
  green: { color: '#3b6d11', bg: '#eaf5e2' },
  amber: { color: '#854f0b', bg: '#fdf1dd' },
  red: { color: '#a13a2a', bg: '#faece7' },
  purple: { color: '#534ab7', bg: '#eeedfe' },
  teal: { color: '#0f6e56', bg: '#e1f5ee' },
  gray: { color: '#5f5e5a', bg: '#f1efe8' },
};

/** Resolve a palette key with the gray fallback for unknown/missing keys. */
export function paletteOf(key: string | undefined): ActivityPalette {
  return key && key in ACTIVITY_PALETTE ? (key as ActivityPalette) : 'gray';
}

/**
 * Collector-supplied event urls are untrusted (third-party extension data):
 * only http(s) links render the「查看原文」button, and the click routes
 * through the app's external-open path — a `javascript:`/`file:`/etc. url
 * never becomes a clickable href.
 */
export function isExternalUrl(u: string | null | undefined): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

// ── Metric cards (design §3.3 pin/collapse) ──────────────────────────────────

export interface MetricCard {
  id: string;
  label: string;
  value: number;
  /** Builtin 6 default pinned; collector-declared default collapsed. */
  defaultPinned: boolean;
}

/**
 * Map aggregate-metric rows to display cards. Every row yields a count card
 * (collector `metric` declaration or the builtin table); a row with
 * `totalMinutes` additionally yields a minutes card (only `meeting` in
 * practice — the Rust aggregate only sums `payload.minutes`).
 */
export function metricCardsFromRows(
  rows: ActivityMetricRow[],
  displayByType: Record<string, DisplayIndexEntry>,
  builtinLabel: (metricId: string) => string,
  minutesLabel: (metricId: string) => string,
): MetricCard[] {
  const cards: MetricCard[] = [];
  for (const row of rows) {
    const declared = displayByType[row.type]?.metric;
    const builtin = BUILTIN_EVENT_DISPLAY[row.type];
    const metricId = declared?.id ?? builtin?.metricId ?? `${row.type}_count`;
    const isBuiltin = BUILTIN_METRIC_IDS.has(metricId);
    const label = isBuiltin ? builtinLabel(metricId) : (declared?.label ?? row.type);
    cards.push({
      id: metricId,
      label,
      value: row.count,
      defaultPinned: isBuiltin,
    });
    if (row.totalMinutes != null) {
      const minutesId = metricId === 'meeting_count' ? 'meeting_minutes' : `${metricId}_minutes`;
      cards.push({
        id: minutesId,
        label: minutesLabel(minutesId),
        value: Math.round(row.totalMinutes),
        // meeting_minutes is one of the builtin 6 — pinned by default.
        defaultPinned: BUILTIN_METRIC_IDS.has(minutesId),
      });
    }
  }
  return cards;
}

/** Effective pin state: override wins, absent key keeps the default. */
export function effectivePinned(card: MetricCard, overrides: Record<string, boolean>): boolean {
  const o = overrides[card.id];
  return o === undefined ? card.defaultPinned : o;
}

/** Next override map after flipping one card's pin. */
export function togglePinOverride(
  card: MetricCard,
  overrides: Record<string, boolean>,
): Record<string, boolean> {
  const next = { ...overrides, [card.id]: !effectivePinned(card, overrides) };
  // Dropping a no-op override keeps the persisted map minimal.
  if (next[card.id] === card.defaultPinned) delete next[card.id];
  return next;
}

// ── Detail-panel formatters (design §3.1: builtin formats only) ─────────────

/** Format one detail value. Pure — no HTML, no templates. */
export function formatDetailValue(value: unknown, format: ActivityDetailFormat): string {
  if (value == null) return '';
  switch (format) {
    case 'number':
      return typeof value === 'number' ? String(value) : String(value);
    case 'currency': {
      const n = typeof value === 'number' ? value : Number(value);
      // ponytail: fixed ¥ prefix — swap for Intl currency when multi-currency matters.
      return Number.isFinite(n) ? `¥${n}` : String(value);
    }
    case 'date': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return String(value);
      return new Date(n).toLocaleString();
    }
    case 'badge':
      return String(value);
    case 'list':
      return Array.isArray(value) ? value.map((v) => String(v)).join(' · ') : String(value);
    case 'text':
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

// ── Entity graph: grouping + layout + breadcrumb (design §7.2) ──────────────

/** Group neighbors by entity type; ≥2 of a type collapse into one node. */
export interface GraphGroup<T> {
  entityType: string;
  /** All neighbors of this type (the aggregate node's instance list). */
  items: T[];
}

export function groupNeighborsByType<T>(
  neighbors: T[],
  typeOf: (item: T) => string,
): GraphGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const n of neighbors) {
    const t = typeOf(n);
    const list = groups.get(t);
    if (list) list.push(n);
    else groups.set(t, [n]);
  }
  return [...groups.entries()].map(([entityType, items]) => ({ entityType, items }));
}

/** Radial layout knobs (prototype-validated): >8 display items → smaller
 * nodes on a wider orbit. */
export function radialLayoutKnobs(slots: number): { nodeRadius: number; orbitRadius: number } {
  return {
    nodeRadius: slots > 8 ? 32 : 42,
    orbitRadius: 175 + Math.max(0, slots - 8) * 8,
  };
}

/** Breadcrumb collapse: >3 levels → show only [n-2, n-1] plus an ellipsis
 * (design §7.2); expand shows all indices. */
export function breadcrumbIndices(length: number, expanded: boolean): number[] {
  if (expanded || length <= 3) {
    return Array.from({ length }, (_, i) => i);
  }
  return [length - 2, length - 1];
}
