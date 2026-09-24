/**
 * Dynamic entity-relation browser (design §7.2): one-hop neighbors of the
 * selected center, same-type neighbors (≥2) collapsed into aggregate nodes,
 * static radial layout (canvas fills the pane; the node-count-sized orbit
 * stays compact and centered within it). Clicking a neighbor makes it the
 * new center (refetch); clicking an aggregate node expands its member
 * instances in the graph as a fan around it (click again to collapse).
 * Unregistered entity types use the raw type string.
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
// Drag-pan slack: the scroll container only extends to the content div's
// layout box (transforms don't grow it), so the content sits centered inside
// a larger layout box. Pans up to ±PAN_PAD stay inside it — no clipping.
const PAN_PAD = 600;

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
  // centerHistory holds entity ids; the last entry is the current center.
  const [history, setHistory] = useState<string[]>([]);
  // entityType key of the aggregate node whose members are expanded in-graph.
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const entityTypes = useCollectorRegistryStore((s) => s.entityTypes);

  const { data: entities } = useAsync(
    () => (vaultRoot ? listActivityEntities(vaultRoot) : Promise.resolve([] as ActivityEntityRow[])),
    [vaultRoot],
  );

  // Measured svg box — the canvas always exactly fills the available pane
  // (same width behavior as the timeline). The orbit itself is
  // sized by node count (below), not by the container — that was what made
  // few-neighbor graphs sprawl.
  const wrapRef = useRef<HTMLDivElement>(null);
  // Drag-to-pan state: panRef carries the drag math; `dragging` only drives
  // the cursor class. Drags starting inside a button (node/member cards are
  // <button>s) are ignored so card clicks keep working. Panning translates
  // the content (the canvas usually exactly fits the pane, so scrollLeft/
  // scrollTop have nothing to move).
  const panRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    panRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = panRef.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const dx = e.clientX - p.lastX;
    const dy = e.clientY - p.lastY;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    setPan((pan) => ({
      x: Math.max(-PAN_PAD, Math.min(PAN_PAD, pan.x + dx)),
      y: Math.max(-PAN_PAD, Math.min(PAN_PAD, pan.y + dy)),
    }));
  };
  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = panRef.current;
    if (!p || p.pointerId !== e.pointerId) return;
    panRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };
  const [box, setBox] = useState({ w: 1100, h: 600 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    // Content sits at PAN_PAD inside the padded layout box — start scrolled
    // there so pan=0 shows the graph at the viewport origin.
    el.scrollLeft = PAN_PAD;
    el.scrollTop = PAN_PAD;
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

  // Default center: the local-user anchor. The 'self' person is where
  // window-activity and other local collectors attach; remote-service actors
  // (e.g. github logins) are separate person entities, reachable by click.
  useEffect(() => {
    if (history.length > 0 || !entities || entities.length === 0) return;
    const person =
      entities.find((e) => e.type === 'person' && e.identityKey === 'self') ??
      entities.find((e) => e.type === 'person');
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

  const navigateTo = (id: string) => {
    setExpandedGroup(null);
    setPan({ x: 0, y: 0 });
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

  // Expanded group: members fan out around the aggregate node, spread
  // symmetrically around the outward (canvas-center → node) direction.
  const expandedLayout =
    expandedGroup == null ? null : nodeLayouts.find((nl) => nl.di.entityType === expandedGroup) ?? null;
  const FAN_R = 120;
  const MAX_SPREAD = (150 * Math.PI) / 180;
  const memberLayouts = (() => {
    if (!expandedLayout) return [] as { n: ActivityNeighborRow; x: number; y: number }[];
    const { nx, ny } = expandedLayout;
    const items = expandedLayout.di.items;
    const outward = Math.atan2(ny - CY, nx - CX);
    // Card extent along the fan's tangent + gutter — minimum adjacent
    // center spacing. ponytail: measured at the outward direction only;
    // extreme fan members can still graze on wide horizontal fans.
    const need = Math.abs(NODE_W * -Math.sin(outward)) + Math.abs(NODE_H * Math.cos(outward)) + 14;
    const idealStep = 2 * Math.asin(Math.min(1, need / (2 * FAN_R)));
    const cappedStep = MAX_SPREAD / Math.max(1, items.length - 1);
    const step = Math.min(idealStep, cappedStep);
    // Radius only grows when the capped spread can't keep cards apart.
    const fanR = step < idealStep ? need / (2 * Math.sin(cappedStep / 2)) : FAN_R;
    const spread = step * (items.length - 1);
    return items.map((n, i) => {
      const angle = outward - spread / 2 + step * i;
      return { n, x: nx + fanR * Math.cos(angle), y: ny + fanR * Math.sin(angle) };
    });
  })();

  // No clipping: base layout fits W×H by construction; expanded members may
  // not. Shift all content by (dx,dy) so it clears the origin and grow the
  // scroll area to the required size. One translated wrapper holds svg +
  // HTML overlay so both coordinate systems stay in sync.
  const PAD = 48;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of memberLayouts) {
    minX = Math.min(minX, m.x - NODE_W / 2);
    minY = Math.min(minY, m.y - NODE_H / 2);
    maxX = Math.max(maxX, m.x + NODE_W / 2);
    maxY = Math.max(maxY, m.y + NODE_H / 2);
  }
  const dx = Number.isFinite(minX) ? Math.max(0, PAD - minX) : 0;
  const dy = Number.isFinite(minY) ? Math.max(0, PAD - minY) : 0;
  const contentW = Number.isFinite(maxX) ? Math.max(W, maxX + dx + PAD) : W;
  const contentH = Number.isFinite(maxY) ? Math.max(H, maxY + dy + PAD) : H;

  const graph = (
    <div
      ref={wrapRef}
      className={`flex-1 min-h-0 min-w-0 overflow-auto cursor-grab select-none ${dragging ? 'cursor-grabbing' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div className="relative" style={{ width: contentW + 2 * PAN_PAD, height: contentH + 2 * PAN_PAD }}>
        <div
          className="absolute"
          style={{ left: PAN_PAD, top: PAN_PAD, width: contentW, height: contentH, transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <div className="absolute top-0 left-0" style={{ width: W, height: H, transform: `translate(${dx}px, ${dy}px)` }}>
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
              {expandedLayout &&
                memberLayouts.map(({ n, x, y }) => (
                  // Aggregate → member: covered by both HTML cards at the ends.
                  <line key={n.neighborId} x1={expandedLayout.nx} y1={expandedLayout.ny} x2={x} y2={y} stroke="var(--brd2)" strokeWidth="1" />
                ))}
            </svg>
            {nodeLayouts.map(({ di, nx, ny }) => {
              const label = di.aggregate ? typeLabelOf(di.entityType) : nameOf(di.items[0]!.neighborId);
              const selected = expandedGroup === di.entityType;
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
                  onClick={() => {
                    if (di.aggregate) {
                      setExpandedGroup(selected ? null : di.entityType);
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
            {expandedLayout &&
              memberLayouts.map(({ n, x, y }) => {
                const td = typeDisplayOf(expandedLayout.di.entityType);
                const pal = ACTIVITY_PALETTE[paletteOf(td?.color)];
                return (
                  <button
                    key={n.neighborId}
                    type="button"
                    title={n.relation}
                    style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%, -50%)', width: NODE_W }}
                    className="flex h-[50px] items-center gap-2 rounded-xl border border-brd2 bg-panel px-2.5 text-left cursor-pointer shadow-sm transition-shadow hover:shadow-md hover:border-t3 hover:bg-hov focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                    onClick={() => navigateTo(n.neighborId)}
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
                      <span className="block w-full truncate text-[13px] font-medium text-t1">{nameOf(n.neighborId)}</span>
                      <span className="block w-full truncate text-[11px] text-t3">{n.relation}</span>
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
      </div>
    </div>
  );

  return (
    <div
      className="h-full min-h-0 overflow-hidden flex flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expandedGroup != null) {
          event.stopPropagation();
          setExpandedGroup(null);
        }
      }}
    >
      <div className="flex flex-1 min-h-0 min-w-0">
        <div className="flex flex-1 min-w-0 min-h-0 flex-col">{graph}</div>
      </div>
    </div>
  );
}
