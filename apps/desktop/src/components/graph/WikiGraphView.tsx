import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LocateFixed, Plus, Minus } from 'lucide-react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceRadial } from 'd3-force';
import { useWikiGraphStore } from '@/store/wikiGraphStore';
import * as editorIoService from '@/services/editorIoService';
import type { WikiGraphNode, WikiGraphEdge } from '@/types/wiki';

// ponytail: all node hues sit in tailwind-600 (L≈0.50-0.57) for equal perceived
// vividness — prior mix of -500 lightness bands made amber glarish, blue recessive.
const NODE_COLORS: Record<string, string> = {
  'user-file': '#475569',  // slate-600 — neutral, raw vault file stays muted
  entity: '#2563eb',       // blue-600 — was blue-500
  concept: '#16a34a',      // green-600 — was emerald-500
  source: '#d97706',       // amber-600 — was amber-500, no longer glares
  synthesis: '#9333ea',    // purple-600 — was purple-500
};

const EDGE_COLORS: Record<string, string> = {
  directLink: '#334155',    // slate-700 — was slate-600 (clashed with user-file node); one band darker
  sourceOverlap: '#be123c', // rose-700 — only colored edge, distinct from all node hues
  adamicAdar: '#94a3b8',    // slate-400 — light dashed, inferred
  typeAffinity: '#cbd5e1',   // slate-300 — lighter dashed, weakest signal
};

// ponytail: 4px slack — anything below this counts as a click, not a drag.
const CLICK_SLACK_PX = 4;

interface DragState {
  startX: number;
  startY: number;
  panX0: number;
  panY0: number;
  nodeId: string | null;
}

