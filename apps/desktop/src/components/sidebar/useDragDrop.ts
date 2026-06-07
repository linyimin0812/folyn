import { useRef, useState, useEffect, useCallback } from 'react';

interface UseDragDropOptions {
  selectedPaths: Set<string>;
  moveFiles: (paths: string[], targetDir: string) => Promise<void>;
  onSelectionClear: () => void;
}

interface UseDragDropReturn {
  dragOverDir: string | null;
  handleItemMouseDown: (e: React.MouseEvent, path: string) => void;
}

export function useDragDrop({
  selectedPaths,
  moveFiles,
  onSelectionClear,
}: UseDragDropOptions): UseDragDropReturn {
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);

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
    [selectedPaths],
  );

  const moveFilesRef = useRef(moveFiles);
  moveFilesRef.current = moveFiles;

  const onSelectionClearRef = useRef(onSelectionClear);
  onSelectionClearRef.current = onSelectionClear;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
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
          : `${state.paths.length} 个项目`;
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

    const handleMouseUp = async () => {
      const state = mouseDragState.current;
      if (!state) return;

      if (state.ghost) {
        state.ghost.remove();
      }

      if (state.active && state.paths.length > 0 && state.dropTarget !== null) {
        await moveFilesRef.current(state.paths, state.dropTarget);
        onSelectionClearRef.current();
      }

      mouseDragState.current = null;
      setDragOverDir(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return { dragOverDir, handleItemMouseDown };
}
