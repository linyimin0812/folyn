/**
 * Dynamic entity-relation browser (design §7.2): one-hop neighbors of the
 * selected center, same-type neighbors (≥2) collapsed into aggregate nodes,
 * static radial layout (canvas fills the pane; the node-count-sized orbit
 * stays compact and centered within it). Clicking a neighbor makes it the
 * new center (refetch); clicking an aggregate node opens the instance list
 * in the right sidebar. Unregistered entity types use the raw type string.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type ActivityEntityRow,
  type ActivityNeighborRow,
  getActivityEntityNeighbors,
  listActivityEntities,
} from '@/services/activity/api';
import { useCollectorRegistryStore } from '@/services/activity/registry';
import { LucideNameIcon } from '@/components/icons/LucideNameIcon';
import { useAsync } from './useActivityData';
import { ACTIVITY_PALETTE, groupNeighborsByType, paletteOf } from './display';

const NODE_W = 148;
const NODE_H = 50;
const CENTER_W = 164;
const CENTER_H = 58;

// Distance from a rectangle's center to its border along a unit vector.
function borderDistance(ux: number, uy: number, width: number, height: number): number {
  return Math.min(width / 2 / Math.abs(ux), height / 2 / Math.abs(uy));
}

interface EntityGraphViewProps {
  vaultRoot: string;
}

export function EntityGraphView({ vaultRoot }: EntityGraphViewProps) {
  const { t } = useTranslation();
  const arrowId = useId();
  const groupButtonRef = useRef<HTMLButtonElement | null>(null);
  // centerHistory holds entity ids; the last entry is the current center.
  const [history, setHistory] = useState<string[]>([]);
  const [groupPanel, setGroupPanel] = useState<string | null>(null);

  const entityTypes = useCollectorRegistryStore((s) => s.entityTypes);

  const { data: entities } = useAsync(
    () => (vaultRoot ? listActivityEntities(vaultRoot) : Promise.resolve([] as ActivityEntityRow[])),
    [vaultRoot],
  );

  // Measured svg box — the canvas always exactly fills the available pane
  // (same width behavior as the timeline), so the group sidebar opening
  // shrinks the graph instead of expanding anything. The orbit itself is
  // sized by node count (below), not by the container — that was what made
  // few-neighbor graphs sprawl.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1100, h: 600 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
    // Re-attach when the graph wrapper actually mounts (early-return states
    // render no wrapper).
  }, [vaultRoot, entities?.length]);

  // ponytail: entity index capped at 500 rows (api.ts) — one fetch resolves
  // every neighbor label; batch-resolve when vaults exceed the cap.
  const byId = useMemo(() => {
    const m = new Map<string, ActivityEntityRow>();
    for (const e of entities ?? []) m.set(e.id, e);
    return m;
  }, [entities]);

  // Default center: the first person entity (the vault owner's actor node).
  useEffect(() => {
    if (history.length > 0 || !entities || entities.length === 0) return;
    const person = entities.find((e) => e.type === 'person');
    if (person) setHistory([person.id]);
  }, [entities, history.length]);

  const centerId = history[history.length - 1] ?? null;

  const { data: neighbors } = useAsync(
    () =>
      vaultRoot && centerId
        ? getActivityEntityNeighbors(vaultRoot, centerId)
        : Promise.resolve([] as ActivityNeighborRow[]),
    [vaultRoot, centerId],
  );

  const typeLabelOf = (typeId: string): string => {
    if (['person', 'meeting', 'repository', 'document', 'task'].includes(typeId)) {
      return t(`activity:entityType.${typeId}`);
    }
    return entityTypes.find((et) => et.id === typeId)?.label ?? typeId;
  };
  /** Icon/color for a type id (registry merges builtin + collector types);
   *  unknown types fall back to the gray dot. */
  const typeDisplayOf = (typeId: string) => entityTypes.find((et) => et.id === typeId);
  const nameOf = (id: string): string => {
    const e = byId.get(id);
    return e?.displayName || e?.identityKey || id;
  };

  const groups = useMemo(
    () => groupNeighborsByType(neighbors ?? [], (n) => byId.get(n.neighborId)?.type ?? '__unknown__'),
    [neighbors, byId],
  );

  // Display items: one per group — aggregate when the group has ≥2 members.
  const displayItems = groups.map((g) => ({
    entityType: g.entityType,
    items: g.items,
    aggregate: g.items.length > 1,
  }));
  const slots = displayItems.length;
  // Orbit sized to the node count (adjacent cards keep a 28px gutter) and
  // capped so few-neighbor graphs stay compact instead of being stretched to
  // the window edges. The canvas hugs the content and centers in the pane.
  const orbit = slots > 1
    ? Math.min(340, Math.max(150, (Math.hypot(NODE_W, NODE_H) + 28) / (2 * Math.sin(Math.PI / slots))))
    : 150;
  const RX = orbit * 1.35;
  const RY = orbit;
  const W = Math.max(box.w, RX * 2 + NODE_W + 48);
  const H = Math.max(box.h, RY * 2 + NODE_H + 48);
  const CX = W / 2;
  const CY = H / 2;

  const closeGroupPanel = () => {
    setGroupPanel(null);
    groupButtonRef.current?.focus();
  };

  const navigateTo = (id: string) => {
    setGroupPanel(null);
    setHistory((h) => [...h, id]);
  };

  if (entities?.length === 0) {
    return (
      <div className="text-[13px] text-t3 bg-panel border border-brd rounded-lg p-8 text-center">
        {t('activity:timeline.empty')}
      </div>
    );
  }

  if (!vaultRoot) {
    return (
      <div className="text-[13px] text-t3 bg-panel border border-brd rounded-lg p-8 text-center">
        {t('activity:noVault')}
      </div>
    );
  }

  const center = centerId ? byId.get(centerId) : undefined;

  // Layout per display item: line endpoints + node card center. Cards are
  // absolutely-positioned HTML overlaid on the svg — foreignObject content
  // doesn't paint reliably in Tauri macOS WKWebView.
  const nodeLayouts = displayItems.map((di, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, slots);
    const nx = CX + RX * Math.cos(angle);
    const ny = CY + RY * Math.sin(angle);
    const dx = nx - CX;
    const dy = ny - CY;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const start = borderDistance(ux, uy, CENTER_W, CENTER_H) + 3;
    const end = borderDistance(ux, uy, NODE_W, NODE_H) + 5;
    return {
      di,
      nx,
      ny,
      startX: CX + start * ux,
      startY: CY + start * uy,
      endX: nx - end * ux,
      endY: ny - end * uy,
    };
  });

  const graph = (
    <div ref={wrapRef} className="flex-1 min-h-0 min-w-0 overflow-auto">
      <div className="relative" style={{ width: W, height: H }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block select-none" aria-hidden="true">
          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke="var(--t3)" strokeWidth="1.2" strokeLinecap="round" />
            </marker>
          </defs>
          {nodeLayouts.map(({ di, startX, startY, endX, endY }) => (
            <g key={di.entityType}>
              <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="var(--brd2)" strokeWidth="1" markerEnd={`url(#${arrowId})`} />
              <text x={(startX + endX) / 2} y={(startY + endY) / 2 - 8} textAnchor="middle" fontSize="11" fill="var(--t3)" stroke="var(--bg)" strokeWidth="5" paintOrder="stroke">
                {di.items[0]?.relation ?? ''}
              </text>
            </g>
          ))}
        </svg>
        {nodeLayouts.map(({ di, nx, ny }) => {
          const label = di.aggregate ? typeLabelOf(di.entityType) : nameOf(di.items[0]!.neighborId);
          const selected = groupPanel === di.entityType;
          const td = typeDisplayOf(di.entityType);
          const pal = ACTIVITY_PALETTE[paletteOf(td?.color)];
          return (
            <button
              key={di.entityType}
              type="button"
              title={label}
              aria-expanded={di.aggregate ? selected : undefined}
              style={{ position: 'absolute', left: nx, top: ny, transform: 'translate(-50%, -50%)', width: NODE_W }}
              className={`flex h-[50px] items-center gap-2 rounded-xl border px-2.5 text-left cursor-pointer shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc ${selected ? 'border-acc bg-accdim' : 'border-brd2 bg-panel hover:border-t3 hover:bg-hov'}`}
              onClick={(event) => {
                if (di.aggregate) {
                  groupButtonRef.current = event.currentTarget;
                  setGroupPanel(selected ? null : di.entityType);
                } else {
                  navigateTo(di.items[0]!.neighborId);
                }
              }}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ background: pal.bg, color: pal.color }}
              >
                {td?.icon ? (
                  <LucideNameIcon name={td.icon} size={14} />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: pal.color }} />
                )}
              </span>
              <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="block w-full truncate text-[13px] font-medium text-t1">{label}</span>
                <span className="flex w-full items-center justify-between gap-2 text-[11px] text-t3">
                  <span className="truncate">{di.aggregate ? t('activity:graph.groupCount', { count: di.items.length }) : typeLabelOf(di.entityType)}</span>
                  {di.aggregate && <span aria-hidden="true">›</span>}
                </span>
              </span>
            </button>
          );
        })}
        {center && (
          <div
            style={{ position: 'absolute', left: CX, top: CY, transform: 'translate(-50%, -50%)', width: CENTER_W, boxShadow: '0 0 0 5px var(--accglow)' }}
            className="flex h-[58px] items-center gap-2.5 rounded-xl border border-acc bg-panel px-3"
            title={nameOf(center.id)}
          >
            <span className="w-8 h-8 rounded-full bg-accdim text-acc flex items-center justify-center shrink-0">
              {typeDisplayOf(center.type)?.icon ? (
                <LucideNameIcon name={typeDisplayOf(center.type)!.icon!} size={16} />
              ) : (
                <span className="w-2 h-2 rounded-full bg-acc" />
              )}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="truncate text-[13px] font-semibold text-t1">{nameOf(center.id)}</span>
              <span className="truncate text-[11px] text-t2">{typeLabelOf(center.type)}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );

  const panelItems = groups.find((g) => g.entityType === groupPanel)?.items ?? [];

  return (
    <div
      className="h-full min-h-0 overflow-hidden flex flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && groupPanel != null) {
          event.stopPropagation();
          closeGroupPanel();
        }
      }}
    >
      <div className="relative flex flex-1 min-h-0 min-w-0">
        <div className="flex flex-1 min-w-0 min-h-0 flex-col">{graph}</div>
        {/* In-flow column: the graph shrinks + recenters (page width is fixed
            by the outer container), and the border-l runs the full row height
            — no overlay, no gap at the bottom. */}
        {groupPanel != null && (
          <aside className="flex w-[260px] max-w-full shrink-0 flex-col self-stretch border-l border-brd bg-bg">
            <div className="flex items-center justify-between gap-2 border-b border-brd px-3 py-2">
              <p className="m-0 min-w-0 text-xs font-medium text-t1">
                {t('activity:graph.groupPanel', { label: typeLabelOf(groupPanel), count: panelItems.length })}
              </p>
              <button
                type="button"
                className="flex size-7 shrink-0 items-center justify-center rounded text-t3 hover:text-t1 hover:bg-hov focus-visible:outline-2 focus-visible:outline-acc cursor-pointer"
                aria-label={t('common:common.close')}
                title={t('common:common.close')}
                onClick={closeGroupPanel}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                  <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto p-1.5">
              {panelItems.map((n) => (
                <button
                  key={n.neighborId}
                  type="button"
                  className="flex w-full flex-col gap-1 rounded px-2.5 py-2.5 text-left cursor-pointer hover:bg-hov focus-visible:outline-2 focus-visible:outline-acc"
                  onClick={() => navigateTo(n.neighborId)}
                >
                  <span className="text-xs leading-5 text-t1 break-all">{nameOf(n.neighborId)}</span>
                  <span className="text-[11px] leading-4 text-t3 break-all">{n.relation}</span>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
