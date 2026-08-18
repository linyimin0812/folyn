import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LocateFixed, Plus, Minus } from 'lucide-react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import { useWikiGraphStore } from '@/store/wikiGraphStore';
import * as editorIoService from '@/services/editorIoService';
import type { WikiGraphNode, WikiGraphEdge } from '@/types/wiki';

const NODE_COLORS: Record<string, string> = {
  'user-file': '#94a3b8',
  entity: '#3b82f6',
  concept: '#22c55e',
  source: '#a1a1aa',
  synthesis: '#a855f7',
};

const EDGE_COLORS: Record<string, string> = {
  directLink: '#3b82f6',
  sourceOverlap: '#22c55e',
  adamicAdar: '#d1d5db',
  typeAffinity: '#e5e7eb',
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

      // Labels: only for the hovered node and its neighbors — declutters dense graphs.
      if (isHovered || isNeighbor) {
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

  useEffect(() => {
    if (nodes.length === 0) return;

    const simNodes = nodes.map((n) => ({ ...n }));
    const simEdges = edges.map((e) => ({ ...e }));
    nodesRef.current = simNodes;
    edgesRef.current = simEdges;

    const sim = forceSimulation(simNodes as any)
      .force('link', forceLink(simEdges as any).id((d: any) => d.id).distance(140))
      .force('charge', forceManyBody().strength(-450))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide((d: any) => Math.max(3, Math.sqrt((d.linkCount || 0) + 1) * 1.5) + 6))
      .on('tick', render);

    simRef.current = sim;

    return () => { sim.stop(); };
  }, [nodes, edges]);

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
          onClick={() => { setPanX(0); setPanY(0); setZoom(1); }}
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
