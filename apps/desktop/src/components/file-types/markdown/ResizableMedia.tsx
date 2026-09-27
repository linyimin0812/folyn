import { useRef, useState } from 'react';
import { applyFenceWidth, applyImageSize, getResizedMediaWidth, readSourceWidth } from './mediaResize';

export interface ResizableMediaProps {
  kind: 'img' | 'fence';
  sourceLine: number | undefined;
  contentRef: React.MutableRefObject<string>;
  onChangeRef: React.MutableRefObject<((content: string) => void) | undefined>;
  // ponytail: optional — createElement(ResizableMedia, {...}, child) injects
  // child as props.children at runtime; making it required trips TS2769.
  children?: React.ReactNode;
}

/** Wrap an <img> or fence-renderer output with a right-bottom drag handle.
 *  Width-only resize; inner media fills 100% of the wrapper via CSS.
 *  On commit, write the new width back to the markdown source line. */
export function ResizableMedia({ kind, sourceLine, contentRef, onChangeRef, children }: ResizableMediaProps) {
  // ponytail: lazy init from source so re-mount after writeback doesn't flash
  // through width=null — handle would visibly jump from natural-size position
  // back to the persisted width otherwise.
  const [width, setWidth] = useState<number | null>(() => readSourceWidth(kind, contentRef.current, sourceLine));
  const widthRef = useRef<number | null>(null);
  widthRef.current = width;
  const dragRef = useRef<{ startX: number; startW: number; maxW: number; wallRight: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const wrapper = wrapperRef.current ?? e.currentTarget.parentElement as HTMLElement | null;
    // ponytail: walk all ancestors, snapshot the narrowest one's width (maxW)
    // and right edge (wallRight). The wrapper is centered (margin:auto) so its
    // right edge moves as it grows; the wall stays put. Comparing the wrapper's
    // CURRENT rendered right edge (which respects CSS max-width:100% capping)
    // to wallRight tells us when to freeze — robust against float-valued maxW
    // and state that hasn't yet reached the clamp. Narrowest ancestor handles
    // preview-only mode where the immediate <p> parent is wider than the pane.
    let maxW = Infinity;
    let wallRight = Infinity;
    let ancestor = wrapper?.parentElement ?? null;
    while (ancestor) {
      const r = ancestor.getBoundingClientRect();
      if (r.width < maxW) {
        maxW = r.width;
        wallRight = r.right;
      }
      ancestor = ancestor.parentElement;
    }
    dragRef.current = {
      startX: e.clientX,
      startW: wrapper?.getBoundingClientRect().width ?? 0,
      maxW,
      wallRight,
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    // ponytail: freeze on rightward drag at the wall — when the wrapper's
    // current rendered right edge has reached the wall (snapshot from
    // pointerdown), further rightward dx doesn't enlarge the image or move
    // the handle. Uses getBoundingClientRect().right, which respects CSS
    // max-width:100% capping. Leftward dx (shrink) always allowed.
    if (dx > 0) {
      const currentRight = wrapperRef.current?.getBoundingClientRect().right ?? -Infinity;
      if (currentRight >= dragRef.current.wallRight - 1) return;
    }
    const nextWidth = getResizedMediaWidth(dragRef.current.startW, dx, dragRef.current.maxW);
    setWidth(nextWidth);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* pointer already released */ }
    const w = widthRef.current;
    if (w == null) return;
    const content = contentRef.current;
    const onChange = onChangeRef.current;
    if (!content || sourceLine == null || !onChange) return;
    const next = kind === 'img' ? applyImageSize(content, sourceLine, w) : applyFenceWidth(content, sourceLine, w);
    if (next !== content) onChange(next);
  };
  const onDoubleClick = () => {
    const content = contentRef.current;
    const onChange = onChangeRef.current;
    setWidth(null);
    if (!content || sourceLine == null || !onChange) return;
    const next = kind === 'img' ? applyImageSize(content, sourceLine, null) : applyFenceWidth(content, sourceLine, null);
    if (next !== content) onChange(next);
  };

  // ponytail: width-only resize, height auto-derived — inner img/svg keep their
  // natural aspect ratio via CSS height:auto. Shift-unlock is a no-op here since
  // height was never constrained; add height state if independent H ever needed.
  // Wrapper stays centered (margin:auto) throughout drag — handle drifts at
  // half cursor speed because the wrapper grows symmetrically; accepted tradeoff
  // vs. the layout-jump alternative (left during drag, centered after release).
  return (
    <div
      className="resizable-media"
      ref={wrapperRef}
      // ponytail: stamp the source line so extension-rendered code fences
      // (mermaid/plantuml/dot — the renderer path in map['pre']) participate
      // in cursor-sync selection/highlight and the gap-compensation grid;
      // without it they had NO alignment target (the CodeBlockWrapper path
      // stamps its own div). For images this duplicates the inner <img>'s
      // stamp — same line, the later-in-DOM img wins the selection, harmless.
      data-source-line={sourceLine}
      style={width != null ? { width: `${width}px`, height: 'auto' } : undefined}
    >
      {children}
      <div
        className="resize-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}