export function WikiGraphView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodes = useWikiGraphStore((s) => s.nodes);
  const edges = useWikiGraphStore((s) => s.edges);
  const isBuilding = useWikiGraphStore((s) => s.isBuilding);
  const buildGraph = useWikiGraphStore((s) => s.buildGraph);
  const getNeighborIds = useWikiGraphStore((s) => s.getNeighborIds);
  const openFile = editorIoService.openFile;
  const { t } = useTranslation();

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: WikiGraphNode } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const dragRef = useRef<DragState | null>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation> | null>(null);
  const nodesRef = useRef<WikiGraphNode[]>([]);
  const edgesRef = useRef<WikiGraphEdge[]>([]);
  // ponytail: render reads latest hover/zoom/pan from this ref so its identity
  // stays stable across hover/zoom/pan changes — otherwise the sim effect
  // re-runs and reseeds node positions, causing the "jump on hover" bug.
  const stateRef = useRef({ hoveredNode, zoom, panX, panY });

  useEffect(() => {
    buildGraph();
  }, [buildGraph]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { hoveredNode, zoom, panX, panY } = stateRef.current;

    // ponytail: canvas fillStyle can't take CSS var names — resolve once per frame.
    const cssVars = canvas.ownerDocument.defaultView?.getComputedStyle(canvas);
    const t1Color = cssVars?.getPropertyValue('--t1')?.trim() || '#1e293b';
    const t2Color = cssVars?.getPropertyValue('--t2')?.trim() || '#475569';

    // ponytail: DPR-aware scaling so retina displays don't render a blurry graph.
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cssW;
    const h = cssH;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2 + panX, h / 2 + panY);
    ctx.scale(zoom, zoom);

    const neighborIds = hoveredNode ? getNeighborIds(hoveredNode) : null;

    for (const edge of edgesRef.current) {
      const s = edge.source as unknown as WikiGraphNode;
      const t = edge.target as unknown as WikiGraphNode;
      if (s.x === undefined || t.x === undefined) continue;

      const dimmed = hoveredNode && s.id !== hoveredNode && t.id !== hoveredNode;
      ctx.strokeStyle = dimmed ? 'rgba(200,200,200,0.15)'
        : edge.signals.directLink ? EDGE_COLORS.directLink
        : edge.signals.sourceOverlap ? EDGE_COLORS.sourceOverlap
        : EDGE_COLORS.adamicAdar;
      ctx.lineWidth = Math.min(edge.weight * 0.15, 1.5);
      if (!edge.signals.directLink && !edge.signals.sourceOverlap) {
        ctx.setLineDash([4, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.moveTo(s.x!, s.y!);
      ctx.lineTo(t.x!, t.y!);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const node of nodesRef.current) {
      if (node.x === undefined || node.y === undefined) continue;
      const isHovered = node.id === hoveredNode;
      const isNeighbor = !!neighborIds?.has(node.id);
      const dimmed = hoveredNode && !isHovered && !isNeighbor;
      const radius = Math.max(3, Math.sqrt(node.linkCount + 1) * 1.5);
      const color = NODE_COLORS[node.type] || '#94a3b8';

      ctx.globalAlpha = dimmed ? 0.15 : 1;
      ctx.fillStyle = color;
      ctx.beginPath();

      if (node.type === 'concept') {
        ctx.rect(node.x - radius, node.y - radius, radius * 2, radius * 2);
      } else {
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();

      // ponytail: ring on hovered node — cheap visual feedback for the click target.
      if (isHovered) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Labels: hovered node + its neighbors, plus core hubs (linkCount >= 3)
      // so dense graphs still surface hubs without hovering. ponytail: threshold
      // hardcoded 3 — extract to a constant if tuning becomes iterative.
      const isCore = node.linkCount >= 3;
      if (isHovered || isNeighbor || isCore) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = isHovered ? t1Color : t2Color;
        ctx.font = isHovered ? 'bold 11px system-ui' : '10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, node.x, node.y + radius + 12);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [getNeighborIds]);

  // Sync stateRef + redraw on hover/zoom/pan changes. Replaces the old
  // `useEffect(() => { render(); }, [render])` line — that one was a no-op
  // (render identity was stable per its own deps) but also wouldn't have
  // fired on hover/zoom/pan since render wasn't in their dep chain.
  useEffect(() => {
    stateRef.current = { hoveredNode, zoom, panX, panY };
    render();
  }, [hoveredNode, zoom, panX, panY, render]);

  // ponytail: auto-fit the graph bbox to the canvas viewport once the sim
  // settles (d3-force `end` event) — small graphs were rendering tiny at zoom 1.
  // Also reused by the Center button so it re-fits the current layout instead
  // of resetting to zoom 1, pan 0.
  const autoFit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodesRef.current.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodesRef.current) {
      if (n.x === undefined || n.y === undefined) continue;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
    }
    if (!isFinite(minX)) return;
    const bboxW = maxX - minX || 1;
    const bboxH = maxY - minY || 1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const scale = Math.min(
      canvas.clientWidth / bboxW,
      canvas.clientHeight / bboxH,
    ) * 0.9;
    const clamped = Math.max(0.2, Math.min(5, scale));
    setZoom(clamped);
    setPanX(-cx * clamped);
    setPanY(-cy * clamped);
  }, []);

  useEffect(() => {
    if (nodes.length === 0) return;

    const simNodes = nodes.map((n) => ({ ...n }));
    const simEdges = edges.map((e) => ({ ...e }));
    nodesRef.current = simNodes;
    edgesRef.current = simEdges;

    const sim = forceSimulation(simNodes as any)
      .force('link', forceLink(simEdges as any).id((d: any) => d.id).distance(220))
      // ponytail: charge strength -700 spreads dense clusters. distanceMax removed:
      // radial(0) pulls disconnected components inward; 0.04 is the middle ground
      // (0.05 was too dense locally, 0.015 let disconnected components drift apart).
      .force('charge', forceManyBody().strength(-700))
      .force('center', forceCenter(0, 0))
      .force('radial', forceRadial(0, 0).strength(0.04))
      // ponytail: collide padding +18 (up from +12) — more physical space per node.
      .force('collide', forceCollide((d: any) => Math.max(3, Math.sqrt((d.linkCount || 0) + 1) * 1.5) + 18))
      .on('tick', render)
      .on('end', autoFit);

    simRef.current = sim;

    return () => { sim.stop(); };
  }, [nodes, edges, render, autoFit]);

  const findNodeAtPos = useCallback((clientX: number, clientY: number): WikiGraphNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left - canvas.clientWidth / 2 - panX) / zoom;
    const y = (clientY - rect.top - canvas.clientHeight / 2 - panY) / zoom;
    for (const node of nodesRef.current) {
      if (node.x === undefined || node.y === undefined) continue;
      const dx = node.x - x;
      const dy = node.y - y;
      const r = Math.max(8, Math.sqrt(node.linkCount + 1) * 1.5 + 4);
      if (dx * dx + dy * dy < r * r) return node;
    }
    return null;
  }, [zoom, panX, panY]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(5, z * (1 - e.deltaY * 0.001))));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const node = findNodeAtPos(e.clientX, e.clientY);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX0: panX,
      panY0: panY,
      nodeId: node?.id ?? null,
    };
  }, [panX, panY, findNodeAtPos]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (moved >= CLICK_SLACK_PX) return; // it was a pan, not a click
    if (!drag.nodeId) return; // mousedown was on empty canvas
    const node = findNodeAtPos(e.clientX, e.clientY);
    if (node && node.id === drag.nodeId) {
      openFile(node.id, node.label); // idempotent — double-click fires mouseup twice, second is a no-op (file already open)
    }
  }, [findNodeAtPos, openFile]);

  const handleDragMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) >= CLICK_SLACK_PX) {
        setPanX(dragRef.current.panX0 + dx);
        setPanY(dragRef.current.panY0 + dy);
      }
    }
    const node = findNodeAtPos(e.clientX, e.clientY);
    setHoveredNode(node?.id ?? null);
    if (node) {
      setTooltip({ x: e.clientX, y: e.clientY, node });
    } else {
      setTooltip(null);
    }
  }, [findNodeAtPos]);

  const handleMouseLeave = useCallback(() => {
    setHoveredNode(null);
    setTooltip(null);
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resizeObserver = new ResizeObserver(() => {
      render();
    });
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [render]);

  return (
    <div className="relative w-full h-full bg-[var(--bg)]">
      {isBuilding && <div className="absolute top-3 left-1/2 -translate-x-1/2 py-1 px-3 bg-[var(--surf)] border border-[var(--brd)] rounded-md text-xs text-[var(--t3)] z-10">构建图谱中...</div>}
      <div className="absolute top-3 right-3 flex items-center gap-1 py-1 px-1.5 bg-[var(--surf)] border border-[var(--brd)] rounded-md text-[var(--t3)] z-10">
        <button
          type="button"
          className="p-1 hover:bg-[var(--hov)] hover:text-[var(--t1)] rounded transition-colors"
          aria-label={t('wiki:graph.controls.center')}
          title={t('wiki:graph.controls.center')}
          // ponytail: only recenter — forceCenter(0,0) puts the graph mean at origin,
          // so pan=0,0 renders it at canvas center. Don't touch zoom.
          onClick={() => { setPanX(0); setPanY(0); }}
        >
          <LocateFixed size={14} />
        </button>
        <button
          type="button"
          className="p-1 hover:bg-[var(--hov)] hover:text-[var(--t1)] rounded transition-colors"
          aria-label={t('wiki:graph.controls.zoomIn')}
          title={t('wiki:graph.controls.zoomIn')}
          onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className="p-1 hover:bg-[var(--hov)] hover:text-[var(--t1)] rounded transition-colors"
          aria-label={t('wiki:graph.controls.zoomOut')}
          title={t('wiki:graph.controls.zoomOut')}
          onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))}
        >
          <Minus size={14} />
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleDragMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && (
        <div
          className="pointer-events-none fixed z-20 max-w-[240px] py-1.5 px-2.5 bg-[var(--surf)] border border-[var(--brd)] rounded-md text-[11px] text-[var(--t1)] shadow-sm"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="font-medium truncate">{tooltip.node.label}</div>
          <div className="text-[var(--t3)] mt-0.5">
            <span className="capitalize">{tooltip.node.type}</span> · {tooltip.node.linkCount} links
          </div>
          {tooltip.node.tags.length > 0 && (
            <div className="text-[var(--t3)] mt-0.5 truncate">
              {tooltip.node.tags.slice(0, 3).join(', ')}
              {tooltip.node.tags.length > 3 ? '…' : ''}
            </div>
          )}
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex gap-2 py-0.5 px-2 bg-[var(--bg)] border border-[var(--brd)] rounded text-[10px] text-[var(--t3)]">
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
            {type}
          </span>
        ))}
      </div>
      <div className="absolute bottom-2 right-2 py-0.5 px-2 bg-[var(--bg)] border border-[var(--brd)] rounded text-[10px] text-[var(--t3)]">
        {nodes.length} 节点 · {edges.length} 条边
      </div>
    </div>
  );
}
