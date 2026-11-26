import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePreviewActive } from './PreviewActiveContext';

interface DiagramLightboxProps {
  /** Serialized SVG markup from the flow copy — same rendering as in-page. */
  svg: string;
  /** Caption (fence language / title), bottom-left. */
  title: string;
  onClose: () => void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

// The portal's DOM lives in <body>, but React synthetic events still bubble
// up the component tree into the preview (link/selection/sync handlers).
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Fullscreen viewer for rendered diagrams (mermaid/graphviz/plantuml fences):
 * click the diagram in the flow to open. Mirrors ImageLightbox's shell (dark
 * overlay, Esc/margin close, PreviewActive gating) but renders the SVG DOM
 * directly instead of an <img> — mermaid flowcharts use <foreignObject>, which
 * does not survive serialization into an img data URL on WKWebView.
 * Opens at Fit, offers 1:1; wheel zooms at cursor, drag pans, toolbar has
 * −/%/+/适宽/1:1. 旧交互（悬停 ⤢ 图标）按用户拍板移除——入口是纯点击。
 */
export function DiagramLightbox({ svg, title, onClose }: DiagramLightboxProps) {
  const active = usePreviewActive();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Initial view: fit the stage (diagrams render wide; 1:1 can dwarf it).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (stage && content) {
      const fit = Math.min(
        stage.clientWidth / Math.max(content.scrollWidth, 1),
        stage.clientHeight / Math.max(content.scrollHeight, 1),
        1,
      );
      if (fit > 0 && Number.isFinite(fit)) {
        setZoom(fit);
        setPan({ x: 0, y: 0 });
      }
    }
  }, [svg]);

  const clampZoom = (z: number) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);

  // Zoom anchored at a stage point: keep the content point under the cursor
  // stationary while the scale changes (transform-origin: center math).
  const zoomAtPoint = (px: number, py: number, next: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    setPan((prev) => {
      const cx = (px - w / 2 - prev.x) / (zoom || 1);
      const cy = (py - h / 2 - prev.y) / (zoom || 1);
      return { x: px - w / 2 - next * cx, y: py - h / 2 - next * cy };
    });
    setZoom(next);
  };

  const zoomBy = (factor: number) => {
    const stage = stageRef.current;
    const next = clampZoom(zoom * factor);
    if (!stage) { setZoom(next); return; }
    zoomAtPoint(stage.clientWidth / 2, stage.clientHeight / 2, next);
  };

  const fitView = () => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;
    const fit = Math.min(
      stage.clientWidth / Math.max(content.scrollWidth, 1),
      stage.clientHeight / Math.max(content.scrollHeight, 1),
      1,
    );
    setZoom(fit > 0 && Number.isFinite(fit) ? fit : 1);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    // Capture: close before the editor / other global Esc handlers react.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  if (!active) return null;

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, clampZoom(zoom * factor));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  // Toggle fit/1:1 on double click — the two views readers switch between.
  const onDoubleClickStage = () => {
    if (Math.abs(zoom - 1) < 0.01 && pan.x === 0 && pan.y === 0) fitView();
    else { setZoom(1); setPan({ x: 0, y: 0 }); }
  };

  const pct = Math.round(zoom * 100);

  return createPortal(
    <div
      className="diagram-lightbox fixed inset-0 z-[9999] bg-black/60 p-10 flex"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Diagram'}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onDoubleClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      onContextMenu={stop}
    >
      <div className="flex-1 min-w-0 rounded-lg overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,.35)] diagram-lightbox-card">
        <div
          ref={stageRef}
          className="diagram-lightbox-stage w-full h-full relative overflow-hidden cursor-grab active:cursor-grabbing"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClickStage}
        >
          <div
            ref={contentRef}
            className="diagram-lightbox-content absolute inset-0 flex items-center justify-center"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-panel border border-brd rounded-lg px-1.5 py-0.5 text-xs select-none">
            <button type="button" title="缩小" aria-label="zoom out" className="w-6 h-6 rounded-md border-none bg-transparent text-t2 cursor-pointer flex items-center justify-center hover:bg-hov" onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
            <span className="min-w-[3em] text-center text-t2 tabular-nums">{pct}%</span>
            <button type="button" title="放大" aria-label="zoom in" className="w-6 h-6 rounded-md border-none bg-transparent text-t2 cursor-pointer flex items-center justify-center hover:bg-hov" onClick={() => zoomBy(ZOOM_STEP)}>+</button>
            <button type="button" className="px-1.5 h-6 rounded-md border-none bg-transparent text-t2 cursor-pointer hover:bg-hov" onClick={fitView}>适宽</button>
            <button type="button" className="px-1.5 h-6 rounded-md border-none bg-transparent text-t2 cursor-pointer hover:bg-hov" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>1:1</button>
          </div>
        </div>
      </div>
      {title && (
        <div className="image-lightbox-caption absolute left-4 bottom-3 max-w-[60%] truncate text-xs text-white/70 select-none pointer-events-none">
          {title}
        </div>
      )}
      <button
        type="button"
        className="absolute top-2 right-2 w-7 h-7 rounded-md border-none bg-transparent text-white/80 text-lg leading-none cursor-pointer flex items-center justify-center hover:bg-white/15 hover:text-white"
        onClick={onClose}
        title="Close"
        aria-label="Close"
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
