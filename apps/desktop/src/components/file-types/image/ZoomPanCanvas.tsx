import { useEffect, useState, useRef, useCallback } from 'react';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 50;
const WHEEL_FACTOR = 1.1;

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function getTouchDist(t1: { clientX: number; clientY: number }, t2: { clientX: number; clientY: number }) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

interface ZoomPanCanvasProps {
  src: string;
  alt: string;
  className?: string;
}

/**
 * Zoomable / pannable canvas rendering a single image source. Extracted from
 * ImageViewer so any preview that yields a URL (disk file, in-memory blob,
 * data URL) reuses the same gesture handling — wheel zoom, drag pan, pinch,
 * double-click toggle.
 */
export function ZoomPanCanvas({ src, alt, className = 'image-viewer' }: ZoomPanCanvasProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; startPx: number; startPy: number } | null>(null);
  const pinchState = useRef<{ dist: number; zoom: number; midX: number; midY: number } | null>(null);

  const updateZoom = useCallback((z: number) => {
    zoomRef.current = z;
    setZoom(z);
  }, []);

  const updatePan = useCallback((p: { x: number; y: number }) => {
    panRef.current = p;
    setPan(p);
  }, []);

  // Reset view when the source changes (new file, new blob after edit).
  useEffect(() => {
    updateZoom(1);
    updatePan({ x: 0, y: 0 });
  }, [src, updateZoom, updatePan]);

  const resetView = useCallback(() => {
    updateZoom(1);
    updatePan({ x: 0, y: 0 });
  }, [updateZoom, updatePan]);

  const zoomAtCenter = useCallback((newZoom: number) => {
    const clamped = clampZoom(newZoom);
    const prev = zoomRef.current;
    const p = panRef.current;
    const ratio = clamped / prev;
    updateZoom(clamped);
    updatePan({ x: p.x * ratio, y: p.y * ratio });
  }, [updateZoom, updatePan]);

  const zoomAtPoint = useCallback((vx: number, vy: number, newZoom: number) => {
    const clamped = clampZoom(newZoom);
    const prev = zoomRef.current;
    const p = panRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = clamped / prev;
    const ax = vx - canvas.clientWidth / 2;
    const ay = vy - canvas.clientHeight / 2;
    updateZoom(clamped);
    updatePan({
      x: ax + (p.x - ax) * ratio,
      y: ay + (p.y - ay) * ratio,
    });
  }, [updateZoom, updatePan]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const factor = e.deltaY > 0 ? 1 / WHEEL_FACTOR : WHEEL_FACTOR;
      zoomAtCenter(zoomRef.current * factor);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [src, zoomAtCenter]);

  const zoomIn = useCallback(() => {
    zoomAtCenter(zoomRef.current * 1.25);
  }, [zoomAtCenter]);

  const zoomOut = useCallback(() => {
    zoomAtCenter(zoomRef.current / 1.25);
  }, [zoomAtCenter]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const canvas = e.currentTarget as HTMLElement;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    const p = panRef.current;
    dragState.current = { startX: e.clientX, startY: e.clientY, startPx: p.x, startPy: p.y };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    updatePan({ x: dragState.current.startPx + dx, y: dragState.current.startPy + dy });
  }, [updatePan]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    dragState.current = null;
    const canvas = e.currentTarget as HTMLElement;
    canvas.classList.remove('dragging');
    canvas.releasePointerCapture(e.pointerId);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t1 = e.touches[0], t2 = e.touches[1];
    const dist = getTouchDist(t1, t2);
    if (dist < 1) return;
    pinchState.current = {
      dist,
      zoom: zoomRef.current,
      midX: (t1.clientX + t2.clientX) / 2 - canvas.getBoundingClientRect().left,
      midY: (t1.clientY + t2.clientY) / 2 - canvas.getBoundingClientRect().top,
    };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinchState.current) return;
    e.preventDefault();
    const t1 = e.touches[0], t2 = e.touches[1];
    const newDist = getTouchDist(t1, t2);
    const ratio = newDist / pinchState.current.dist;
    const newZoom = clampZoom(pinchState.current.zoom * ratio);
    zoomAtPoint(pinchState.current.midX, pinchState.current.midY, newZoom);
  }, [zoomAtPoint]);

  const handleTouchEnd = useCallback(() => {
    pinchState.current = null;
  }, []);

  const handleDoubleClick = useCallback(() => {
    const z = zoomRef.current;
    const p = panRef.current;
    if (Math.abs(z - 1) < 0.001 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1) {
      zoomAtCenter(2);
    } else {
      resetView();
    }
  }, [zoomAtCenter, resetView]);

  const pct = Math.round(zoom * 100);
  const needsTransform = zoom !== 1 || pan.x !== 0 || pan.y !== 0;

  return (
    <div className={`${className} w-full h-full flex flex-col relative bg-surf overflow-hidden`}>
      <div className="image-viewer-toolbar absolute top-2 right-2 flex items-center gap-1 bg-panel border border-brd rounded-lg py-1 px-2 shadow-[0_2px_12px_rgba(0,0,0,.12)] opacity-70 transition-opacity duration-200 hover:opacity-100 z-10 select-none">
        <button className="ivt-btn w-7 h-7 border-none bg-none rounded-md text-base leading-none text-t1 cursor-pointer flex items-center justify-center hover:bg-hov" type="button" onClick={zoomOut} title="Zoom out">−</button>
        <span className="min-w-[48px] text-center text-xs text-t2 font-mono">{pct}%</span>
        <button className="ivt-btn w-7 h-7 border-none bg-none rounded-md text-base leading-none text-t1 cursor-pointer flex items-center justify-center hover:bg-hov" type="button" onClick={zoomIn} title="Zoom in">+</button>
        <button className="ivt-btn w-7 h-7 border-none bg-none rounded-md text-base leading-none text-t1 cursor-pointer flex items-center justify-center hover:bg-hov" type="button" onClick={resetView} title="Reset">↺</button>
      </div>
      <div
        className="image-viewer-canvas flex-1 overflow-hidden cursor-grab [&.dragging]:cursor-grabbing"
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleClick}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="block w-full h-full object-contain select-none touch-none"
          style={needsTransform ? {
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          } : undefined}
        />
      </div>
    </div>
  );
}
