import { useRef, useEffect, useState, useCallback } from 'react';
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

export function WikiGraphView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodes = useWikiGraphStore((s) => s.nodes);
  const edges = useWikiGraphStore((s) => s.edges);
  const isBuilding = useWikiGraphStore((s) => s.isBuilding);
  const buildGraph = useWikiGraphStore((s) => s.buildGraph);
  const getNeighborIds = useWikiGraphStore((s) => s.getNeighborIds);
  const openFile = editorIoService.openFile;

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const dragRef = useRef<{ startX: number; startY: number; panX0: number; panY0: number } | null>(null);
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

    const w = canvas.width;
    const h = canvas.height;
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
      ctx.lineWidth = Math.min(edge.weight * 0.3, 3);
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
      const dimmed = hoveredNode && node.id !== hoveredNode && !neighborIds?.has(node.id);
      const radius = Math.max(4, Math.sqrt(node.linkCount + 1) * 3);
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

      if (!dimmed || node.id === hoveredNode) {
        ctx.fillStyle = dimmed ? 'rgba(100,100,100,0.3)' : '#1e293b';
        ctx.font = node.id === hoveredNode ? 'bold 11px system-ui' : '10px system-ui';
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
      .force('link', forceLink(simEdges as any).id((d: any) => d.id).distance(80))
      .force('charge', forceManyBody().strength(-200))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide(20))
      .on('tick', render);

    simRef.current = sim;

    return () => { sim.stop(); };
  }, [nodes, edges]);

  const findNodeAtPos = useCallback((clientX: number, clientY: number): WikiGraphNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left - canvas.width / 2 - panX) / zoom;
    const y = (clientY - rect.top - canvas.height / 2 - panY) / zoom;
    for (const node of nodesRef.current) {
      if (node.x === undefined || node.y === undefined) continue;
      const dx = node.x - x;
      const dy = node.y - y;
      const r = Math.max(6, Math.sqrt(node.linkCount + 1) * 3);
      if (dx * dx + dy * dy < r * r) return node;
    }
    return null;
  }, [zoom, panX, panY]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const node = findNodeAtPos(e.clientX, e.clientY);
    if (node) openFile(node.id, node.label);
  }, [findNodeAtPos, openFile]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(5, z * (1 - e.deltaY * 0.001))));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX0: panX, panY0: panY };
  }, [panX, panY]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleDragMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) {
      setPanX(dragRef.current.panX0 + e.clientX - dragRef.current.startX);
      setPanY(dragRef.current.panY0 + e.clientY - dragRef.current.startY);
    }
    const node = findNodeAtPos(e.clientX, e.clientY);
    setHoveredNode(node?.id ?? null);
  }, [findNodeAtPos]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resizeObserver = new ResizeObserver(() => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      render();
    });
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [render]);

  return (
    <div className="relative w-full h-full bg-[var(--bg)]">
      {isBuilding && <div className="absolute top-3 left-1/2 -translate-x-1/2 py-1 px-3 bg-[var(--surf)] border border-[var(--brd)] rounded-md text-xs text-[var(--t3)] z-10">构建图谱中...</div>}
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleDragMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onMouseLeave={() => { setHoveredNode(null); dragRef.current = null; }}
      />
      <div className="absolute bottom-3 left-3 flex gap-2.5 py-1 px-2.5 bg-[var(--bg)] border border-[var(--brd)] rounded-md text-[11px] text-[var(--t3)]">
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: color }} />
            {type}
          </span>
        ))}
      </div>
      <div className="absolute bottom-3 right-3 py-1 px-2.5 bg-[var(--bg)] border border-[var(--brd)] rounded-md text-[11px] text-[var(--t4)]">
        {nodes.length} 节点 · {edges.length} 条边
      </div>
    </div>
  );
}
