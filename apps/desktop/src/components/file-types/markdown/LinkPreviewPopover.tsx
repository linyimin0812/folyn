/**
 * The hover-preview popover for internal document links (spec 5.2 —
 * 内部链接快速预览). One instance is mounted inside MarkdownPreview
 * (gated by PreviewActiveContext so a parked pane never floats it) and
 * portals to <body> — .prev-body clips children at its scroll edge, so
 * the popover must live outside it (fixed positioning from the link's
 * viewport rect, clamped so it never covers the link itself).
 *
 * Content: reads the target through readFileByRoute (route-aware: vault
 * or external), builds the model via buildLinkPreview (name / path /
 * section / bounded excerpt), and renders the excerpt through the SAME
 * unified pipeline as the reader — restricted component map: links are
 * dead text (a preview must not navigate, spec: 预览不增加导航历史),
 * images are dropped (no asset base in a portal), code keeps its syntax
 * highlight. No nesting: popover content has no hover-preview anchors.
 *
 * Closes on: pointer leaving the link chain, Esc (capture, wins over
 * global Esc), wheel outside the popover, click anywhere, pane going
 * inactive, or the target file failing to read.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLinkPreviewStore } from './linkPreviewStore';
import { buildLinkPreview, type LinkPreviewModel } from './linkPreviewModel';
import { renderMarkdownBody } from './markdownPipeline';
import { usePreviewActive } from './PreviewActiveContext';

/** Session content cache — local reads, small files; 24 entries LRU-ish. */
const contentCache = new Map<string, string>();
const CACHE_CAP = 24;
function cachedRead(path: string): Promise<string> {
  const hit = contentCache.get(path);
  if (hit !== undefined) return Promise.resolve(hit);
  return import('@/services/editorIoService').then(({ readFileByRoute }) =>
    readFileByRoute(path),
  ).then((content) => {
    if (contentCache.size >= CACHE_CAP) {
      // Map preserves insertion order: evict the oldest entry.
      contentCache.delete(contentCache.keys().next().value as string);
    }
    contentCache.set(path, content);
    return content;
  });
}

/** Test seam: drop the session cache. */
export function __clearLinkPreviewCache(): void {
  contentCache.clear();
}

const GAP = 8;
const POP_W = 440;
const POP_MAX_H = 320;

export function LinkPreviewPopover() {
  const active = usePreviewActive();
  const { open, target, anchorRect } = useLinkPreviewStore();
  const [model, setModel] = useState<LinkPreviewModel | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const popRef = useRef<HTMLDivElement>(null);
  const { holdPopover, releasePopover, close } = useLinkPreviewStore.getState();

  // Load the target's content → model. The store's token guards races
  // (a newer hover replacing this one mid-read).
  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    const { token } = useLinkPreviewStore.getState();
    setStatus('loading');
    setModel(null);
    cachedRead(target.path)
      .then((content) => {
        if (cancelled || useLinkPreviewStore.getState().token !== token) return;
        setModel(buildLinkPreview(target.path, target.fragment, content));
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled || useLinkPreviewStore.getState().token !== token) return;
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [open, target]);

  // Esc / outside-wheel / click-while-open → close. Wheel INSIDE the
  // popover (scrolling the excerpt) must not close it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      close();
    };
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('.md-link-pop')) return;
      close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('.md-link-pop')) return;
      close();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  // Excerpt render — restricted map (dead links, no images, plain code).
  const excerptEl = useMemo(() => {
    if (!model?.excerpt) return null;
    return renderMarkdownBody(model.excerpt, {
      componentMap: {
        a: (props: any) => {
          const { href, node, children, ...rest } = props;
          return <span className="md-pop-dead-link" {...rest}>{children}</span>;
        },
        img: () => null,
        // Directive wrappers render as plain divs — no interactive
        // components, no nested previews.
      },
      sourceLineOffset: 0,
    });
  }, [model]);

  if (!open || !target || !anchorRect || !active) return null;

  // Position: prefer below the link, left-aligned with it; clamp into the
  // viewport; if below doesn't fit, flip above. Never cover the anchor.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchorRect.left;
  if (left + POP_W > vw - GAP) left = Math.max(GAP, vw - GAP - POP_W);
  let top = anchorRect.bottom + GAP;
  if (top + POP_MAX_H > vh - GAP) {
    const above = anchorRect.top - GAP - Math.min(POP_MAX_H, 240);
    if (above > GAP) top = above;
  }

  return createPortal(
    <div
      ref={popRef}
      className="md-link-pop"
      style={{ left, top, maxWidth: POP_W }}
      role="tooltip"
      onMouseEnter={holdPopover}
      onMouseLeave={releasePopover}
    >
      <div className="md-link-pop-head">
        {status === 'error' ? (
          <div className="md-link-pop-title md-link-pop-error">无法读取目标文件</div>
        ) : (
          <>
            <div className="md-link-pop-title">{target.path.substring(target.path.lastIndexOf('/') + 1)}</div>
            {model?.section && (
              <div className="md-link-pop-section">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M 6 13 L 2.5 8 L 6 3" />
                  <path d="M 11 13 L 7.5 8 L 11 3" />
                </svg>
                {model.section}
                {model.sectionLine != null && <span className="md-link-pop-lineno">第 {model.sectionLine} 行</span>}
              </div>
            )}
            {model && <div className="md-link-pop-path">{model.displayPath}</div>}
          </>
        )}
      </div>
      <div className="md-link-pop-body">
        {status === 'loading' && <div className="md-link-pop-loading">读取中…</div>}
        {status === 'ready' && excerptEl}
        {status === 'ready' && !excerptEl && <div className="md-link-pop-empty">空文档</div>}
      </div>
    </div>,
    document.body,
  );
}
