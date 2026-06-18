import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { getBridgeScript } from './bridge';
import { PropertiesPanel } from './PropertiesPanel';

interface VisualEditCanvasProps {
  content: string;
  onChange: (content: string) => void;
}

interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SelectedElement {
  quillId: string;
  rect: RectLike;
  tagName: string;
  positionType: string;
}

interface HoverElement {
  quillId: string;
  rect: RectLike;
}

interface DragState {
  x: number;
  y: number;
  w: number;
  h: number;
  snappedX: number[];
  snappedY: number[];
}

interface PaddingDragState {
  side: string;
  value: number;
}

const MAX_HISTORY = 50;

const DARK_THEME_CSS = `:root {
  --acc: #5b8af5;
  --panel: #0f1219;
  --brd: #1c2136;
  --t1: #e2e8f8;
  --hov: #1b1f2e;
}`;

const LIGHT_THEME_CSS = `:root {
  --acc: #3a6ef0;
  --panel: #fff;
  --brd: #dde2f0;
  --t1: #1a2040;
  --hov: #e8ecf8;
}`;

/**
 * Strip <script> tags from HTML content to freeze page scripts.
 * Our bridge script is injected separately after iframe load.
 * Uses DOMParser for robust handling.
 */
function sanitizeHtml(htmlStr: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlStr, 'text/html');
    doc.querySelectorAll('script').forEach((s) => s.remove());
    return doc.documentElement.outerHTML;
  } catch {
    return htmlStr.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }
}

/**
 * Strip bridge-injected artifacts from extracted iframe HTML before saving.
 * Removes: bridge script tag, bridge styles, theme vars style, data-quill-id
 * attributes, quill-selected class, outline styles, and any remaining <script> tags.
 */
