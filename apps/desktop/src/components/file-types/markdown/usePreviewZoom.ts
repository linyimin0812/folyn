import { useEffect, useRef } from 'react';
import { useAppearanceStore, clampMdPreviewZoom } from '@/store/appearanceStore';
import { usePrefsStore, type ShortcutItem } from '@/store/prefsStore';
import { eventMatchesShortcut } from '@/utils/shortcutAccelerator';

// ponytail: CSS `zoom` (WebKit-native) instead of transform:scale — the
// browser recomputes scrollHeight/Width for us, so no wrapper-size math.
// Upgrade to transform only if a browser quirk appears.

const WHEEL_SENSITIVITY = 0.01;
const KEY_STEP = 1.2;
const COMMIT_DELAY_MS = 200;

/**
 * Anchor-compensated scroll so the content point under `anchor` (viewport
 * coords inside the scroll container) stays put when zoom scales by `ratio`.
 * Content px = scroll + anchor; keep fixed → scroll' = (scroll + anchor)·ratio − anchor.
 */
export function compensateScroll(scroll: number, anchor: number, ratio: number): number {
  return (scroll + anchor) * ratio - anchor;
}

/**
 * Pinch/ctrl+wheel + Cmd±/0 zoom for the markdown preview, preview-only mode.
 * `scrollRef` must point at the `.prev-body` scroll container; the zoom
 * itself applies to `.md-preview` via the `--md-zoom` CSS var (see index.css)
 * — NO extra wrapper div: cursor-sync/gap-compensation walk
 * `.md-preview`.parentElement for the scroll container. Gestures write the
 * var synchronously (smooth pinch) and commit to the store (debounced) so
 * Tauri persistence isn't hammered mid-gesture.
 */
export function usePreviewZoom(enabled: boolean, scrollRef: React.RefObject<HTMLDivElement | null>) {
  const zoom = useAppearanceStore((s) => s.mdPreviewZoom);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    let commitTimer: number | undefined;

    const apply = (nextRaw: number, clientX: number, clientY: number, commit: boolean) => {
      const cur = zoomRef.current;
      const next = clampMdPreviewZoom(nextRaw);
      if (next === cur) return;
      el.style.setProperty('--md-zoom', String(next));
      const rect = el.getBoundingClientRect();
      const ratio = next / cur;
      el.scrollTop = compensateScroll(el.scrollTop, clientY - rect.top, ratio);
      el.scrollLeft = compensateScroll(el.scrollLeft, clientX - rect.left, ratio);
      zoomRef.current = next;
      if (commit) {
        window.clearTimeout(commitTimer);
        useAppearanceStore.getState().setMdPreviewZoom(next);
        return;
      }
      window.clearTimeout(commitTimer);
      commitTimer = window.setTimeout(() => useAppearanceStore.getState().setMdPreviewZoom(next), COMMIT_DELAY_MS);
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      apply(zoomRef.current * Math.exp(-e.deltaY * WHEEL_SENSITIVITY), e.clientX, e.clientY, false);
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    const onKey = (e: KeyboardEvent) => {
      // Rebindable via Settings → Shortcuts (prefsStore previewZoomIn/Out/
      // Reset); read at match time so re-recording takes effect immediately.
      const find = (id: string): ShortcutItem | undefined =>
        usePrefsStore.getState().shortcuts.find((s) => s.id === id);
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const zoomIn = find('previewZoomIn');
      const zoomOut = find('previewZoomOut');
      const zoomReset = find('previewZoomReset');
      if (zoomIn && eventMatchesShortcut(e, zoomIn.keys)) {
        e.preventDefault();
        apply(zoomRef.current * KEY_STEP, cx, cy, true);
      } else if (zoomOut && eventMatchesShortcut(e, zoomOut.keys)) {
        e.preventDefault();
        apply(zoomRef.current / KEY_STEP, cx, cy, true);
      } else if (zoomReset && eventMatchesShortcut(e, zoomReset.keys)) {
        e.preventDefault();
        apply(1, cx, cy, true);
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.clearTimeout(commitTimer);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled, scrollRef]);

  return zoom;
}
