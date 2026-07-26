import { useRef, useState, useEffect, useCallback } from 'react';
import i18n from '@/i18n';

interface UseDragDropOptions {
  selectedPaths: Set<string>;
  moveFiles: (paths: string[], targetDir: string) => Promise<void>;
  onSelectionClear: () => void;
}

interface UseDragDropReturn {
  dragOverDir: string | null;
  /** True for a brief moment after a drop — keeps `:hover` suppressed while
   *  the file tree rerenders into its new layout, so the row that ends up
   *  under the cursor doesn't flash a hover bg. */
  suppressHover: boolean;
  handleItemMouseDown: (e: React.MouseEvent, path: string) => void;
}

export function useDragDrop({
  selectedPaths,
  moveFiles,
  onSelectionClear,
}: UseDragDropOptions): UseDragDropReturn {
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);
  const [suppressHover, setSuppressHover] = useState(false);
  const suppressHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mouseDragState = useRef<{
    startX: number;
    startY: number;
    paths: string[];
    active: boolean;
    ghost: HTMLDivElement | null;
    dropTarget: string | null;
  } | null>(null);

  const handleItemMouseDown = useCallback(
    (e: React.MouseEvent, path: string) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.ft-actions, .ft-rename-input, .ft-act-btn, input, button')) return;

      // ponytail: a new drag cancels any lingering post-drop hover suppression.
      if (suppressHoverTimer.current) {
        clearTimeout(suppressHoverTimer.current);
        suppressHoverTimer.current = null;
      }
      if (suppressHover) setSuppressHover(false);

      const paths = selectedPaths.has(path) ? Array.from(selectedPaths) : [path];

      mouseDragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        paths,
        active: false,
        ghost: null,
        dropTarget: null,
      };
    },
    [selectedPaths, suppressHover],
  );

  const moveFilesRef = useRef(moveFiles);
  moveFilesRef.current = moveFiles;

  const onSelectionClearRef = useRef(onSelectionClear);
  onSelectionClearRef.current = onSelectionClear;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // ponytail: clear post-drop hover suppression on the first mousemove
      // after a drop — the user has moved the mouse, so any :hover that
      // lands on the row now under the cursor is intentional, not a stuck
      // artifact of the tree rerendering into its new layout.
      if (suppressHoverTimer.current && !mouseDragState.current) {
        clearSuppressTimer();
      }

      const state = mouseDragState.current;
      if (!state) return;

      if (!state.active) {
        const dx = Math.abs(e.clientX - state.startX);
        const dy = Math.abs(e.clientY - state.startY);
        if (dx < 5 && dy < 5) return;
        state.active = true;

        const ghost = document.createElement('div');
        Object.assign(ghost.style, {
          position: 'fixed', zIndex: '99999', pointerEvents: 'none',
          padding: '4px 10px', borderRadius: '4px',
          background: 'var(--acc)', color: '#fff',
          fontSize: '12px', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap',
          boxShadow: '0 2px 8px rgba(0,0,0,.2)', opacity: '0.9',
        });
        ghost.textContent = state.paths.length === 1
          ? (state.paths[0].includes('/') ? state.paths[0].substring(state.paths[0].lastIndexOf('/') + 1) : state.paths[0])
          : i18n.t('sidebar:dragDrop.itemsCount', { count: state.paths.length });
        document.body.appendChild(ghost);
        state.ghost = ghost;
      }

      if (state.ghost) {
        state.ghost.style.left = `${e.clientX + 12}px`;
        state.ghost.style.top = `${e.clientY + 12}px`;
      }

      if (state.ghost) state.ghost.style.display = 'none';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (state.ghost) state.ghost.style.display = '';

      let newTarget: string | null = null;
      if (el) {
        const dirItem = (el as HTMLElement).closest('[data-dirpath]') as HTMLElement | null;
        if (dirItem) {
          newTarget = dirItem.getAttribute('data-dirpath')!;
        } else {
          const sbBody = (el as HTMLElement).closest('.sb-body') as HTMLElement | null;
          if (sbBody) {
            newTarget = '';
          }
        }
      }

      state.dropTarget = newTarget;
      setDragOverDir(newTarget);
    };

    const cleanup = () => {
      const state = mouseDragState.current;
      if (!state) return;
      if (state.ghost) state.ghost.remove();
      mouseDragState.current = null;
      setDragOverDir(null);
      clearSuppressTimer();
    };

    const handleMouseUp = () => {
      const state = mouseDragState.current;
      if (!state) return;

      const wasActive = state.active;
      const paths = state.paths;
      const dropTarget = state.dropTarget;

      // ponytail: cleanup runs sync before the async move so a hung promise
      // (or a mouseup that the document listener misses — e.g. release
      // outside the webview window) can't strand the ghost in the DOM.
      if (state.ghost) state.ghost.remove();
      mouseDragState.current = null;
      setDragOverDir(null);

      if (wasActive && paths.length > 0 && dropTarget !== null) {
        // ponytail: clear selection synchronously before the async move —
        // otherwise stale selectedPaths (pointing at the OLD paths) linger
        // through the rename await and the fileTree refresh, and any row
        // that happens to reuse a moved path lights up as "selected".
        onSelectionClearRef.current();
        moveFilesRef.current(paths, dropTarget)
          .then(() => onSelectionClearRef.current())
          .catch(() => {});
        // ponytail: keep :hover suppressed briefly after a real drop — the
        // tree rerenders into a new layout and the row now under the cursor
        // (often B or C, not the original A) would otherwise light up as if
        // the user were hovering it. Cleared by the next mousedown or timer.
        if (suppressHoverTimer.current) clearTimeout(suppressHoverTimer.current);
        setSuppressHover(true);
        suppressHoverTimer.current = setTimeout(() => setSuppressHover(false), 400);
      }
    };

    const clearSuppressTimer = () => {
      if (suppressHoverTimer.current) {
        clearTimeout(suppressHoverTimer.current);
        suppressHoverTimer.current = null;
      }
      setSuppressHover(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    // ponytail: webview may swallow mouseup when the button is released
    // outside the window; cancel the drag on blur so the ghost can't strand.
    window.addEventListener('blur', cleanup);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', cleanup);
    };
  }, []);

  return { dragOverDir, suppressHover, handleItemMouseDown };
}
