import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import type { PreviewProps } from '../types';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items?: OutlineItem[];
  pageNumber?: number;
}

const OVERSCAN = 5;
const GAP = 12;

export function PdfViewer({ filePath, vaultRoot }: PreviewProps) {
  const [src, setSrc] = useState('');
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [currentPage, setCurrentPage] = useState(1);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([1, 10]);
  const [activeOutlineTitle, setActiveOutlineTitle] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<unknown>(null);
  const pageDims = useRef({ w: 612, h: 792 });
  const rafRef = useRef<number>(0);
  const lastRangeRef = useRef<[number, number]>([1, 10]);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const gestureCleanupRef = useRef<HTMLElement | null>(null);
  const prevScaleRef = useRef(0);

  useEffect(() => {
    if (!vaultRoot) return;
    import('@tauri-apps/api/path').then(({ homeDir, join }) => {
      const resolvedRoot = vaultRoot.startsWith('~')
        ? homeDir().then((h) => join(h, vaultRoot.slice(2)))
        : Promise.resolve(vaultRoot);
      resolvedRoot.then((root) => join(root, filePath)).then((absPath) => {
        setSrc(convertFileSrc(absPath));
      });
    });
  }, [filePath, vaultRoot]);

  const resolvePageNumber = useCallback(async (dest: unknown, pdf: any): Promise<number | undefined> => {
    try {
      let ref: unknown;
      if (typeof dest === 'string') {
        const resolved = await pdf.getDestination(dest);
        if (!resolved) return undefined;
        ref = resolved[0];
      } else if (Array.isArray(dest)) {
        ref = dest[0];
      } else {
        return undefined;
      }
      const pageIndex = await pdf.getPageIndex(ref);
      return pageIndex + 1;
    } catch {
      return undefined;
    }
  }, []);

  const resolveOutline = useCallback(async (items: OutlineItem[], pdf: any): Promise<OutlineItem[]> => {
    const resolved = await Promise.all(items.map(async (item) => {
      const [pageNumber, children] = await Promise.all([
        item.dest ? resolvePageNumber(item.dest, pdf) : Promise.resolve(undefined),
        item.items?.length ? resolveOutline(item.items, pdf) : Promise.resolve(undefined),
      ]);
      return { ...item, pageNumber, items: children };
    }));
    return resolved;
  }, [resolvePageNumber]);

  const onDocumentLoadSuccess = useCallback(async (result: { numPages: number }) => {
    setNumPages(result.numPages);
    setCurrentPage(1);
    const initialRange: [number, number] = [1, Math.min(10, result.numPages)];
    setVisibleRange(initialRange);
    lastRangeRef.current = initialRange;

    const pdf = (result as any)._transport?._pdfDocument ?? (result as any);
    pdfDocRef.current = pdf;

    try {
      const page1 = await pdf.getPage(1);
      const vp = page1.getViewport({ scale: 1 });
      pageDims.current = { w: vp.width, h: vp.height };
    } catch { /* keep defaults */ }

    try {
      const raw = await pdf.getOutline();
      if (raw && raw.length > 0) {
        const resolved = await resolveOutline(raw, pdf);
        setOutline(resolved);
        setOutlineVisible(true);
      } else {
        setOutline([]);
      }
    } catch {
      setOutline([]);
    }
  }, [resolveOutline]);

  useLayoutEffect(() => {
    const el = gestureCleanupRef.current;
    if (!el) return;
    el.style.transform = '';
    el.style.transformOrigin = '';
    el.style.willChange = '';
    gestureCleanupRef.current = null;
  }, [scale]);

  useLayoutEffect(() => {
    const prev = prevScaleRef.current;
    prevScaleRef.current = scale;

    const container = containerRef.current;
    if (!container || numPages === 0) return;

    if (prev > 0 && prev !== scale) {
      container.scrollTop *= scale / prev;
    }

    const h = pageDims.current.h * scale + GAP;
    const scrollTop = container.scrollTop;
    const viewHeight = container.clientHeight;

    const firstVisible = Math.max(1, Math.floor(scrollTop / h) + 1);
    const lastVisible = Math.min(numPages, Math.ceil((scrollTop + viewHeight) / h) + 1);

    const newStart = Math.max(1, firstVisible - OVERSCAN);
    const newEnd = Math.min(numPages, lastVisible + OVERSCAN);

    const [ps, pe] = lastRangeRef.current;
    if (newStart !== ps || newEnd !== pe) {
      lastRangeRef.current = [newStart, newEnd];
      setVisibleRange([newStart, newEnd]);
    }
  }, [scale, numPages]);

  useEffect(() => {
    if (numPages === 0) return;
    const id = requestAnimationFrame(() => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth - 16;
        setScale(containerWidth / pageDims.current.w);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [numPages, outlineVisible]);

  const updateVisibleRange = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const container = containerRef.current;
      if (!container || numPages === 0) return;

      const scrollTop = container.scrollTop;
      const viewHeight = container.clientHeight;
      const h = pageDims.current.h * scale + GAP;

      const firstVisible = Math.max(1, Math.floor(scrollTop / h) + 1);
      const lastVisible = Math.min(numPages, Math.ceil((scrollTop + viewHeight) / h) + 1);

      const newStart = Math.max(1, firstVisible - OVERSCAN);
      const newEnd = Math.min(numPages, lastVisible + OVERSCAN);

      const [prevStart, prevEnd] = lastRangeRef.current;
      if (newStart !== prevStart || newEnd !== prevEnd) {
        lastRangeRef.current = [newStart, newEnd];
        setVisibleRange([newStart, newEnd]);
      }
      setCurrentPage(firstVisible);
      setActiveOutlineTitle(null);
    });
  }, [numPages, scale]);

  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.01;
      setScale((s) => Math.min(Math.max(s + delta, 0.4), 3));
    };

    let gestureStartScale = 1;
    let pendingScale = 1;
    let docEl: HTMLElement | null = null;

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStartScale = scaleRef.current;
      pendingScale = gestureStartScale;
      docEl = container.querySelector('.pdf-doc') as HTMLElement | null;
      if (docEl) {
        const ox = container.scrollLeft + container.clientWidth / 2;
        const oy = container.scrollTop + container.clientHeight / 2;
        docEl.style.transformOrigin = `${ox}px ${oy}px`;
        docEl.style.willChange = 'transform';
      }
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      pendingScale = Math.min(Math.max(gestureStartScale * (e as any).scale, 0.4), 3);
      if (docEl) {
        docEl.style.transform = `scale(${pendingScale / gestureStartScale})`;
      }
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      if (docEl) {
        gestureCleanupRef.current = docEl;
        docEl = null;
      }
      setScale(pendingScale);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('gesturestart', onGestureStart, { passive: false });
    container.addEventListener('gesturechange', onGestureChange, { passive: false });
    container.addEventListener('gestureend', onGestureEnd, { passive: false });

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('gesturestart', onGestureStart);
      container.removeEventListener('gesturechange', onGestureChange);
      container.removeEventListener('gestureend', onGestureEnd);
    };
  }, [numPages]);

  const scrollToPage = useCallback((page: number) => {
    if (!containerRef.current) return;
    const top = (page - 1) * (pageDims.current.h * scale + GAP);
    const newRange: [number, number] = [
      Math.max(1, page - OVERSCAN),
      Math.min(numPages, page + OVERSCAN + 3),
    ];
    lastRangeRef.current = newRange;
    setVisibleRange(newRange);
    setCurrentPage(page);
    containerRef.current.scrollTo({ top, behavior: 'instant' });
  }, [numPages, scale]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || numPages === 0) return;

    const onClick = async (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return;
      e.preventDefault();
      e.stopPropagation();

      const dest = decodeURIComponent(href.slice(1));
      const pdf = pdfDocRef.current as any;
      if (!pdf) return;

      try {
        const resolved = await pdf.getDestination(dest);
        if (!resolved) return;
        const pageIndex = await pdf.getPageIndex(resolved[0]);
        scrollToPage(pageIndex + 1);
      } catch {
        const pageNum = parseInt(dest, 10);
        if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= numPages) {
          scrollToPage(pageNum);
        }
      }
    };

    container.addEventListener('click', onClick, true);
    return () => container.removeEventListener('click', onClick, true);
  }, [numPages, scrollToPage]);

  const handleOutlineNavigate = useCallback((page: number, title: string) => {
    setActiveOutlineTitle(title);
    scrollToPage(page);
  }, [scrollToPage]);

  const zoomIn = () => setScale((s) => Math.min(s + 0.2, 3));
  const zoomOut = () => setScale((s) => Math.max(s - 0.2, 0.4));
  const fitWidth = () => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth - 16;
    setScale(containerWidth / pageDims.current.w);
  };

  const pages = useMemo(() => {
    if (numPages === 0) return null;
    const { w, h } = pageDims.current;
    return Array.from({ length: numPages }, (_, i) => {
      const pageNum = i + 1;
      const isVisible = pageNum >= visibleRange[0] && pageNum <= visibleRange[1];
      return (
        <div
          key={pageNum}
          className="pdf-page-wrap"
          style={{ height: `${h * scale}px`, width: `${w * scale}px` }}
        >
          {isVisible && <Page pageNumber={pageNum} scale={scale} renderTextLayer renderAnnotationLayer />}
        </div>
      );
    });
  }, [numPages, visibleRange, scale]);

  if (!src) return null;

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <div className="pdf-tb-group">
          <button className="pdf-tb-btn" onClick={zoomOut} title="缩小">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="3" y1="8" x2="13" y2="8" /></svg>
          </button>
          <span className="pdf-tb-scale">{Math.round(scale * 100)}%</span>
          <button className="pdf-tb-btn" onClick={zoomIn} title="放大">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></svg>
          </button>
          <button className="pdf-tb-btn" onClick={fitWidth} title="适应宽度">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4v-2h12v2M2 12v2h12v-2" /><line x1="8" y1="3" x2="8" y2="13" /></svg>
          </button>
        </div>
        <div className="pdf-tb-group">
          <button className="pdf-tb-btn" onClick={() => scrollToPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 3l-5 5 5 5" /></svg>
          </button>
          <span className="pdf-tb-page">{currentPage} / {numPages}</span>
          <button className="pdf-tb-btn" onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))} disabled={currentPage >= numPages}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l5 5-5 5" /></svg>
          </button>
        </div>
        <div className="pdf-tb-group">
          {outline.length > 0 && (
            <button
              className={`pdf-tb-btn ${outlineVisible ? 'pdf-tb-btn-active' : ''}`}
              onClick={() => setOutlineVisible((v) => !v)}
              title="目录"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <line x1="2" y1="3.5" x2="14" y2="3.5" />
                <line x1="4" y1="6.5" x2="14" y2="6.5" />
                <line x1="4" y1="9.5" x2="14" y2="9.5" />
                <line x1="2" y1="12.5" x2="14" y2="12.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="pdf-body">
        {outlineVisible && outline.length > 0 && (
          <div className="pdf-outline">
            <div className="pdf-outline-header">目录</div>
            <div className="pdf-outline-body">
              <OutlineTree items={outline} onNavigate={handleOutlineNavigate} activeTitle={activeOutlineTitle} />
            </div>
          </div>
        )}
        <div className="pdf-pages" ref={containerRef} onScroll={updateVisibleRange}>
          <Document file={src} className="pdf-doc" onLoadSuccess={onDocumentLoadSuccess} loading={<div className="pdf-loading"><div className="ft-spinner" /> Loading...</div>}>
            {pages}
          </Document>
        </div>
      </div>
    </div>
  );
}

function OutlineTree({ items, onNavigate, activeTitle, depth = 0 }: {
  items: OutlineItem[];
  onNavigate: (page: number, title: string) => void;
  activeTitle: string | null;
  depth?: number;
}) {
  return (
    <>
      {items.map((item, idx) => (
        <div key={idx}>
          <button
            className={`pdf-outline-item ${item.title === activeTitle ? 'active' : ''}`}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            onClick={() => item.pageNumber && onNavigate(item.pageNumber, item.title)}
            title={`${item.title} (p.${item.pageNumber ?? '?'})`}
          >
            <span className="pdf-outline-title">{item.title}</span>
            {item.pageNumber && <span className="pdf-outline-page">{item.pageNumber}</span>}
          </button>
          {item.items && item.items.length > 0 && (
            <OutlineTree items={item.items} onNavigate={onNavigate} activeTitle={activeTitle} depth={depth + 1} />
          )}
        </div>
      ))}
    </>
  );
}
