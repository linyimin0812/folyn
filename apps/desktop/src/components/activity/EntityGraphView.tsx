/**
 * Dynamic entity-relation browser (design §7.2): one-hop neighbors of the
 * selected center, same-type neighbors (≥2) collapsed into aggregate nodes,
 * static radial layout (canvas fills the pane; each node sits on its own
 * radius so every edge shows the same visible length, centered in it). Clicking a neighbor makes it the
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
import { useAsync, useEnabledSources } from './useActivityData';
import { ACTIVITY_PALETTE, groupNeighborsByType, paletteOf } from './display';

const NODE_W = 148;
const NODE_H = 50;
const CENTER_W = 164;
const CENTER_H = 58;
// Drag-pan slack (vertical only): the scroll container clips horizontally
// (overflow-x hidden) and the layout box only adds vertical padding, so pans
// up to ±PAN_PAD stay reachable — horizontal panning is transform-only.
const PAN_PAD = 600;

// Distance from a rectangle's center to its border along a unit vector.
function borderDistance(ux: number, uy: number, width: number, height: number): number {
  return Math.min(width / 2 / Math.abs(ux), height / 2 / Math.abs(uy));
}

// Visible line length every center→node edge gets (chord between the trimmed
// endpoints, before the 3+5 insets cancel out against the +8 below).
const EDGE_LEN = 110;
// Center-to-center angular gap between adjacent node cards.
const GUTTER = 36;

// Node-center radius for a slot direction: center border + visible edge +
// node border + 8 (absorbs the 3+5 endpoint insets) → every edge shows the
// same EDGE_LEN regardless of direction, unlike the old fixed ellipse where
// horizontal edges lost ~164px to card borders and vertical ones only ~62px.
const slotRadius = (theta: number): number =>
  borderDistance(Math.cos(theta), Math.sin(theta), CENTER_W, CENTER_H) +
  EDGE_LEN +
  borderDistance(Math.cos(theta), Math.sin(theta), NODE_W, NODE_H) +
  8;

// Half-extent of a node card along the tangent at direction theta.
const tangentExtent = (theta: number): number =>
  (NODE_W / 2) * Math.abs(Math.sin(theta)) + (NODE_H / 2) * Math.abs(Math.cos(theta));

interface EntityGraphViewProps {
  vaultRoot: string;
}

export function EntityGraphView({ vaultRoot }: EntityGraphViewProps) {
  const { t } = useTranslation();
  const arrowId = useId();
  // centerHistory holds entity ids; the last entry is the current center.
  const [history, setHistory] = useState<string[]>([]);
  // entityType keys of the aggregate nodes whose members are expanded in-graph
  // (multiple groups may be expanded at once, each toggling only itself).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const entityTypes = useCollectorRegistryStore((s) => s.entityTypes);

  const { data: entities } = useAsync(
    () => (vaultRoot ? listActivityEntities(vaultRoot) : Promise.resolve([] as ActivityEntityRow[])),
    [vaultRoot],
  );

  // Measured svg box — the canvas always exactly fills the available pane
  // (same width behavior as the timeline). Node radii come from the constant
  // edge length (below), not the container — container-sized orbits made
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
    // Content sits at PAN_PAD from the top of the padded layout box — start
    // scrolled there so pan=0 shows the graph at the viewport top. No
    // horizontal padding (layout box width = contentW) and overflow-x is
    // hidden: horizontal panning is transform-only, no horizontal scrollbar.
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

  // Edges from disabled collectors are hidden (same include-list as the
  // timeline/metrics reads); toggling a collector refetches the neighbors.
  const enabledSources = useEnabledSources();
  const sourcesKey = enabledSources.join(',');

  const { data: neighbors } = useAsync(
    () =>
      vaultRoot && centerId
        ? getActivityEntityNeighbors(vaultRoot, centerId, enabledSources)
        : Promise.resolve([] as ActivityNeighborRow[]),
    [vaultRoot, centerId, sourcesKey],
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

  // Neighbor rows are per (entity, relation) — one entity with several
  // relation types would yield duplicate React keys in the fan. Collapse to
  // one row per entity, keeping the highest-score (first) row's relation.
  const uniqueNeighbors = useMemo(() => {
    const seen = new Set<string>();
    return (neighbors ?? []).filter((n) => {
      if (seen.has(n.neighborId)) return false;
      seen.add(n.neighborId);
      return true;
    });
  }, [neighbors]);

  const groups = useMemo(
    () => groupNeighborsByType(uniqueNeighbors, (n) => byId.get(n.neighborId)?.type ?? '__unknown__'),
    [uniqueNeighbors, byId],
  );

  // Display items: one per group — aggregate when the group has ≥2 members.
  const displayItems = groups.map((g) => ({
    entityType: g.entityType,
    items: g.items,
    aggregate: g.items.length > 1,
  }));
  const slots = displayItems.length;
  // Tangential-footprint-weighted angles: each slot gets a share of 2π
  // proportional to (card tangential extent + gutter) / radius, so wide
  // horizontal slots take more angle than narrow vertical ones. First slot
  // sits at θ=-π/2 (straight up).
  // ponytail: one-pass proportional — weights are measured at uniform seed
  // angles, not the final ones, so adjacent gaps are near-constant, not exact.
  const angles: number[] =
    slots === 1
      ? [-Math.PI / 2]
      : (() => {
          const seed = Array.from({ length: slots }, (_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / slots);
          const weights = seed.map((th) => (2 * tangentExtent(th) + GUTTER) / slotRadius(th));
          const total = weights.reduce((a, b) => a + b, 0);
          if (total <= 0) return seed; // guard: uniform fallback
          let acc = -Math.PI / 2;
          return weights.map((wi) => {
            const th = acc;
            acc += (wi / total) * 2 * Math.PI;
            return th;
          });
        })();
  const radii = angles.map(slotRadius);
  // Canvas sized from the actual radii: every node (card included) fits W×H
  // by construction; the canvas also never shrinks below the pane (box).
  const maxAx = radii.length ? Math.max(...radii.map((r, i) => r * Math.abs(Math.cos(angles[i]!)))) : 0;
  const maxAy = radii.length ? Math.max(...radii.map((r, i) => r * Math.abs(Math.sin(angles[i]!)))) : 0;
  const W = Math.max(box.w, 2 * maxAx + NODE_W + 48);
  const H = Math.max(box.h, 2 * maxAy + NODE_H + 48);
  const CX = W / 2;
  const CY = H / 2;

  const navigateTo = (id: string) => {
    setExpandedGroups(new Set());
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
    const angle = angles[i] ?? -Math.PI / 2;
    const r = radii[i] ?? slotRadius(angle);
    const nx = CX + r * Math.cos(angle);
    const ny = CY + r * Math.sin(angle);
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

  // Expanded groups: members fan out around each aggregate node, spread
  // symmetrically around the outward (canvas-center → node) direction.
  // 170 ≥ 74 (member half-width) + 74 (aggregate half-width) + 22 gutter —
  // members can never overlap the aggregate card and steal its collapse click.
  const FAN_R = 170;
  // Tighter fan cone: members render after the radial node buttons in DOM, so
  // any remaining overlap with another aggregate card resolves in favor of
  // the radial node button via zIndex below (fan members stay clickable
  // otherwise).
  const MAX_SPREAD = (110 * Math.PI) / 180;
  // Fan of member positions around a given expanded aggregate node layout.
  const fanOf = (nl: (typeof nodeLayouts)[number]) => {
    const { nx, ny } = nl;
    const items = nl.di.items;
    const outward = Math.atan2(ny - CY, nx - CX);
    // Card extent along the fan's tangent + gutter — minimum adjacent
    // center spacing. ponytail: measured at the outward direction only;
    // extreme fan members can still graze on wide horizontal fans.
    const need = Math.abs(NODE_W * -Math.sin(outward)) + Math.abs(NODE_H * Math.cos(outward)) + 14;
    const idealStep = 2 * Math.asin(Math.min(1, need / (2 * FAN_R)));
    const cappedStep = MAX_SPREAD / Math.max(1, items.length - 1);
    const step = Math.min(idealStep, cappedStep);
    // Radius only grows when the capped spread can't keep cards apart, and
    // never drops below FAN_R (member cards stay clear of the aggregate).
    const fanR = Math.max(FAN_R, step < idealStep ? need / (2 * Math.sin(cappedStep / 2)) : FAN_R);
    const spread = step * (items.length - 1);
    return items.map((n, i) => {
      const angle = outward - spread / 2 + step * i;
      return { n, x: nx + fanR * Math.cos(angle), y: ny + fanR * Math.sin(angle) };
    });
  };
  const fans = nodeLayouts
    .filter((nl) => expandedGroups.has(nl.di.entityType))
    .map((nl) => ({ nl, members: fanOf(nl) }));

  // Extents are computed from ALL potential fan members, not just the
  // expanded ones: Tauri's WKWebView leaves stale paint from unmounting fan
  // cards when the collapse also shifts ancestor geometry (dx/dy, svg size).
  // Keeping dx/dy/contentW/contentH constant per graph (they only change when
  // center/neighbors/box change) means toggling a group only mounts/unmounts
  // member cards — nothing else reflows. Side effect: the scroll region is
  // always sized for all fans, even fully collapsed.
  const allFanMembers = nodeLayouts
    .filter((nl) => nl.di.aggregate)
    .flatMap((nl) => fanOf(nl));

  // No clipping: base layout fits W×H by construction; expanded members may
  // not. Shift all content by (dx,dy) so it clears the origin and grow the
  // scroll area to the required size. One translated wrapper holds svg +
  // HTML overlay so both coordinate systems stay in sync.
  const PAD = 48;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of allFanMembers) {
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
      className={`flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto cursor-grab select-none ${dragging ? 'cursor-grabbing' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div className="relative" style={{ width: contentW, height: contentH + 2 * PAN_PAD }}>
        <div
          className="absolute"
          style={{ left: 0, top: PAN_PAD, width: contentW, height: contentH, transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <div className="absolute top-0 left-0" style={{ width: W, height: H, transform: `translate(${dx}px, ${dy}px)` }}>
            <svg
              width={contentW}
              height={contentH}
              viewBox={`${-dx} ${-dy} ${contentW} ${contentH}`}
              className="block select-none"
              aria-hidden="true"
              style={{ position: 'absolute', left: -dx, top: -dy }}
            >
              <defs>
                {/* markerUnits=strokeWidth: 1.5 stroke × 4 = 6px arrow — grows with the thicker line; refX=8 keeps the tip on the node border. */}
                <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M2 1L8 5L2 9" fill="none" stroke="var(--t2)" strokeWidth="1.5" strokeLinecap="round" />
                </marker>
              </defs>
              {nodeLayouts.map(({ di, startX, startY, endX, endY }) => {
                const relation = di.items[0]?.relation ?? '';
                // Quadratic bezier: control point = edge midpoint pushed
                // perpendicular (+90° rotation of the direction) by 12% of
                // the edge length; endpoints unchanged so the arrow marker
                // still lands on the node border.
                const ex = endX - startX;
                const ey = endY - startY;
                const cxp = (startX + endX) / 2 - ey * 0.12;
                const cyp = (startY + endY) / 2 + ex * 0.12;
                // Bezier t=0.5 point: 0.25·P0 + 0.5·C + 0.25·P1. The pill is
                // opaque and sits ON TOP of the continuous line.
                const mx = 0.25 * startX + 0.5 * cxp + 0.25 * endX;
                const my = 0.25 * startY + 0.5 * cyp + 0.25 * endY;
                // ponytail: CJK chars are ~full-width at 9px — 9px/char + 12
                // padding; Latin slightly over-estimated, fine.
                // ponytail: pill width capped at 96 (EDGE_LEN=110 keeps the
                // line visible past it); long relation text overflows the
                // pill naturally — no truncation added.
                const pillW = Math.min(96, relation.length * 9 + 12);
                return (
                  <g key={di.entityType}>
                    <path
                      d={`M${startX} ${startY} Q${cxp} ${cyp} ${endX} ${endY}`}
                      fill="none"
                      stroke="var(--t2)"
                      strokeWidth="1.5"
                      markerEnd={`url(#${arrowId})`}
                    />
                    {relation !== '' && (
                      <g transform={`translate(${mx} ${my})`}>
                        <rect x={-pillW / 2} y={-7} width={pillW} height={14} rx={5} fill="var(--panel)" stroke="var(--brd2)" strokeWidth="1" />
                        <text textAnchor="middle" dominantBaseline="central" fontSize="9" fill="var(--t3)">
                          {relation}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
              {fans.map(({ nl, members }) =>
                members.map(({ n, x, y }) => (
                  // Aggregate → member: covered by both HTML cards at the ends.
                  <line key={n.neighborId} x1={nl.nx} y1={nl.ny} x2={x} y2={y} stroke="var(--t2)" strokeWidth="1.5" />
                )),
              )}
            </svg>
            {nodeLayouts.map(({ di, nx, ny }) => {
              const label = di.aggregate ? typeLabelOf(di.entityType) : nameOf(di.items[0]!.neighborId);
              const selected = expandedGroups.has(di.entityType);
              const td = typeDisplayOf(di.entityType);
              const pal = ACTIVITY_PALETTE[paletteOf(td?.color)];
              return (
                <button
                  key={di.entityType}
                  type="button"
                  title={label}
                  aria-expanded={di.aggregate ? selected : undefined}
                  // Orbit nodes sit above fan member cards (which render after
                  // in DOM): an overlapped aggregate B must win the click over
                  // an expanded-A member, or B never expands.
                  // Left/top (not a centering transform) so Tailwind's hover
                  // translate isn't overridden by an inline transform.
                  style={{ position: 'absolute', left: nx - NODE_W / 2, top: ny - NODE_H / 2, width: NODE_W, ...(selected ? { zIndex: 10 } : { zIndex: 5 }) }}
                  className={`flex h-[50px] items-center gap-2 rounded-lg border px-2 text-left cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,.04)] transition hover:-translate-y-px hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc ${selected ? 'border-acc bg-accdim' : 'border-brd2 bg-panel hover:border-t3 hover:bg-hov'}`}
                  onClick={() => {
                    if (di.aggregate) {
                      setExpandedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(di.entityType)) next.delete(di.entityType);
                        else next.add(di.entityType);
                        return next;
                      });
                    } else {
                      navigateTo(di.items[0]!.neighborId);
                    }
                  }}
                >
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: pal.bg, color: pal.color }}
                  >
                    {td?.icon ? (
                      <LucideNameIcon name={td.icon} size={12} />
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
            {fans.map(({ nl, members }) => {
              const td = typeDisplayOf(nl.di.entityType);
              const pal = ACTIVITY_PALETTE[paletteOf(td?.color)];
              return members.map(({ n, x, y }) => (
                <button
                  key={n.neighborId}
                  type="button"
                  title={n.relation}
                  style={{ position: 'absolute', left: x - NODE_W / 2, top: y - NODE_H / 2, width: NODE_W }}
                  className="flex h-[50px] items-center gap-2 rounded-lg border border-brd2 bg-panel px-2 text-left cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,.04)] transition hover:-translate-y-px hover:shadow-sm hover:border-t3 hover:bg-hov focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                  onClick={() => navigateTo(n.neighborId)}
                >
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: pal.bg, color: pal.color }}
                  >
                    {td?.icon ? (
                      <LucideNameIcon name={td.icon} size={12} />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: pal.color }} />
                    )}
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="block w-full truncate text-[13px] font-medium text-t1">{nameOf(n.neighborId)}</span>
                    <span className="block w-full truncate text-[11px] text-t3">{n.relation}</span>
                  </span>
                </button>
              ));
            })}
            {center && (
              <div
                style={{ position: 'absolute', left: CX - CENTER_W / 2, top: CY - CENTER_H / 2, width: CENTER_W, boxShadow: '0 0 0 1px var(--acc), 0 0 12px 0 var(--accglow)' }}
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
        if (event.key === 'Escape' && expandedGroups.size > 0) {
          event.stopPropagation();
          setExpandedGroups(new Set());
        }
      }}
    >
      <div className="flex flex-1 min-h-0 min-w-0">
        <div className="flex flex-1 min-w-0 min-h-0 flex-col">{graph}</div>
      </div>
    </div>
  );
}
