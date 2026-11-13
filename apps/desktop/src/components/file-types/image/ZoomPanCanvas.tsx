import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';

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
  /** Open fitted to the pane (upscaling too) instead of at natural size. For
   *  sources whose intrinsic size is meaningless — Mermaid emits
   *  `width="100%"` SVG, which an <img> sizes at the 300×150 default. */
  initialFit?: boolean;
}

type Natural = { w: number; h: number } | 'unknown' | null;

/**
 * Zoomable / pannable canvas rendering a single image source. Extracted from
 * ImageViewer so any preview that yields a URL (disk file, in-memory blob,
 * data URL) reuses the same gesture handling — wheel zoom, drag pan, pinch,
 * double-click toggle.
 *
 * The image renders at its natural pixel size (1:1) and `zoom` is relative to
 * that, so the % readout is the true scale. Fit-to-pane is opt-in: shrinking
 * a detailed SVG (13px text, 1px strokes) to half size is what made it read
 * as blurry. Small images are never upscaled by Fit.
 */
export function ZoomPanCanvas({ src, alt, className = 'image-viewer', initialFit = false }: ZoomPanCanvasProps) {
  const [zoom, setZoom] = useState(1);
  // null = not loaded yet; 'unknown' = engine reported 0×0 (viewBox-only SVG)
  // → the img falls back to object-contain fit and zoom is relative to that.
  const [natural, setNatural] = useState<Natural>(null);
  const naturalRef = useRef<Natural>(null);
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
  // Layout effect: must land before the new src's load event can set natural.
  useLayoutEffect(() => {
    naturalRef.current = null;
    setNatural(null);
    updateZoom(1);
    updatePan({ x: 0, y: 0 });
  }, [src, updateZoom, updatePan]);

  const fitZoom = useCallback(() => {
    const n = naturalRef.current;
    const canvas = canvasRef.current;
    if (!n || n === 'unknown' || !canvas || !canvas.clientWidth || !canvas.clientHeight) return 1;
    const z = Math.min(canvas.clientWidth / n.w, canvas.clientHeight / n.h);
    return clampZoom(initialFit ? z : Math.min(z, 1));
  }, [initialFit]);

  const showActual = useCallback(() => {
    updateZoom(1);
    updatePan({ x: 0, y: 0 });
  }, [updateZoom, updatePan]);

  const showFit = useCallback(() => {
    updateZoom(fitZoom());
    updatePan({ x: 0, y: 0 });
  }, [fitZoom, updateZoom, updatePan]);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    naturalRef.current = w > 0 && h > 0 ? { w, h } : 'unknown';
    setNatural(naturalRef.current);
    if (initialFit) showFit();
  }, [initialFit, showFit]);

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

  // 1:1 ↔ fit. When fit is also 1:1 (image smaller than the pane) the toggle
  // would be a no-op, so it zooms to 2× instead.
  const handleDoubleClick = useCallback(() => {
    const z = zoomRef.current;
    const p = panRef.current;
    if (Math.abs(z - 1) < 0.001 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1) {
      const fit = fitZoom();
      if (Math.abs(fit - 1) < 0.001) zoomAtCenter(2);
      else showFit();
    } else {
      showActual();
    }
  }, [fitZoom, zoomAtCenter, showFit, showActual]);

  const pct = Math.round(zoom * 100);
  const needsTransform = zoom !== 1 || pan.x !== 0 || pan.y !== 0;
  const btn = 'ivt-btn h-7 border-none bg-none rounded-md leading-none text-t1 cursor-pointer flex items-center justify-center hover:bg-hov';

  return (
    <div className={`${className} w-full h-full flex flex-col relative bg-surf overflow-hidden`}>
      <div className="image-viewer-toolbar absolute top-2 right-2 flex items-center gap-1 bg-panel border border-brd rounded-lg py-1 px-2 shadow-[0_2px_12px_rgba(0,0,0,.12)] opacity-70 transition-opacity duration-200 hover:opacity-100 z-10 select-none">
        <button className={`${btn} w-7 text-base`} type="button" onClick={zoomOut} title="Zoom out">−</button>
        <span className="min-w-[48px] text-center text-xs text-t2 font-mono">{pct}%</span>
        <button className={`${btn} w-7 text-base`} type="button" onClick={zoomIn} title="Zoom in">+</button>
        <button className={`${btn} px-1.5 text-xs`} type="button" onClick={showFit} title="Fit to window">Fit</button>
        <button className={`${btn} px-1.5 text-xs font-mono`} type="button" onClick={showActual} title="Actual size">1:1</button>
      </div>
      {/* Flex-centered so the img center stays the canvas center even when it
          overflows — the zoomAtPoint/zoomAtCenter math relies on it. */}
      <div
        className="image-viewer-canvas flex-1 min-h-0 flex items-center justify-center overflow-hidden cursor-grab [&.dragging]:cursor-grabbing"
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
          onLoad={handleLoad}
          className={`block select-none touch-none ${natural === 'unknown'
            ? 'w-full h-full object-contain'
            // max-w/h-none: override preflight's img { max-width:100% } so 1:1 is really 1:1.
            : 'shrink-0 max-w-none max-h-none'}`}
          style={needsTransform ? {
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          } : undefined}
        />
      </div>
    </div>
  );
}
