import { useEffect } from 'react';
import { useAppearanceStore, clampMdPreviewZoom } from '@/store/appearanceStore';
import { usePrefsStore, type ShortcutItem } from '@/store/prefsStore';
import { eventMatchesShortcut } from '@/utils/shortcutAccelerator';

// ponytail: CSS `zoom` (WebKit-native) instead of transform:scale — the
// browser recomputes scrollHeight/Width for us, so no wrapper-size math.
// Upgrade to transform only if a browser quirk appears.

const WHEEL_SENSITIVITY = 0.01;
/** Max zoom change from a single wheel event — a mouse-wheel detent (deltaY
 * ±100+) would otherwise jump 3x+ in one go; trackpad pinch events are far
 * smaller and never hit this cap. */
const WHEEL_EVENT_MAX_RATIO = 1.15;
const KEY_STEP = 1.2;
const COMMIT_DELAY_MS = 200;
/** Per-frame ease-out fraction toward the target zoom (rAF loop). ~10 frames
 * to settle ≈ 160ms — glide-y without feeling laggy. */
const SMOOTHING = 0.28;
const SETTLE_EPS = 0.0015;

/** Cap a per-event zoom factor to ±WHEEL_EVENT_MAX_RATIO so detents don't lurch. */
export function capWheelFactor(factor: number): number {
  return Math.min(WHEEL_EVENT_MAX_RATIO, Math.max(1 / WHEEL_EVENT_MAX_RATIO, factor));
}

/**
 * Deepest descendant of `root` whose (post-zoom) rect contains the point —
 * the zoom anchor. Walking rects instead of elementFromPoint because WebKit
 * returns ancestor containers for points inside zoomed subtrees.
 */
function findAnchorEl(root: Element, x: number, y: number): Element | null {
  let best: Element | null = null;
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const r = child.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        best = child;
        walk(child);
      }
    }
  };
  walk(root);
  return best;
}

/**
 * Pinch/ctrl+wheel + Cmd±/0 zoom for the markdown preview, preview-only mode.
 * `scrollRef` must point at the `.prev-body` scroll container; the zoom
 * itself applies to `.md-preview` via the `--md-zoom` CSS var (see index.css)
 * — NO extra wrapper div: cursor-sync/gap-compensation walk
 * `.md-preview`.parentElement for the scroll container.
 *
 * Smoothness + no-jump model (measured, see research/zoom-jump-traces.md):
 * CSS zoom re-wraps text in discrete line steps (zoom divides the available
 * width, so heights move NON-linearly) — a linear `(scrollTop+anchor)·ratio`
 * compensation under-corrects and the content lurches. Instead each frame
 * PINS a measured anchor element: write the new zoom, read the anchor's
 * rect.top, correct scrollTop by the observed delta. Self-correcting (the
 * ≤1px scrollTop rounding is absorbed by the next frame's measurement).
 * Wheel/key events only move a TARGET zoom; the rAF loop eases toward it.
 * Store commit is debounced so Tauri persistence isn't hammered mid-gesture.
 */
export function usePreviewZoom(enabled: boolean, scrollRef: React.RefObject<HTMLDivElement | null>) {
  const zoom = useAppearanceStore((s) => s.mdPreviewZoom);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    // The hook OWNS the --md-zoom property for the session it is enabled:
    // React also rendering it (from the store) would overwrite the var with
    // the committed target mid-animation on every debounced store commit —
    // the visible snap-back flicker. On disable the property is removed so
    // the CSS var fallback (1) restores 1:1 split-mode geometry.
    let cur = clampMdPreviewZoom(useAppearanceStore.getState().mdPreviewZoom);
    let target = cur;
    el.style.setProperty('--md-zoom', String(cur));
    let raf = 0;
    let commitTimer: number | undefined;
    // Gesture anchor: pinned at the FIRST input of a gesture, held until the
    // animation settles. Pinning the element under the initial pointer (not
    // per-event) keeps re-pins from re-basing mid-gesture.
    let anchorEl: Element | null = null;
    let anchorTop = 0;

    const scheduleCommit = () => {
      window.clearTimeout(commitTimer);
      commitTimer = window.setTimeout(
        () => useAppearanceStore.getState().setMdPreviewZoom(clampMdPreviewZoom(target)),
        COMMIT_DELAY_MS,
      );
    };

    const frame = () => {
      raf = 0;
      if (target === cur) { anchorEl = null; return; }
      const next = Math.abs(target - cur) < SETTLE_EPS ? target : cur + (target - cur) * SMOOTHING;
      el.style.setProperty('--md-zoom', String(next));
      // Measured anchor pinning: compensate by what we OBSERVE, not by a
      // ratio (zoom re-wraps text non-linearly). Re-check isConnected — a
      // re-parse could have swapped the node out mid-gesture.
      if (anchorEl && anchorEl.isConnected) {
        const newTop = anchorEl.getBoundingClientRect().top;
        const delta = newTop - anchorTop;
        if (Math.abs(delta) > 0.01) el.scrollTop += delta;
      }
      cur = next;
      if (target !== cur) raf = requestAnimationFrame(frame);
      else anchorEl = null;
    };

    const startZoom = (nextTarget: number, clientX: number, clientY: number) => {
      const next = clampMdPreviewZoom(nextTarget);
      if (next === target && raf === 0) return;
      if (!anchorEl) {
        anchorEl = findAnchorEl(el, clientX, clientY) ?? el.firstElementChild;
        if (anchorEl) anchorTop = anchorEl.getBoundingClientRect().top;
      }
      target = next;
      if (!raf) raf = requestAnimationFrame(frame);
      scheduleCommit();
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      const factor = capWheelFactor(Math.exp(-e.deltaY * WHEEL_SENSITIVITY));
      startZoom(target * factor, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    const onKey = (e: KeyboardEvent) => {
      // Rebindable via Settings → Shortcuts (prefsStore previewZoomIn/Out/
      // Reset); read at match time so re-recording takes effect immediately.
      const find = (id: string): ShortcutItem | undefined =>
        usePrefsStore.getState().shortcuts.find((s) => s.id === id);
      const zoomIn = find('previewZoomIn');
      const zoomOut = find('previewZoomOut');
      const zoomReset = find('previewZoomReset');
      let next: number | undefined;
      if (zoomIn && eventMatchesShortcut(e, zoomIn.keys)) next = target * KEY_STEP;
      else if (zoomOut && eventMatchesShortcut(e, zoomOut.keys)) next = target / KEY_STEP;
      else if (zoomReset && eventMatchesShortcut(e, zoomReset.keys)) next = 1;
      if (next === undefined) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      startZoom(next, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.clearTimeout(commitTimer);
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      el.style.removeProperty('--md-zoom');
    };
  }, [enabled, scrollRef]);

  return zoom;
}
