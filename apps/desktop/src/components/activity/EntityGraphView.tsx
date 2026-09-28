/**
 * Dynamic entity-relation browser (design §7.2): one-hop neighbors of the
 * selected center, same-type neighbors (≥2) collapsed into aggregate nodes,
 * static radial layout (canvas fills the pane; each node sits on its own
 * radius so every edge shows the same visible length, centered in it). Clicking a neighbor makes it the
 * new center (refetch, full re-layout); clicking an aggregate node with ≤5
 * members expands them IN-CANVAS as fan children around the aggregate (click
 * again to collapse), bigger groups list their members in the right side
 * panel.
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
// Groups above this list their members in the right side panel (opened by
// clicking the aggregate card); groups at or below it expand IN-CANVAS on
// click: members become full-size node
// cards in an outward arc around the aggregate card (ARC_STEP spans at most
// ±135° — see ARC_STEP). The angle solver reserves the arc's symmetric
// tangential extent (FAN_EXTENT) for the expanded slot.
const PANEL_MAX = 5;
// Target visible connector length (main edges show EDGE_LEN=110; child
// spokes one level shorter).
const CHILD_LINE = 90;
// Outward arc: children at ARC_STEP around the parent's outward radial
// direction (k=5 spans exactly ±135°; fewer members = narrower arc). The
// ±135° cap keeps children off the inward radial line — the center edge is
// never occluded and no child points at the center, so no orbit-radius floor
// is needed. Per-child distance is direction-dependent
// (2·borderDistance + CHILD_LINE): AABB-separated from the parent on the
// child's own axis, uniform ~84px visible connector.
const ARC_STEP = (3 * Math.PI) / 8; // 67.5°
// Worst tangential reach of the arc (max d · sin135° + card half), used by
// the angle solver's reservation.
const FAN_EXTENT = (NODE_W + CHILD_LINE) * Math.SQRT1_2 + NODE_W / 2;

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
  /** Same window as the timeline — the graph shows only relations whose
   *  events fall inside it, so the two views stay consistent. */
  range: { from: number; to: number };
}

