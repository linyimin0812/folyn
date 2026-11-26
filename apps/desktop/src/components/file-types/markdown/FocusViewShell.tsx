import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { usePreviewActive } from './PreviewActiveContext';

export interface FocusViewShellProps {
  /** Head-left: object name + source (e.g. "mermaid · 第 12 行"). */
  title: ReactNode;
  /** Head-right extra controls (zoom buttons, copy, …) before the close button. */
  actions?: ReactNode;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  /** Extra classes on the .md-code-focus-body scroll container. */
  bodyClassName?: string;
  /** Extra props on the body div (data-wrap …). */
  bodyProps?: Record<string, string | undefined>;
}

/**
 * Shared shell for 专注查看 (focus view) overlays: code blocks, tables,
 * rendered diagrams. One card language (md-code-focus-* CSS), one Esc path,
 * one focus-restore path — per-type content is just children + actions.
 *
 * - Portal to body; hidden panes gate via PreviewActiveContext (portals
 *   don't hide with the pane, so the context is the only correct signal).
 * - Esc closes with capture + stopImmediatePropagation: wins over sibling
 *   window-level Esc handlers (PresentationOverlay skips on its own guard).
 * - Backdrop click closes; clicks inside the card don't.
 * - Native non-passive wheel guard: the wheel only ever scrolls the focus
 *   body (or zooms a surface inside it) — never the page behind the overlay.
 * - Keyboard focus returns to the pre-overlay element on close.
 */
export function FocusViewShell({
  title, actions, onClose, ariaLabel, children, bodyClassName, bodyProps,
}: FocusViewShellProps) {
  const active = usePreviewActive();
  const overlayRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Restore keyboard focus to the pre-overlay element on unmount.
  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { restoreRef.current?.focus?.(); };
  }, []);

  // Esc closes — capture + stopImmediatePropagation so window-level Esc
  // handlers registered earlier (presentation exit etc.) don't also fire.
  // PresentationOverlay additionally skips while `.md-code-focus-overlay`
  // is in the DOM, so both orderings resolve the same way.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Wheel outside the scrollable body must not scroll the page behind the
  // overlay; .md-code-focus-body carries overscroll-behavior: contain for its
  // own edges. Native listener (passive:false) — React attaches wheel at the
  // root as passive, where preventDefault is a no-op.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.md-code-focus-body')) return;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Hidden pane → no portal. The owner component (and its focus state) stays
  // mounted in the parked pane; returning to the tab re-renders the overlay.
  if (!active) return null;

  return createPortal(
    <div
      className="md-code-focus-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      ref={overlayRef}
      onClick={onClose}
    >
      <div className="md-code-focus" onClick={(e) => e.stopPropagation()}>
        <div className="md-code-focus-head">
          <span className="code-block-lang">{title}</span>
          <div className="code-block-actions">
            {actions}
            <button
              className="code-act-btn"
              type="button"
              title="关闭 (Esc)"
              aria-label="close focus view"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <div className={`md-code-focus-body${bodyClassName ? ` ${bodyClassName}` : ''}`} {...bodyProps}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
