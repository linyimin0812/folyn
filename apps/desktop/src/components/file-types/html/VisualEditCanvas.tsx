import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { getBridgeScript } from './bridge';
import { FloatingToolbar } from './FloatingToolbar';
import { AttrPanel } from './AttrPanel';
import { StylePanel } from './StylePanel';

interface VisualEditCanvasProps {
  content: string;
  onChange: (content: string) => void;
}

interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

interface SelectedElement {
  quillId: string;
  rect: RectLike;
  tagName: string;
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
 * Uses DOMParser for robust handling of edge cases (nested content,
 * script-like strings in attributes, etc.).
 */
function sanitizeHtml(htmlStr: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlStr, 'text/html');
    doc.querySelectorAll('script').forEach((s) => s.remove());
    return doc.documentElement.outerHTML;
  } catch {
    // Fallback regex for environments where DOMParser is unavailable
    return htmlStr.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }
}

/**
 * Strip bridge-injected artifacts from extracted iframe HTML before saving.
 * Removes: bridge script tag, bridge styles, theme vars style, data-quill-id
 * attributes, quill-selected class, and any remaining <script> tags as a safety net.
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
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [iframeRect, setIframeRect] = useState<DOMRect | null>(null);
  const lastSyncedRef = useRef<string>('');

  // ── Phase 3: Panel state ──
  const [attrPanelOpen, setAttrPanelOpen] = useState(false);
  const [stylePanelOpen, setStylePanelOpen] = useState(false);

  // ── Phase 4: Undo/Redo ──
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const isUndoRedoRef = useRef(false);

  // ── Phase 5: Theme ──
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

  // Sync iframe when content changes externally (e.g., mode switch from source
  // back to visual while the component stays mounted). Only reloads when the
  // sanitized content actually differs from what we last synced.
  useEffect(() => {
    if (lastSyncedRef.current && lastSyncedRef.current !== sanitizedContent) {
      lastSyncedRef.current = sanitizedContent;
      // Clear stale selection — the element no longer exists after reload
      setSelected(null);
      // Close panels on external content change
      setAttrPanelOpen(false);
      setStylePanelOpen(false);
    } else if (!lastSyncedRef.current) {
      lastSyncedRef.current = sanitizedContent;
    }
  }, [sanitizedContent]);

  // ── Push a snapshot to the history stack ──
  const pushSnapshot = useCallback((rawHtml: string) => {
    const snapshot = buildSnapshot(rawHtml);
    const { stack, index } = historyRef.current;
    // Don't push duplicate of current position
    if (stack[index] === snapshot) return;
    // Truncate any forward history (after undo)
    const newStack = stack.slice(0, index + 1);
    newStack.push(snapshot);
    // Enforce max depth
    while (newStack.length > MAX_HISTORY) {
      newStack.shift();
    }
    historyRef.current = { stack: newStack, index: newStack.length - 1 };
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

    // Phase 5: Inject theme CSS vars so bridge edit styles follow app theme
    const existing = doc.getElementById('quill-theme-vars');
    if (existing) existing.remove();
    const themeStyle = doc.createElement('style');
    themeStyle.id = 'quill-theme-vars';
    themeStyle.textContent = effectiveTheme === 'dark' ? DARK_THEME_CSS : LIGHT_THEME_CSS;
    doc.head.appendChild(themeStyle);

    // Phase 4: Push initial snapshot if history is empty (first load)
    if (historyRef.current.stack.length === 0) {
      const html = doc.documentElement.outerHTML;
      const snapshot = buildSnapshot(html);
      historyRef.current = { stack: [snapshot], index: 0 };
    }

    // Clear undo/redo flag after iframe reload
    isUndoRedoRef.current = false;
  }, [effectiveTheme]);

  // ── Listen for messages from bridge ──
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.source !== 'quill-bridge') return;

      const iframe = iframeRef.current;
      if (!iframe) return;

      switch (event.data.type) {
        case 'select': {
          const iframeBoundingBox = iframe.getBoundingClientRect();
          setIframeRect(iframeBoundingBox);
          setSelected({
            quillId: event.data.quillId,
            rect: event.data.rect,
            tagName: event.data.tagName,
          });
          break;
        }
        case 'deselect':
          setSelected(null);
          setAttrPanelOpen(false);
          setStylePanelOpen(false);
          break;
        case 'change': {
          // Skip if this change was triggered by undo/redo
          if (isUndoRedoRef.current) break;
          // Debounce outerHTML extraction
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            const doc = iframeRef.current?.contentDocument;
            if (!doc) return;
            const html = doc.documentElement.outerHTML;
            const cleaned = stripBridgeArtifacts(html);
            const output = '<!DOCTYPE html>\n' + cleaned;
            // Push snapshot to history
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

  // ── Phase 5: Live-update theme CSS vars in the iframe when theme changes ──
  // This avoids a full iframe reload (which would reset DOM state / selections).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const existing = doc.getElementById('quill-theme-vars');
    if (!existing) return; // Not yet injected — will be set on next onLoad

    existing.textContent = effectiveTheme === 'dark' ? DARK_THEME_CSS : LIGHT_THEME_CSS;
  }, [effectiveTheme]);

  // Update iframe rect on scroll/resize
  useEffect(() => {
    function updateRect() {
      const iframe = iframeRef.current;
      if (iframe) {
        setIframeRect(iframe.getBoundingClientRect());
      }
    }
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, []);

  // ── Phase 4: Undo/Redo keyboard shortcuts ──
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept undo/redo when focus is in an input, textarea, or
      // contenteditable element (e.g., AttrPanel / StylePanel fields).
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
        // Redo: index++
        if (index >= stack.length - 1) return; // nothing to redo
        e.preventDefault();
        const newIndex = index + 1;
        historyRef.current.index = newIndex;
        isUndoRedoRef.current = true;
        const snapshot = stack[newIndex];
        // Notify parent — React will update iframe srcDoc via sanitizedContent
        onChangeRef.current(snapshot);
        setSelected(null);
        setAttrPanelOpen(false);
        setStylePanelOpen(false);
        // Clear flag after iframe reloads (bridge re-injects via onLoad).
        // The setTimeout is a fallback in case onLoad doesn't fire.
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = setTimeout(() => { isUndoRedoRef.current = false; }, 1000);
      } else {
        // Undo: index--
        if (index <= 0) return; // nothing to undo
        e.preventDefault();
        const newIndex = index - 1;
        historyRef.current.index = newIndex;
        isUndoRedoRef.current = true;
        const snapshot = stack[newIndex];
        // Notify parent — React will update iframe srcDoc via sanitizedContent
        onChangeRef.current(snapshot);
        setSelected(null);
        setAttrPanelOpen(false);
        setStylePanelOpen(false);
        // Clear flag after iframe reloads (bridge re-injects via onLoad).
        // The setTimeout is a fallback in case onLoad doesn't fire.
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

  // ── Bridge API helpers — call bridge functions directly via contentWindow ──
  const callBridge = useCallback((fn: string, ...args: unknown[]): unknown => {
    const iframe = iframeRef.current;
    const win = iframe?.contentWindow as (Window & { __bridge?: Record<string, (...a: unknown[]) => unknown> }) | null;
    if (!win?.__bridge?.[fn]) return undefined;
    return win.__bridge[fn](...args);
  }, []);

  const handleDelete = useCallback(() => {
    if (!selected) return;
    callBridge('removeElement', selected.quillId);
    setSelected(null);
    setAttrPanelOpen(false);
    setStylePanelOpen(false);
  }, [selected, callBridge]);

  const handleMoveUp = useCallback(() => {
    if (!selected) return;
    callBridge('moveElement', selected.quillId, 'up');
  }, [selected, callBridge]);

  const handleMoveDown = useCallback(() => {
    if (!selected) return;
    callBridge('moveElement', selected.quillId, 'down');
  }, [selected, callBridge]);

  // ── Phase 3: Panel open handlers (replace old prompt-based logic) ──
  const handleEditAttrs = useCallback(() => {
    if (!selected) return;
    setStylePanelOpen(false);
    setAttrPanelOpen((prev) => !prev);
  }, [selected]);

  const handleEditStyle = useCallback(() => {
    if (!selected) return;
    setAttrPanelOpen(false);
    setStylePanelOpen((prev) => !prev);
  }, [selected]);

  return (
    <div className="flex-1 relative overflow-hidden">
      <iframe
        ref={iframeRef}
        className="w-full h-full border-none bg-white"
        sandbox="allow-scripts allow-same-origin"
        srcDoc={sanitizedContent}
        title="HTML Visual Editor"
        onLoad={handleLoad}
        onClick={() => {
          setSelected(null);
          setAttrPanelOpen(false);
          setStylePanelOpen(false);
        }}
      />
      {selected && iframeRect && (
        <FloatingToolbar
          rect={selected.rect}
          iframeRect={iframeRect}
          tagName={selected.tagName}
          onDelete={handleDelete}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onEditAttrs={handleEditAttrs}
          onEditStyle={handleEditStyle}
        />
      )}
      {attrPanelOpen && selected && (
        <AttrPanel
          quillId={selected.quillId}
          tagName={selected.tagName}
          onClose={() => setAttrPanelOpen(false)}
          callBridge={callBridge}
        />
      )}
      {stylePanelOpen && selected && (
        <StylePanel
          quillId={selected.quillId}
          tagName={selected.tagName}
          onClose={() => setStylePanelOpen(false)}
          callBridge={callBridge}
        />
      )}
    </div>
  );
}
