/**
 * State machine for the internal-link hover preview (spec 5.2).
 *
 * Hover intent: the pointer must REST on a link for HOVER_INTENT_MS before
 * the popover opens — passing over links mid-reading must never flash
 * popovers. Once open, the anchor and the popover form one hover chain:
 * leaving the link starts a short grace timer (moving onto the popover
 * cancels it), leaving the popover closes immediately.
 *
 * A zustand module store (docLinkHistory pattern): the many link anchors in
 * previewComponentMap and the single popover mounted in MarkdownPreview
 * communicate through it without prop plumbing.
 *
 * The store NEVER navigates — no openFile, no docLinkHistory writes. A
 * preview is a read-only glimpse by construction (spec: 预览不增加导航历史).
 */

import { create } from 'zustand';

/** Rest time before a hover counts as intentional. */
export const HOVER_INTENT_MS = 500;
/** Grace after leaving the link — time to move onto the popover. */
export const LINK_LEAVE_GRACE_MS = 200;

export interface LinkPreviewTarget {
  path: string;
  fragment?: string;
}

export interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface LinkPreviewState {
  open: boolean;
  target: LinkPreviewTarget | null;
  /** Link's bounding rect at intent time (viewport coords). */
  anchorRect: AnchorRect | null;
  /** Monotonic intent id — stale timers are discarded by token check. */
  token: number;
  beginHover: (target: LinkPreviewTarget, rect: AnchorRect) => void;
  /** Pointer left the link. Cancels a pending intent; schedules a close. */
  endHover: () => void;
  /** Pointer entered the popover — hold it open. */
  holdPopover: () => void;
  /** Pointer left the popover. */
  releasePopover: () => void;
  /** Immediate close (Esc / outside click / scroll-away). */
  close: () => void;
}

let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function clearHoverTimer() {
  if (hoverTimer !== undefined) clearTimeout(hoverTimer);
  hoverTimer = undefined;
}
function clearCloseTimer() {
  if (closeTimer !== undefined) clearTimeout(closeTimer);
  closeTimer = undefined;
}

export const useLinkPreviewStore = create<LinkPreviewState>((set, get) => ({
  open: false,
  target: null,
  anchorRect: null,
  token: 0,

  beginHover: (target, rect) => {
    clearCloseTimer();
    const token = get().token + 1;
    // Hovering the SAME link the popover already shows (pointer wobbled out
    // and back within the grace window): just keep it open, no re-open flash.
    if (get().open && get().target?.path === target.path && get().target?.fragment === target.fragment) {
      set({ token });
      return;
    }
    set({ token, target, anchorRect: rect });
    clearHoverTimer();
    hoverTimer = setTimeout(() => {
      hoverTimer = undefined;
      // Stale intent (a newer hover or a close superseded it)?
      if (get().token !== token) return;
      set({ open: true });
    }, HOVER_INTENT_MS);
  },

  endHover: () => {
    clearHoverTimer();
    if (!get().open) return;
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      set({ open: false });
    }, LINK_LEAVE_GRACE_MS);
  },

  holdPopover: () => clearCloseTimer(),

  releasePopover: () => {
    clearCloseTimer();
    if (!get().open) return;
    set({ open: false });
  },

  close: () => {
    clearHoverTimer();
    clearCloseTimer();
    set({ open: false, target: null, anchorRect: null });
  },
}));

/** Test seam: cancel every pending timer without firing them. */
export function __resetLinkPreviewTimers(): void {
  clearHoverTimer();
  clearCloseTimer();
}