function stripBridgeArtifacts(html: string): string {
  // Remove bridge script tag(s) by id
  let cleaned = html.replace(/<script\b[^>]*id=["']quill-bridge-script["'][\s\S]*?<\/script>/gi, '');
  // Remove bridge styles by id
  cleaned = cleaned.replace(/<style\b[^>]*id=["']quill-bridge-styles["'][\s\S]*?<\/style>/gi, '');
  // Remove theme vars style by id
  cleaned = cleaned.replace(/<style\b[^>]*id=["']quill-theme-vars["'][\s\S]*?<\/style>/gi, '');
  // Remove data-quill-id attributes from all elements
  cleaned = cleaned.replace(/\s+data-quill-id="[^"]*"/g, '');
  // Remove quill-selected class from class attributes
  cleaned = cleaned.replace(/\s*quill-selected\b/g, '');
  // Remove inline outline/outline-offset styles injected by bridge for selection/hover
  cleaned = cleaned.replace(/\s*style="([^"]*)"/g, (_match, styleVal: string) => {
    const cleanedStyle = styleVal
      .replace(/outline\s*:[^;]+;?/g, '')
      .replace(/outline-offset\s*:[^;]+;?/g, '')
      .replace(/cursor\s*:\s*pointer\s*;?/g, '')
      .trim();
    return cleanedStyle ? ` style="${cleanedStyle}"` : '';
  });
  // Clean up empty class attributes left behind
  cleaned = cleaned.replace(/\s*class=""\s*/g, ' ');
  // Safety net: strip any remaining <script> tags
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  return cleaned;
}

/** Build a normalized snapshot string from raw iframe outerHTML */
function buildSnapshot(rawHtml: string): string {
  return '<!DOCTYPE html>\n' + stripBridgeArtifacts(rawHtml);
}

export function VisualEditCanvas({ content, onChange }: VisualEditCanvasProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onChangeRef = useRef(onChange);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedRef = useRef<string>('');

  // ── Selection / Hover ──
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [hover, setHover] = useState<HoverElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // ── Drag ──
  const [isDragging, setIsDragging] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);

  // ── Resize ──
  const [isResizing, setIsResizing] = useState(false);

  // ── Padding drag ──
  const [paddingDrag, setPaddingDrag] = useState<PaddingDragState | null>(null);

  // ── Mouse screen position (for tooltips) ──
  const [mouseScreen, setMouseScreen] = useState({ x: 0, y: 0 });

  // ── Undo/Redo ──
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const isUndoRedoRef = useRef(false);

  // ── Theme ──
  const theme = useSettingsStore((state) => state.theme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    function handleChange(e: MediaQueryListEvent) {
      setSystemDark(e.matches);
    }
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  const effectiveTheme = useMemo(() => {
    if (theme === 'system') return systemDark ? 'dark' : 'light';
    return theme;
  }, [theme, systemDark]);

  onChangeRef.current = onChange;

  // Sanitize HTML: strip <script> tags so page JS is frozen
  const sanitizedContent = useMemo(() => sanitizeHtml(content), [content]);

  // ── Push a snapshot to the history stack ──
  const pushSnapshot = useCallback((rawHtml: string) => {
    const snapshot = buildSnapshot(rawHtml);
    const { stack, index } = historyRef.current;
    if (stack[index] === snapshot) return;
    const newStack = stack.slice(0, index + 1);
    newStack.push(snapshot);
    while (newStack.length > MAX_HISTORY) {
      newStack.shift();
    }
    historyRef.current = { stack: newStack, index: newStack.length - 1 };
  }, []);

  // ── Bridge API helpers ──
  const callBridge = useCallback((fn: string, ...args: unknown[]): unknown => {
    const iframe = iframeRef.current;
    const win = iframe?.contentWindow as (Window & { __bridge?: Record<string, (...a: unknown[]) => unknown> }) | null;
    if (!win?.__bridge?.[fn]) return undefined;
    return win.__bridge[fn](...args);
  }, []);

  // ── Inject bridge + theme on iframe load ──
  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    // Inject bridge script
    const script = doc.createElement('script');
    script.id = 'quill-bridge-script';
    script.textContent = getBridgeScript();
    doc.head.appendChild(script);

    // Inject theme CSS vars
    const existing = doc.getElementById('quill-theme-vars');
    if (existing) existing.remove();
    const themeStyle = doc.createElement('style');
    themeStyle.id = 'quill-theme-vars';
    themeStyle.textContent = effectiveTheme === 'dark' ? DARK_THEME_CSS : LIGHT_THEME_CSS;
    doc.head.appendChild(themeStyle);

    // Push initial snapshot if history is empty (first load)
    if (historyRef.current.stack.length === 0) {
      const html = doc.documentElement.outerHTML;
      const snapshot = buildSnapshot(html);
      historyRef.current = { stack: [snapshot], index: 0 };
    }

    isUndoRedoRef.current = false;
  }, [effectiveTheme]);

  // ── Listen for messages from bridge ──
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.source !== 'quill-bridge') return;

      const iframe = iframeRef.current;
      if (!iframe) return;

      const data = event.data;

      switch (data.type) {
        case 'select': {
          setSelected({
            quillId: data.quillId,
            rect: data.rect,
            tagName: data.tagName,
            positionType: data.positionType || 'static',
          });
          setHover(null);
          break;
        }
        case 'deselect':
          setSelected(null);
          setHover(null);
          setIsEditing(false);
          // Clear all interaction states — deselect is also posted by bridge init()
          // on iframe reload, which can happen mid-drag/mid-resize/mid-padding
          setIsDragging(false);
          setDragState(null);
          setIsResizing(false);
          setPaddingDrag(null);
          break;
        case 'hover':
          setHover({ quillId: data.quillId, rect: data.rect });
          break;
        case 'hoverEnd':
          setHover(null);
          break;
        case 'dragStart':
          setIsDragging(true);
          break;
        case 'dragging':
          setDragState({
            x: data.x,
            y: data.y,
            w: data.w,
            h: data.h,
            snappedX: data.snappedX || [],
            snappedY: data.snappedY || [],
          });
          break;
        case 'dragEnd':
          setIsDragging(false);
          setDragState(null);
          {
            const doc = iframeRef.current?.contentDocument;
            if (doc) pushSnapshot(doc.documentElement.outerHTML);
          }
          break;
        case 'editing':
          setIsEditing(true);
          break;
        case 'editDone':
          setIsEditing(false);
          {
            const doc = iframeRef.current?.contentDocument;
            if (doc) pushSnapshot(doc.documentElement.outerHTML);
          }
          break;
        case 'nudge': {
          const doc = iframeRef.current?.contentDocument;
          if (doc) pushSnapshot(doc.documentElement.outerHTML);
          break;
        }
        case 'paddingDrag':
          setPaddingDrag({ side: data.side, value: data.value });
          break;
        case 'paddingEnd':
          setPaddingDrag(null);
          {
            const doc = iframeRef.current?.contentDocument;
            if (doc) pushSnapshot(doc.documentElement.outerHTML);
          }
          break;
        case 'resizeStart':
          setIsResizing(true);
          break;
        case 'resizing':
          // Update selected rect during resize for overlay rendering
          setSelected((prev) =>
            prev ? { ...prev, rect: { ...prev.rect, w: data.w, h: data.h } } : null,
          );
          break;
        case 'resizeEnd':
          setIsResizing(false);
          {
            const doc = iframeRef.current?.contentDocument;
            if (doc) pushSnapshot(doc.documentElement.outerHTML);
          }
          break;
        case 'change': {
          if (isUndoRedoRef.current) break;
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            const doc = iframeRef.current?.contentDocument;
            if (!doc) return;
            const html = doc.documentElement.outerHTML;
            const cleaned = stripBridgeArtifacts(html);
            const output = '<!DOCTYPE html>\n' + cleaned;
            pushSnapshot(html);
            onChangeRef.current(output);
          }, 500);
          break;
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [pushSnapshot]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Sync external content changes ──
  useEffect(() => {
    if (lastSyncedRef.current && lastSyncedRef.current !== sanitizedContent) {
      lastSyncedRef.current = sanitizedContent;
      setSelected(null);
      setHover(null);
    } else if (!lastSyncedRef.current) {
      lastSyncedRef.current = sanitizedContent;
    }
  }, [sanitizedContent]);

  // ── Live-update theme in iframe ──
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    const existing = doc.getElementById('quill-theme-vars');
    if (!existing) return;
    existing.textContent = effectiveTheme === 'dark' ? DARK_THEME_CSS : LIGHT_THEME_CSS;
  }, [effectiveTheme]);

  // ── Undo/Redo keyboard shortcuts ──
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      if (e.key.toLowerCase() !== 'z') return;

      const isRedo = e.shiftKey;
      const { stack, index } = historyRef.current;

      if (isRedo) {
        if (index >= stack.length - 1) return;
        e.preventDefault();
        const newIndex = index + 1;
        historyRef.current.index = newIndex;
        isUndoRedoRef.current = true;
        const snapshot = stack[newIndex];
        onChangeRef.current(snapshot);
        setSelected(null);
        setHover(null);
        setIsEditing(false);
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = setTimeout(() => { isUndoRedoRef.current = false; }, 1000);
      } else {
        if (index <= 0) return;
        e.preventDefault();
        const newIndex = index - 1;
        historyRef.current.index = newIndex;
        isUndoRedoRef.current = true;
        const snapshot = stack[newIndex];
        onChangeRef.current(snapshot);
        setSelected(null);
        setHover(null);
        setIsEditing(false);
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = setTimeout(() => { isUndoRedoRef.current = false; }, 1000);
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, []);

  // ── Coordinate conversion: iframe-local → overlay position ──
  // Overlay positions are iframe-local coordinates directly,
  // since the overlay div and iframe share the same container.
  const overlayX = useCallback((x: number) => x, []);
  const overlayY = useCallback((y: number) => y, []);

  // ── Padding drag (host-side mouse tracking) ──
  const startPaddingDrag = useCallback(
    (side: string) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selected) return;

      callBridge('startPaddingDrag', selected.quillId, side);

      const startX = e.clientX;
      const startY = e.clientY;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      function onMove(ev: PointerEvent) {
        setMouseScreen({ x: ev.clientX, y: ev.clientY });
        let delta: number;
        if (side === 'left' || side === 'right') {
          delta = side === 'right' ? ev.clientX - startX : startX - ev.clientX;
        } else {
          delta = side === 'bottom' ? ev.clientY - startY : startY - ev.clientY;
        }
        callBridge('updatePaddingDrag', delta);
      }

      function onUp(ev: PointerEvent) {
        target.releasePointerCapture(ev.pointerId);
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        callBridge('endPaddingDrag');
      }

      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
    },
    [selected, callBridge],
  );

  // ── Resize drag (host-side mouse tracking) ──
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selected) return;

      callBridge('startResize', selected.quillId);

      const startX = e.clientX;
      const startY = e.clientY;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      function onMove(ev: PointerEvent) {
        setMouseScreen({ x: ev.clientX, y: ev.clientY });
        const deltaX = ev.clientX - startX;
        const deltaY = ev.clientY - startY;
        callBridge('updateResize', deltaX, deltaY);
      }

      function onUp(ev: PointerEvent) {
        target.releasePointerCapture(ev.pointerId);
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        callBridge('endResize');
      }

      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
    },
    [selected, callBridge],
  );

  // ── Track mouse screen position during element drag (for tooltip) ──
  useEffect(() => {
    if (!isDragging) return;
    function handleMove(e: MouseEvent) {
      setMouseScreen({ x: e.clientX, y: e.clientY });
    }
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, [isDragging]);

  // ── Stop stuck element drag when mouseup fires outside the iframe ──
  // Element drag uses iframe-document mouseup, which doesn't fire if the
  // user releases the mouse button in the host window. This host-level
  // listener catches that case. stopDrag() is idempotent — safe to call
  // even after the bridge has already stopped the drag internally.
  useEffect(() => {
    if (!isDragging) return;
    function handleMouseUp() {
      callBridge('stopDrag');
    }
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [isDragging, callBridge]);

  return (
    <div className="flex-1 relative overflow-hidden">
      {/* Iframe */}
      <iframe
        ref={iframeRef}
        className="w-full h-full border-none bg-white"
        sandbox="allow-scripts allow-same-origin"
        srcDoc={sanitizedContent}
        title="HTML Visual Editor"
        onLoad={handleLoad}
      />

      {/* Hover highlight */}
      {hover && !isDragging && !isResizing && (
        <div
          style={{
            left: overlayX(hover.rect.x),
            top: overlayY(hover.rect.y),
            width: hover.rect.w,
            height: hover.rect.h,
          }}
          className="absolute border border-dashed border-[#3a6ef0] opacity-40 pointer-events-none"
        />
      )}

      {/* Selection box */}
      {selected && !isDragging && (
        <div
          style={{
            left: overlayX(selected.rect.x),
            top: overlayY(selected.rect.y),
            width: selected.rect.w,
            height: selected.rect.h,
          }}
          className="absolute border-2 border-[#3a6ef0] pointer-events-none"
        />
      )}

      {/* Tag tooltip — above selection box */}
      {selected && !isDragging && (
        <div
          style={{
            left: overlayX(selected.rect.x),
            top: overlayY(selected.rect.y) - 22,
          }}
          className="absolute text-[10px] bg-[#3a6ef0] text-white px-1.5 py-0.5 rounded-sm pointer-events-none whitespace-nowrap"
        >
          {selected.tagName}{' '}
          {selected.positionType === 'absolute' ? '[absolute]' : ''}
        </div>
      )}

      {/* Padding handles — 4 directional drag bars (6px wide/tall) */}
      {selected && !isDragging && !isEditing && !isResizing && (
        <>
          <div
            className="absolute bg-[#3a6ef0] opacity-30 cursor-n-resize touch-none"
            style={{
              left: overlayX(selected.rect.x),
              top: overlayY(selected.rect.y) - 3,
              width: selected.rect.w,
              height: 6,
            }}
            onPointerDown={startPaddingDrag('top')}
          />
          <div
            className="absolute bg-[#3a6ef0] opacity-30 cursor-s-resize touch-none"
            style={{
              left: overlayX(selected.rect.x),
              top: overlayY(selected.rect.y) + selected.rect.h - 3,
              width: selected.rect.w,
              height: 6,
            }}
            onPointerDown={startPaddingDrag('bottom')}
          />
          <div
            className="absolute bg-[#3a6ef0] opacity-30 cursor-w-resize touch-none"
            style={{
              left: overlayX(selected.rect.x) - 3,
              top: overlayY(selected.rect.y),
              width: 6,
              height: selected.rect.h,
            }}
            onPointerDown={startPaddingDrag('left')}
          />
          <div
            className="absolute bg-[#3a6ef0] opacity-30 cursor-e-resize touch-none"
            style={{
              left: overlayX(selected.rect.x) + selected.rect.w - 3,
              top: overlayY(selected.rect.y),
              width: 6,
              height: selected.rect.h,
            }}
            onPointerDown={startPaddingDrag('right')}
          />
        </>
      )}

      {/* Resize handle — bottom-right 10x10 */}
      {selected && !isDragging && !isEditing && (
        <div
          className="absolute w-2.5 h-2.5 bg-[#3a6ef0] cursor-se-resize touch-none"
          style={{
            left: overlayX(selected.rect.x) + selected.rect.w - 5,
            top: overlayY(selected.rect.y) + selected.rect.h - 5,
          }}
          onPointerDown={startResize}
        />
      )}

      {/* Snap guide lines — vertical */}
      {dragState?.snappedX?.map((x, i) => (
        <div
          key={`sx${i}`}
          className="absolute top-0 bottom-0 border-l border-dashed border-[#3a6ef0] pointer-events-none"
          style={{ left: overlayX(x) }}
        />
      ))}

      {/* Snap guide lines — horizontal */}
      {dragState?.snappedY?.map((y, i) => (
        <div
          key={`sy${i}`}
          className="absolute left-0 right-0 border-t border-dashed border-[#3a6ef0] pointer-events-none"
          style={{ top: overlayY(y) }}
        />
      ))}

      {/* Coordinate tooltip — during element drag */}
      {isDragging && dragState && (
        <div
          className="fixed text-[10px] bg-panel border border-brd px-1.5 py-0.5 rounded shadow-sm pointer-events-none z-50"
          style={{ left: mouseScreen.x + 16, top: mouseScreen.y + 16 }}
        >
          x: {Math.round(dragState.x)} y: {Math.round(dragState.y)}
        </div>
      )}

      {/* Padding tooltip — during padding drag */}
      {paddingDrag && (
        <div
          className="fixed text-[10px] bg-panel border border-brd px-1.5 py-0.5 rounded shadow-sm pointer-events-none z-50"
          style={{ left: mouseScreen.x + 16, top: mouseScreen.y + 16 }}
        >
          padding-{paddingDrag.side}: {Math.round(paddingDrag.value)}px
        </div>
      )}

      {/* Properties panel */}
      {selected && !isDragging && !isEditing && !isResizing && (
        <PropertiesPanel
          quillId={selected.quillId}
          tagName={selected.tagName}
          callBridge={callBridge}
        />
      )}
    </div>
  );
}