export function EntityGraphView({ vaultRoot, range }: EntityGraphViewProps) {
  const { t } = useTranslation();
  const arrowId = useId();
  // centerHistory holds entity ids; the last entry is the current center.
  const [history, setHistory] = useState<string[]>([]);
  // entityType keys of the aggregate nodes whose members are listed in the
  // right side panel (groups > PANEL_MAX).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // entityType keys of the aggregate nodes expanded IN-CANVAS as fan children
  // (groups ≤ PANEL_MAX; multiple groups may be expanded at once, each
  // toggling only itself).
  const [fanGroups, setFanGroups] = useState<Set<string>>(new Set());

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
  // The date range matches the timeline's period picker.
  const enabledSources = useEnabledSources();
  const sourcesKey = enabledSources.join(',');
  const rangeKey = `${range.from}:${range.to}`;

  const { data: neighbors } = useAsync(
    () =>
      vaultRoot && centerId
        ? getActivityEntityNeighbors(vaultRoot, centerId, enabledSources, range)
        : Promise.resolve([] as ActivityNeighborRow[]),
    [vaultRoot, centerId, sourcesKey, rangeKey],
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
  // relation types would yield duplicate React keys in the member panel.
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
  const isFanOpen = (di: { entityType: string; items: unknown[]; aggregate: boolean }): boolean =>
    di.aggregate && di.items.length <= PANEL_MAX && fanGroups.has(di.entityType);
  const hasFan = displayItems.some(isFanOpen);
  // Angular allocation: the gap two adjacent cards need depends on their
  // FINAL angles (card tangential extent at that orientation + orbit radius),
  // which depend on the gaps — solved by fixed-point iteration. The required
  // gaps are exact (verified against the real card rects each iteration); the
  // orbit radius only grows when the gaps can't fit in 2π (≥ ~8 slots). The
  // old one-pass proportional split measured weights at the uniform seed
  // angles, leaving wrap-around gaps ~40° where cards need ~65° — cards
  // overlapped (4 groups was already enough).
  // First slot sits at θ=-π/2 (straight up).
  const { angles, rScale } = (() => {
    const a0 = Array.from({ length: slots }, (_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / slots);
    let a = a0;
    let rScale = 1;
    const pos = (i: number) => {
      const th = a[i]!;
      const r = rScale * slotRadius(th);
      return { x: r * Math.cos(th), y: r * Math.sin(th) };
    };
    const overlaps = () => {
      const p = Array.from({ length: slots }, (_, i) => pos(i));
      for (let i = 0; i < slots; i++)
        for (let j = i + 1; j < slots; j++)
          if (Math.abs(p[i]!.x - p[j]!.x) < NODE_W && Math.abs(p[i]!.y - p[j]!.y) < NODE_H) return true;
      return false;
    };
    // The fan is an arc symmetric around the slot's angle: flat worst-case
    // tangential reach (max child offset · sin135° + card half).
    const extOf = (j: number): number => {
      const di = displayItems[j];
      if (di && isFanOpen(di)) return FAN_EXTENT;
      return tangentExtent(a[j]!);
    };
    // Without fans: only iterate when cards actually overlap — the uniform
    // seed distribution is kept as-is on sparse orbits. With fans: at least
    // one pass even without overlap, because the fan reservation below must
    // apply (overlaps() only sees orbit cards).
    for (let iter = 0; iter < 24 && (overlaps() || (hasFan && iter === 0)); iter++) {
      const gaps: number[] = [];
      let sum = 0;
      for (let i = 0; i < slots; i++) {
        const th1 = a[i]!;
        const th2 = i + 1 < slots ? a[i + 1]! : a[0]! + 2 * Math.PI;
        const mid = (th1 + th2) / 2;
        const rBar = (rScale * (slotRadius(th1) + slotRadius(th2))) / 2;
        const next = i + 1 < slots ? i + 1 : 0;
        // Original formula when neither endpoint is fanned (midpoint extent);
        // a fanned endpoint claims its symmetric arc extent instead.
        const need = isFanOpen(displayItems[i]!) || isFanOpen(displayItems[next]!)
          ? extOf(i) + extOf(next) + GUTTER
          : 2 * tangentExtent(mid) + GUTTER;
        const gap = 2 * Math.asin(Math.min(1, need / (2 * rBar)));
        gaps.push(gap);
        sum += gap;
      }
      if (sum > 2 * Math.PI) {
        // Gaps can't fit the orbit: grow the radius (required gap ~ 1/r) and
        // re-measure.
        rScale *= (sum / (2 * Math.PI)) * 1.05;
        continue;
      }
      // Distribute the leftover angle evenly so gaps stay near-constant.
      const extra = (2 * Math.PI - sum) / slots;
      let acc = -Math.PI / 2;
      a = gaps.map((g) => {
        const th = acc;
        acc += g + extra;
        return th;
      });
    }
    return { angles: slots === 1 ? [-Math.PI / 2] : a, rScale };
  })();
  const radii = angles.map((th) => rScale * slotRadius(th));
  // Fan children per expanded aggregate group, center-relative (their extent
  // must be able to grow the canvas below). Child angle = slot angle +
  // (j − mid)·ARC_STEP around the aggregate's outward radial direction;
  // distance is direction-dependent (2·borderDistance + CHILD_LINE).
  const fanRel = displayItems.flatMap((di, i) => {
    if (!isFanOpen(di)) return [];
    const angle = angles[i] ?? -Math.PI / 2;
    const r = radii[i] ?? slotRadius(angle);
    const arx = r * Math.cos(angle);
    const ary = r * Math.sin(angle);
    const mid = (di.items.length - 1) / 2;
    return di.items.map((item, j) => {
      const theta = angle + (j - mid) * ARC_STEP;
      const d = 2 * borderDistance(Math.cos(theta), Math.sin(theta), NODE_W, NODE_H) + CHILD_LINE;
      return {
        item,
        entityType: di.entityType,
        arx,
        ary,
        ox: arx + d * Math.cos(theta),
        oy: ary + d * Math.sin(theta),
      };
    });
  });
  // Canvas sized from the actual radii: every node (card included) fits W×H
  // by construction; the canvas also never shrinks below the pane (box).
  // Fan child offsets are folded in so expansions never clip.
  const maxAx = radii.length
    ? Math.max(...radii.map((r, i) => r * Math.abs(Math.cos(angles[i]!))), ...fanRel.map((c) => Math.abs(c.ox)))
    : 0;
  const maxAy = radii.length
    ? Math.max(...radii.map((r, i) => r * Math.abs(Math.sin(angles[i]!))), ...fanRel.map((c) => Math.abs(c.oy)))
    : 0;
  const W = Math.max(box.w, 2 * maxAx + NODE_W + 48);
  const H = Math.max(box.h, 2 * maxAy + NODE_H + 48);
  const CX = W / 2;
  const CY = H / 2;

  const navigateTo = (id: string) => {
    setExpandedGroups(new Set());
    setFanGroups(new Set());
    setPan({ x: 0, y: 0 });
    setHistory((h) => [...h, id]);
  };
  // Pops the center history one level (back toward the root 'self' center).
  const goBack = () => {
    setExpandedGroups(new Set());
    setFanGroups(new Set());
    setPan({ x: 0, y: 0 });
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
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

  // Fan children at absolute positions: full-size member cards in the
  // outward arc around their aggregate card (ax, ay).
  const fanChildren = fanRel.map((c) => ({
    ...c,
    ax: CX + c.arx,
    ay: CY + c.ary,
    cx: CX + c.ox,
    cy: CY + c.oy,
  }));

  // Groups > PANEL_MAX keep the right member panel; smaller ones expand
  // in-canvas (fanChildren above).
  const panelGroup = nodeLayouts.find(
    (nl) => expandedGroups.has(nl.di.entityType) && nl.di.aggregate,
  );

  // No canvas fan members: the scroll region is exactly the base canvas box.
  const dx = 0;
  const dy = 0;
  const contentW = W;
  const contentH = H;

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
              {/* Fan spokes: aggregate → child connectors (quadratic bezier
                  trimmed at both card borders, bowed away from the
                  aggregate's outward radial direction). */}
              {fanChildren.map((c) => {
                const { ax, ay, cx, cy, item } = c;
                const dxs = cx - ax;
                const dys = cy - ay;
                const len = Math.hypot(dxs, dys) || 1;
                const ux = dxs / len;
                const uy = dys / len;
                const start = borderDistance(ux, uy, NODE_W, NODE_H) + 3;
                const end = borderDistance(ux, uy, NODE_W, NODE_H) + 3;
                const x1 = ax + start * ux;
                const y1 = ay + start * uy;
                const x2 = cx - end * ux;
                const y2 = cy - end * uy;
                // Bow away from the center's radial line through the
                // aggregate: side of the child chord relative to that radial
                // direction (cross product).
                const seed = item.neighborId.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
                const rx = ax - CX;
                const ry = ay - CY;
                const cross = rx * (cy - ay) - ry * (cx - ax);
                const dir = cross === 0 ? (seed % 2 === 0 ? 1 : -1) : Math.sign(cross);
                const mag = dir * (0.08 + (seed % 3) * 0.03) * len; // 8–14% of chord
                const ex = x2 - x1;
                const ey = y2 - y1;
                const cxp = (x1 + x2) / 2 - (ey / len) * mag;
                const cyp = (y1 + y2) / 2 + (ex / len) * mag;
                const relation = item.relation ?? '';
                // Same pill formula/rationale as the node edges above.
                const pillW = Math.min(96, relation.length * 9 + 12);
                // Bezier t=0.5 point: 0.25·P0 + 0.5·C + 0.25·P1.
                const mx = 0.25 * x1 + 0.5 * cxp + 0.25 * x2;
                const my = 0.25 * y1 + 0.5 * cyp + 0.25 * y2;
                return (
                  <g key={item.neighborId}>
                    <path
                      d={`M${x1} ${y1} Q${cxp} ${cyp} ${x2} ${y2}`}
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
            </svg>
            {nodeLayouts.map(({ di, nx, ny }) => {
              const label = di.aggregate ? typeLabelOf(di.entityType) : nameOf(di.items[0]!.neighborId);
              const selected = di.aggregate && (expandedGroups.has(di.entityType) || fanGroups.has(di.entityType));
              const td = typeDisplayOf(di.entityType);
              const pal = ACTIVITY_PALETTE[paletteOf(td?.color)];
              return (
                <button
                  key={di.entityType}
                  type="button"
                  title={label}
                  aria-expanded={di.aggregate ? selected : undefined}
                  // Left/top (not a centering transform) so Tailwind's hover
                  // translate isn't overridden by an inline transform.
                  style={{ position: 'absolute', left: nx - NODE_W / 2, top: ny - NODE_H / 2, width: NODE_W }}
                  className={`flex h-[50px] items-center gap-2 rounded-lg border px-2 text-left cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,.04)] transition hover:-translate-y-px hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc ${selected ? 'border-acc bg-accdim' : 'border-brd2 bg-panel hover:border-t3 hover:bg-hov'}`}
                  onClick={() => {
                    if (di.aggregate) {
                      // ≤ PANEL_MAX expands in-canvas (fan), larger groups
                      // keep the right member panel.
                      if (di.items.length > PANEL_MAX) {
                        setExpandedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(di.entityType)) next.delete(di.entityType);
                          else next.add(di.entityType);
                          return next;
                        });
                      } else {
                        // Fan toggle also closes the member panel: clicking a
                        // node means "look at this", not both views at once.
                        setExpandedGroups(new Set());
                        setFanGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(di.entityType)) next.delete(di.entityType);
                          else next.add(di.entityType);
                          return next;
                        });
                      }
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
            {fanChildren.map((c) => {
              // Fan child card: same node-card markup as a non-aggregate
              // neighbor; clicking navigates (full re-layout around it).
              const label = nameOf(c.item.neighborId);
              const td = typeDisplayOf(c.entityType);
              const pal = ACTIVITY_PALETTE[paletteOf(td?.color)];
              return (
                <button
                  key={c.item.neighborId}
                  type="button"
                  title={label}
                  style={{ position: 'absolute', left: c.cx - NODE_W / 2, top: c.cy - NODE_H / 2, width: NODE_W }}
                  className="flex h-[50px] items-center gap-2 rounded-lg border px-2 text-left cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,.04)] transition hover:-translate-y-px hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc border-brd2 bg-panel hover:border-t3 hover:bg-hov"
                  onClick={() => navigateTo(c.item.neighborId)}
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
                      <span className="truncate">{typeLabelOf(c.entityType)}</span>
                    </span>
                  </span>
                </button>
              );
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
        if (event.key === 'Escape' && (expandedGroups.size > 0 || fanGroups.size > 0)) {
          event.stopPropagation();
          setExpandedGroups(new Set());
          setFanGroups(new Set());
        }
      }}
    >
      <div className="flex flex-1 min-h-0 min-w-0">
        <div className="relative flex flex-1 min-w-0 min-h-0 flex-col">
          {history.length > 1 && (
            <button
              type="button"
              className="absolute top-2 left-2 z-20 flex h-8 items-center gap-1.5 rounded-lg border border-brd2 bg-panel px-2.5 text-[12px] text-t2 cursor-pointer transition hover:border-t3 hover:bg-hov hover:text-t1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
              onClick={goBack}
            >
              <LucideNameIcon name="arrow-left" size={13} />
              <span>{t('activity:graph.back')}</span>
            </button>
          )}
          {graph}
        </div>
        {panelGroup && (
          <aside className="w-[260px] shrink-0 min-h-0 overflow-y-auto border-l border-brd bg-panel">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-brd bg-panel px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                {(() => {
                  const td = typeDisplayOf(panelGroup.di.entityType);
                  const pal = ACTIVITY_PALETTE[paletteOf(td?.color)];
                  return (
                    <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: pal.bg, color: pal.color }}>
                      {td?.icon ? (
                        <LucideNameIcon name={td.icon} size={11} />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: pal.color }} />
                      )}
                    </span>
                  );
                })()}
                <span className="min-w-0 truncate text-[13px] font-medium text-t1">
                  {typeLabelOf(panelGroup.di.entityType)}
                  <span className="ml-1.5 text-[11px] font-normal text-t3">
                    {t('activity:graph.groupCount', { count: panelGroup.di.items.length })}
                  </span>
                </span>
              </span>
              <button
                type="button"
                className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-t3 hover:text-t1 hover:bg-hov text-[14px] leading-none"
                onClick={() => {
                  setExpandedGroups((prev) => {
                    const next = new Set(prev);
                    next.delete(panelGroup.di.entityType);
                    return next;
                  });
                }}
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-1 p-1.5">
              {panelGroup.di.items.map((n) => {
                const td = typeDisplayOf(panelGroup.di.entityType);
                const pal = ACTIVITY_PALETTE[paletteOf(td?.color)];
                return (
                  <button
                    key={n.neighborId}
                    type="button"
                    title={n.relation}
                    className="flex items-center gap-2 rounded-lg border border-brd2 bg-panel px-2 py-1.5 text-left cursor-pointer transition hover:border-t3 hover:bg-hov focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                    onClick={() => navigateTo(n.neighborId)}
                  >
                    <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: pal.bg, color: pal.color }}>
                      {td?.icon ? (
                        <LucideNameIcon name={td.icon} size={11} />
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
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
