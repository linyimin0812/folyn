/**
 * Dynamic entity-relation browser (design §7.2): one-hop neighbors of the
 * selected center, same-type neighbors (≥2) collapsed into aggregate nodes,
 * prototype-validated static radial layout (elliptical orbit sized to the
 * measured container so the graph fills any window aspect). Clicking a neighbor makes it the
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
import { useAsync } from './useActivityData';
import { breadcrumbIndices, groupNeighborsByType } from './display';

const NODE_W = 168;
const NODE_H = 64;
const CENTER_W = 184;
const CENTER_H = 72;

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
  // Keep nodes readable in narrow panes; scroll the canvas instead of shrinking it.
  // A minimum circular orbit also leaves room between adjacent rectangular nodes.
  const orbitMin = slots > 1
    ? Math.max(140, (Math.hypot(NODE_W, NODE_H) + 24) / (2 * Math.sin(Math.PI / slots)))
    : 140;
  const W = Math.max(640, box.w, orbitMin * 2 + NODE_W + 64);
  const H = Math.max(400, box.h, orbitMin * 2 + NODE_H + 64);
  const CX = W / 2;
  const CY = H / 2;
  const RX = W / 2 - NODE_W / 2 - 32;
  const RY = H / 2 - NODE_H / 2 - 32;

  const closeGroupPanel = () => {
    setGroupPanel(null);
    groupButtonRef.current?.focus();
  };

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
    <div className="min-h-10 px-4 py-2 text-xs flex items-center gap-1 flex-wrap shrink-0 border-b border-brd">
      {history.length > 3 && !bcExpanded && (
        <>
          <button
            className="text-t3 px-2 py-1 rounded hover:bg-hov focus-visible:outline-2 focus-visible:outline-acc cursor-pointer bg-transparent border-0"
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
              className="max-w-48 truncate text-t2 hover:text-t1 hover:bg-hov px-1.5 py-1 rounded focus-visible:outline-2 focus-visible:outline-acc cursor-pointer bg-transparent border-0"
              title={nameOf(history[i])}
              onClick={() => jumpTo(i)}
            >
              {nameOf(history[i])}
            </button>
          ) : (
            <span className="max-w-56 truncate px-1.5 font-medium text-t1" title={nameOf(history[i])} aria-current="page">{nameOf(history[i])}</span>
          )}
          {i < history.length - 1 && <span className="text-t3">›</span>}
        </span>
      ))}
      {bcExpanded && history.length > 3 && (
        <button
          className="text-t3 text-[11px] px-1.5 py-0.5 ml-2 border border-brd rounded-md cursor-pointer bg-panel hover:bg-hov focus-visible:outline-2 focus-visible:outline-acc"
          onClick={() => setBcExpanded(false)}
        >
          {t('activity:graph.collapse')}
        </button>
      )}
    </div>
  );

  const graph = (
    <div ref={wrapRef} className="flex-1 min-h-0 min-w-0 overflow-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block select-none">
        <defs>
          <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="var(--t3)" strokeWidth="1.2" strokeLinecap="round" />
          </marker>
        </defs>

        {displayItems.map((di, i) => {
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
          const startX = CX + start * ux;
          const startY = CY + start * uy;
          const endX = nx - end * ux;
          const endY = ny - end * uy;
          const rel = di.items[0]?.relation ?? '';
          const label = di.aggregate ? typeLabelOf(di.entityType) : nameOf(di.items[0]!.neighborId);
          const selected = groupPanel === di.entityType;
          return (
            <g key={di.entityType}>
              <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="var(--brd2)" strokeWidth="1" markerEnd={`url(#${arrowId})`} />
              <text x={(startX + endX) / 2} y={(startY + endY) / 2 - 8} textAnchor="middle" fontSize="11" fill="var(--t3)" stroke="var(--panel)" strokeWidth="5" paintOrder="stroke">
                {rel}
              </text>
              <foreignObject x={nx - NODE_W / 2 - 4} y={ny - NODE_H / 2 - 4} width={NODE_W + 8} height={NODE_H + 8}>
                <button
                  type="button"
                  title={label}
                  aria-expanded={di.aggregate ? selected : undefined}
                  className={`m-1 flex h-16 w-[168px] flex-col justify-center gap-1 rounded-md border px-3 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc ${selected ? 'border-acc bg-accdim' : 'border-brd2 bg-panel hover:border-t3 hover:bg-hov'}`}
                  onClick={(event) => {
                    if (di.aggregate) {
                      groupButtonRef.current = event.currentTarget;
                      setGroupPanel(selected ? null : di.entityType);
                    } else {
                      navigateTo(di.items[0]!.neighborId);
                    }
                  }}
                >
                  <span className="block w-full truncate text-[13px] font-medium text-t1">{label}</span>
                  <span className="flex w-full items-center justify-between gap-2 text-[11px] text-t3">
                    <span className="truncate">{di.aggregate ? t('activity:graph.groupCount', { count: di.items.length }) : typeLabelOf(di.entityType)}</span>
                    {di.aggregate && <span aria-hidden="true">›</span>}
                  </span>
                </button>
              </foreignObject>
            </g>
          );
        })}

        {center && (
          <foreignObject x={CX - CENTER_W / 2} y={CY - CENTER_H / 2} width={CENTER_W} height={CENTER_H}>
            <div className="flex h-full flex-col justify-center gap-1 rounded-md border border-acc bg-panel px-4" title={nameOf(center.id)}>
              <span className="truncate text-[13px] font-semibold text-t1">{nameOf(center.id)}</span>
              <span className="truncate text-[11px] text-t2">{typeLabelOf(center.type)}</span>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );

  /* Center info / no-relations / hint — always under the graph (left column). */
  const infoPanel = center ? (
    <p className="m-0 text-xs leading-5 text-t3">
      {neighbors && neighbors.length === 0
        ? t('activity:graph.noRelations', { name: nameOf(center.id) })
        : t('activity:graph.centerInfo', {
            name: nameOf(center.id),
            count: neighbors?.length ?? 0,
          })}
    </p>
  ) : (
    <p className="m-0 text-xs leading-5 text-t3">
      {t('activity:graph.hint')}
    </p>
  );

  const panelItems = groups.find((g) => g.entityType === groupPanel)?.items ?? [];

  return (
    <div
      className="h-full min-h-0 overflow-hidden rounded-lg border border-brd bg-panel flex flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && groupPanel != null) {
          event.stopPropagation();
          closeGroupPanel();
        }
      }}
    >
      {breadcrumb}
      <div className="relative flex flex-1 min-h-0 min-w-0">
        <div className="flex flex-1 min-w-0 min-h-0 flex-col">
          {graph}
          <div className="shrink-0 border-t border-brd px-4 py-2">{infoPanel}</div>
        </div>
        {groupPanel != null && (
          <aside
            className="absolute inset-y-0 right-0 z-10 flex w-[260px] max-w-full flex-col border-l border-brd bg-panel min-[1100px]:static min-[1100px]:shrink-0"
          >
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
