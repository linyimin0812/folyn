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

/**
 * Anchor-compensated scroll so the content point under `anchor` (viewport
 * coords inside the scroll container) stays put when zoom scales by `ratio`.
 * Content px = scroll + anchor; keep fixed → scroll' = (scroll + anchor)·ratio − anchor.
 */
export function compensateScroll(scroll: number, anchor: number, ratio: number): number {
  return (scroll + anchor) * ratio - anchor;
}

/** Cap a per-event zoom factor to ±WHEEL_EVENT_MAX_RATIO so detents don't lurch. */
export function capWheelFactor(factor: number): number {
  return Math.min(WHEEL_EVENT_MAX_RATIO, Math.max(1 / WHEEL_EVENT_MAX_RATIO, factor));
}

/**
 * Pinch/ctrl+wheel + Cmd±/0 zoom for the markdown preview, preview-only mode.
 * `scrollRef` must point at the `.prev-body` scroll container; the zoom
 * itself applies to `.md-preview` via the `--md-zoom` CSS var (see index.css)
 * — NO extra wrapper div: cursor-sync/gap-compensation walk
 * `.md-preview`.parentElement for the scroll container.
 *
 * Smoothness: wheel/key events only move a TARGET zoom; a rAF loop eases the
 * applied zoom toward it (exponential ease-out, per-frame scroll
 * compensation at the gesture anchor). Wheel events are capped per-event so
 * a mouse detent glides instead of lurching. Store commit is debounced so
 * Tauri persistence isn't hammered mid-gesture.
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
    let anchorX = 0;
    let anchorY = 0;

    const scheduleCommit = () => {
      window.clearTimeout(commitTimer);
      commitTimer = window.setTimeout(
        () => useAppearanceStore.getState().setMdPreviewZoom(clampMdPreviewZoom(target)),
        COMMIT_DELAY_MS,
      );
    };

    const frame = () => {
      raf = 0;
      if (target === cur) return;
      const next = Math.abs(target - cur) < SETTLE_EPS ? target : cur + (target - cur) * SMOOTHING;
      const rect = el.getBoundingClientRect();
      const ratio = next / cur;
      el.style.setProperty('--md-zoom', String(next));
      el.scrollTop = compensateScroll(el.scrollTop, anchorY - rect.top, ratio);
      el.scrollLeft = compensateScroll(el.scrollLeft, anchorX - rect.left, ratio);
      cur = next;
      if (target !== cur) raf = requestAnimationFrame(frame);
    };

    const startZoom = (nextTarget: number, clientX: number, clientY: number) => {
      const next = clampMdPreviewZoom(nextTarget);
      if (next === target && raf === 0) return;
      target = next;
      anchorX = clientX;
      anchorY = clientY;
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
