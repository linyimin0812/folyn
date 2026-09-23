/**
 * Dynamic entity-relation browser (design §7.2): one-hop neighbors of the
 * selected center, same-type neighbors (≥2) collapsed into aggregate nodes,
 * prototype-validated static radial layout (elliptical orbit sized to the
 * measured container so the graph fills any window aspect). Clicking a neighbor makes it the
 * new center (refetch); clicking an aggregate node opens the instance list
 * in the right sidebar. Unregistered entity types render as gray nodes with
 * the raw type string.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type ActivityEntityRow,
  type ActivityNeighborRow,
  getActivityEntityNeighbors,
  listActivityEntities,
} from '@/services/activity/api';
import { useCollectorRegistryStore } from '@/services/activity/registry';
import { useAsync } from './useActivityData';
import { ACTIVITY_PALETTE, breadcrumbIndices, groupNeighborsByType, paletteOf, radialLayoutKnobs } from './display';

const CENTER_R = 64;

function truncateLabel(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

interface EntityGraphViewProps {
  vaultRoot: string;
}

export function EntityGraphView({ vaultRoot }: EntityGraphViewProps) {
  const { t } = useTranslation();
  // centerHistory holds entity ids; the last entry is the current center.
  const [history, setHistory] = useState<string[]>([]);
  const [bcExpanded, setBcExpanded] = useState(false);
  const [groupPanel, setGroupPanel] = useState<string | null>(null);

  const entityTypes = useCollectorRegistryStore((s) => s.entityTypes);

  const { data: entities } = useAsync(
    () => (vaultRoot ? listActivityEntities(vaultRoot) : Promise.resolve([] as ActivityEntityRow[])),
    [vaultRoot],
  );

  // Measured svg box — layout derives from the actual container so the graph
  // fills any window aspect (a static viewBox + `meet` letterboxes instead).
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
  const { nodeRadius: rN } = radialLayoutKnobs(slots);
  const W = Math.max(320, box.w);
  const H = Math.max(240, box.h);
  const CX = W / 2;
  const CY = H / 2;
  // Orbit radii from the measured box so nodes fill it; horizontal margin 90
  // keeps relation labels inside, vertical 60.
  const RX = W / 2 - rN - 90;
  const RY = Math.max(80, H / 2 - rN - 60);
  const fs = Math.max(1, W / 1100);

  const navigateTo = (id: string) => {
    setGroupPanel(null);
    setBcExpanded(false);
    setHistory((h) => [...h, id]);
  };
  const jumpTo = (idx: number) => {
    setGroupPanel(null);
    setHistory((h) => h.slice(0, idx + 1));
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
  const bcIdx = breadcrumbIndices(history.length, bcExpanded);

  /* Breadcrumb path — collapsed to「… › prev › current」beyond 3 levels. */
  const breadcrumb = (
    <div className="mb-3 text-[length:calc(var(--ui-font-size)-1px)] flex items-center gap-1 flex-wrap shrink-0">
      {history.length > 3 && !bcExpanded && (
        <>
          <button
            className="text-t3 px-1 cursor-pointer bg-transparent border-0"
            title={t('activity:graph.expand')}
            onClick={() => setBcExpanded(true)}
          >
            …
          </button>
          <span className="text-t3">›</span>
        </>
      )}
      {bcIdx.map((i) => (
        <span key={i} className="flex items-center gap-1">
          {i < history.length - 1 ? (
            <button
              className="text-t3 hover:text-t1 cursor-pointer bg-transparent border-0"
              onClick={() => jumpTo(i)}
            >
              {nameOf(history[i])}
            </button>
          ) : (
            <span className="text-t1">{nameOf(history[i])}</span>
          )}
          {i < history.length - 1 && <span className="text-t3">›</span>}
        </span>
      ))}
      {bcExpanded && history.length > 3 && (
        <button
          className="text-t3 text-[11px] px-1.5 py-0.5 ml-2 border border-brd rounded-md cursor-pointer bg-panel"
          onClick={() => setBcExpanded(false)}
        >
          {t('activity:graph.collapse')}
        </button>
      )}
    </div>
  );

  const graph = (
    <div ref={wrapRef} className="flex-1 min-h-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full select-none" role="img">
      <defs>
        <marker
          id="activity-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY={5}
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M2 1L8 5L2 9" fill="none" stroke="#8b8a83" strokeWidth="1.5" strokeLinecap="round" />
        </marker>
      </defs>

      {/* Center node */}
      {center && (
        <g>
          <circle cx={CX} cy={CY} r={CENTER_R} fill={ACTIVITY_PALETTE[paletteOf('blue')].bg} stroke={ACTIVITY_PALETTE[paletteOf('blue')].color} strokeWidth="0.5" />
          <text x={CX} y={CY - 11} textAnchor="middle" dominantBaseline="central" fontSize={18 * fs} fontWeight="500" fill="var(--t1, #201f1c)">
            {truncateLabel(nameOf(center.id), 7)}
          </text>
          <text x={CX} y={CY + 13} textAnchor="middle" dominantBaseline="central" fontSize={14 * fs} fill="var(--t2, #5f5e5a)">
            {typeLabelOf(center.type)}
          </text>
        </g>
      )}

      {/* Neighbor nodes on the elliptical radial orbit */}
      {displayItems.map((di, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, slots);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const nx = CX + RX * cosA;
        const ny = CY + RY * sinA;
        // Ellipse direction ≠ angle direction — follow the actual center→node vector.
        const dx = nx - CX;
        const dy = ny - CY;
        const len = Math.hypot(dx, dy);
        const ux = dx / len;
        const uy = dy / len;
        const startX = CX + CENTER_R * ux;
        const startY = CY + CENTER_R * uy;
        const endX = nx - rN * ux;
        const endY = ny - rN * uy;
        const rel = di.items[0]?.relation ?? '';
        const labelX = (startX + endX) / 2 - uy * 10;
        const labelY = (startY + endY) / 2 + ux * 10;
        const reg = entityTypes.find((et) => et.id === di.entityType);
        const pal = ACTIVITY_PALETTE[paletteOf(reg?.color)];
        return (
          <g key={di.entityType}>
            <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="#8b8a83" strokeWidth="1" markerEnd="url(#activity-arrow)" />
            <text x={labelX} y={labelY} textAnchor="middle" fontSize={13 * fs} fill="var(--t2, #5f5e5a)" fontStyle="italic">
              {rel}
            </text>
            <g
              className="cursor-pointer"
              onClick={() =>
                di.aggregate ? setGroupPanel(di.entityType) : navigateTo(di.items[0]!.neighborId)
              }
            >
              <circle cx={nx} cy={ny} r={rN} fill={pal.bg} stroke={pal.color} strokeWidth="0.5" />
              <text x={nx} y={ny - 11} textAnchor="middle" dominantBaseline="central" fontSize={18 * fs} fontWeight="500" fill="var(--t1, #201f1c)">
                {di.aggregate
                  ? truncateLabel(typeLabelOf(di.entityType), rN <= 44 ? 3 : 5)
                  : truncateLabel(nameOf(di.items[0]!.neighborId), rN <= 44 ? 3 : 5)}
              </text>
              <text x={nx} y={ny + 13} textAnchor="middle" dominantBaseline="central" fontSize={14 * fs} fill="var(--t2, #5f5e5a)">
                {di.aggregate
                  ? t('activity:graph.groupCount', { count: di.items.length })
                  : typeLabelOf(di.entityType)}
              </text>
            </g>
          </g>
        );
      })}
      </svg>
    </div>
  );

  /* Center info / no-relations / hint — always under the graph (left column). */
  const infoPanel = center ? (
    <p className="m-0 text-[13px] text-t3">
      {neighbors && neighbors.length === 0
        ? t('activity:graph.noRelations', { name: nameOf(center.id) })
        : t('activity:graph.centerInfo', {
            name: nameOf(center.id),
            count: neighbors?.length ?? 0,
          })}
    </p>
  ) : (
    <p className="m-0 text-[13px] text-t3">
      {t('activity:graph.hint')}
    </p>
  );

  // Aggregate instance list — right sidebar when a group is open.
  if (groupPanel != null) {
    const items = groups.find((g) => g.entityType === groupPanel)?.items ?? [];
    return (
      <div className="h-full flex gap-3 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {breadcrumb}
            {graph}
            <div className="border border-brd rounded-lg p-4 bg-panel shrink-0">{infoPanel}</div>
          </div>
          <div className="w-[320px] shrink-0 border border-brd rounded-lg p-4 bg-panel h-full overflow-y-auto">
          <p className="m-0 mb-3 text-[13px] text-t2">
            {t('activity:graph.groupPanel', {
              label: typeLabelOf(groupPanel),
              count: items.length,
            })}
          </p>
          <div className="flex flex-col gap-2">
            {items.map((n) => (
              <button
                key={n.neighborId}
                className="text-left text-[length:var(--ui-font-size)] text-t1 px-3 py-2 bg-surf2 rounded-md cursor-pointer border-0 hover:bg-hov"
                onClick={() => navigateTo(n.neighborId)}
              >
                {nameOf(n.neighborId)} · {n.relation}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {breadcrumb}
      {graph}
      {/* Detail panel: center info / hint (full width, no group open) */}
      <div className="border border-brd rounded-lg p-4 bg-panel shrink-0">{infoPanel}</div>
    </div>
  );
}
