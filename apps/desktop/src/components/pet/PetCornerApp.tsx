// Pet corner toast stack window (PRD: pet-popover-corner).
//
// A transparent NSPanel window (`pet-corner`) that stacks passive
// notification toasts at one of the four screen corners on
// `pet://corner-show`. Up to 3 toasts visible; overflow hides the oldest;
// newest on top. Each toast renders title + text + ≤2 action buttons + ✕.
// Clicking the card (anywhere outside ✕ and the action buttons) emits
// `pet://bubble-action { type: 'navigate', target, source }` — the main
// window's existing jump router handles the jump unchanged. Action buttons
// emit `pet://bubble-action { type: 'action' | 'launch', ... }` with the
// matching action id. ✕ is local-dismiss (no emit).
//
// TTL: each toast has its own timer read from `petStore.cornerTtlMs` at the
// time the toast arrives (`number` = ms; `'never'` = sticky until the user
// closes). Overflow hides the oldest toast immediately (no fade queue) —
// PRD Decision D5.
//
// Window mutation (show/hide/position/size) goes through custom
// `pet_corner_*` invoke commands (bypass the ACL); the corner window's
// capability file grants only `core:event` (listen + emit). The whole
// stack's bounding rect receives pointer events (no click-through toggling
// — the visible stack fills the window).
//
// Authorize flow stays bubble-only (PRD Decision D6). If a `pet://corner-show`
// payload somehow carries an authorize request, the corner ignores it
// (the dispatcher never routes authorize to corner — only the bubble
// listens on `pet://bubble-authorize-request`).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTauri } from '@/utils/platform';
import { currentWindowScaleFactor } from '@/utils/windowScale';
import {
  computeCornerToastPosition,
  PET_CORNER_CARD_WIDTH,
  PET_CORNER_MAX_VISIBLE,
} from './petPosition';
import { usePetStore, type CornerPlacement } from '@/store/petStore';
import { hydrateAllStores } from '@/store/settingsPersistence';
import type {
  PetBubblePayload,
  PetBubbleActionEvent,
} from './PetBubbleApp';

/** Work-area invoke result (physical px → logical for the math). */
interface PetWorkAreaResult {
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor?: number;
}

/** A single toast in the stack. `id` is the local monotonic counter used to
 *  look up the toast's TTL timer + identify it on dismiss. `payload` is the
 *  original `pet://corner-show` payload. */
interface CornerToast {
  id: number;
  payload: PetBubblePayload;
}

/** Module-local monotonic id. Shared across the window's lifetime so retries
 *  / re-mounts don't collide. */
let nextToastId = 1;

/** Recompute size + position of the corner window for the current stack,
 *  then show or hide. `stackHeight` is the MEASURED rendered height of the
 *  stack (logical points, already including per-card heights + inter-card
 *  gaps — the caller observes the root via ResizeObserver and passes the
 *  sum). When `stackHeight <= 0`, hides the window. */
async function syncCornerWindow(
  stackHeight: number,
  corner: CornerPlacement,
): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    if (stackHeight <= 0) {
      await invoke('pet_corner_hide');
      return;
    }
    const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
    // The CORNER window's own scale for the frame conversions — see
    // currentWindowScaleFactor (first show after the pet moves to a
    // different-DPI screen must not convert with the target screen's scale).
    const winSf = await currentWindowScaleFactor(workArea.scale_factor || 1);
    const posLogical = computeCornerToastPosition(corner, workArea, stackHeight);
    await invoke('pet_corner_set_size', {
      width: Math.round(PET_CORNER_CARD_WIDTH * winSf),
      height: Math.round(stackHeight * winSf),
    });
    await invoke('pet_corner_set_position', {
      x: Math.round(posLogical.x * winSf),
      y: Math.round(posLogical.y * winSf),
    });
    await invoke('pet_corner_show');
  } catch {
    // Non-fatal — the corner window may not exist (e.g. pet mode off).
  }
}

/** Hide the corner window. Swallows errors so the TTL/click close paths
 *  never throw into React state. */
async function hideCorner(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pet_corner_hide');
  } catch {
    // Non-fatal.
  }
}

/** The corner toast stack root. Mounts only in the `pet-corner` Tauri window
 *  (see main.tsx `#/pet-corner` route). Stays hidden until a
 *  `pet://corner-show` event arrives; renders the stack, runs a per-toast
 *  TTL, and emits `pet://bubble-action` on card / action button click.
 *
 *  Corner + TTL are read from `petStore` (`.getState()` inside the listener
 *  so the closure always sees the latest without re-subscribing the effect
 *  — mirrors the bubble pattern).
 */
export function PetCornerApp(): JSX.Element {
  const [toasts, setToasts] = useState<CornerToast[]>([]);
  // Per-toast TTL timers. Ref so the listener (which is set up once) can add
  // / clear timers without re-subscribing.
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Measured rendered height of the stack (logical px). Drives the window
  // size so the card can be content-driven (`height: auto`) — root is
  // observed by a ResizeObserver below, and the value reflows the window
  // via the `[stackHeight, corner]` effect.
  const [stackHeight, setStackHeight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const corner = usePetStore((s) => s.cornerPlacement);

  /** Remove a toast by id + clean up its TTL timer. Returns the new stack so
   *  callers can chain. */
  const dismissToast = (id: number): void => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
    // Window sync is driven by the `[stackHeight, corner]` effect after the
    // ResizeObserver fires with the new measured height — no explicit call
    // here.
  };

  /** Fire a jump: emit `pet://bubble-action` to the main window, then dismiss
   *  the clicked toast (corner toasts are one-shot per click — the user has
   *  signaled they want to act on it, so keeping it around would be noise). */
  const fireAction = async (toastId: number, event: PetBubbleActionEvent): Promise<void> => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://bubble-action', event);
    } catch {
      // Non-fatal — still dismiss so the toast doesn't stick.
    }
    dismissToast(toastId);
  };

  // Listener setup — runs once. Reads `.getState()` for corner / TTL so the
  // closure always sees the latest without re-subscribing.
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenShow: (() => void) | null = null;
    let unlistenSettings: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      // Assert the NSPanel topmost level on mount (mirrors PetBubbleApp).
      try {
        await invoke('pet_set_topmost_level', { label: 'pet-corner' });
      } catch {
        // Non-fatal (non-macOS / window not ready).
      }
      unlistenShow = await listen<PetBubblePayload>('pet://corner-show', (event) => {
        const payload = event.payload;
        if (!payload?.text) return;
        const store = usePetStore.getState();
        const ttl = store.cornerTtlMs;
        const id = nextToastId++;
        const toast: CornerToast = { id, payload };
        setToasts((prev) => {
          // newest on top; drop oldest beyond MAX_VISIBLE.
          const next = [toast, ...prev];
          const trimmed = next.slice(0, PET_CORNER_MAX_VISIBLE);
          // For each dropped (overflow-hidden) toast, clear its TTL timer
          // so it doesn't fire later and try to remove a non-existent id.
          if (next.length > trimmed.length) {
            for (const dropped of next.slice(PET_CORNER_MAX_VISIBLE)) {
              const t = timersRef.current.get(dropped.id);
              if (t) {
                clearTimeout(t);
                timersRef.current.delete(dropped.id);
              }
            }
          }
          return trimmed;
        });
        // Window sync fires from the `[stackHeight, corner]` effect after the
        // ResizeObserver measures the new rendered height — no explicit call.
        if (ttl !== 'never') {
          const timer = setTimeout(() => dismissToast(id), ttl);
          timersRef.current.set(id, timer);
        }
      });
      // Cross-window settings sync: the main window's per-slice `persist()`
      // emits `pet://settings-updated` with the fresh blob as payload
      // after every debounced write. This window holds its own `petStore`
      // instance (separate JS context) so in-memory `set()` calls in the
      // main window never reach here — hydrate from the event payload
      // directly (the pet-corner ACL doesn't grant fs perms, so re-reading
      // storage.json via `loadSettings` would be silently rejected).
      // After hydrate, the existing `[toasts, corner]` effect re-fires
      // with the new `corner` and repositions the visible stack.
      unlistenSettings = await listen<Record<string, unknown>>(
        'pet://settings-updated',
        (event) => {
          if (event.payload) hydrateAllStores(event.payload);
        },
      );
      if (cancelled) {
        unlistenShow();
        unlistenSettings?.();
      }
    })();

    return () => {
      cancelled = true;
      // Clear all in-flight TTL timers so they don't fire after unmount.
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
      unlistenShow?.();
      unlistenSettings?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measure the rendered stack height whenever the toast list changes.
  // The card is `height: auto` (content-driven) so the only way to know
  // the real footprint is to read it from the DOM. `useLayoutEffect`
  // runs before paint so the window is sized correctly for the first
  // frame; `ResizeObserver` catches late reflows (font load, CSS
  // variable resolution) without a re-render.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      setStackHeight(0);
      return;
    }
    const measure = (): void => {
      // Offset height = border-box; root has no border/padding, so ==
      // scrollHeight of the flex column = stack height.
      const h = Math.ceil(root.getBoundingClientRect().height);
      setStackHeight((prev) => (prev === h ? prev : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [toasts]);

  // Drive the window size + position from the MEASURED stack height +
  // corner. When the stack empties (or is empty on mount), hide the
  // window. Otherwise the ResizeObserver will keep the window tracking
  // the content on every reflow.
  useEffect(() => {
    if (stackHeight <= 0) {
      void hideCorner();
    } else {
      void syncCornerWindow(stackHeight, corner);
    }
  }, [stackHeight, corner]);

  if (toasts.length === 0) return <></>;

  return (
    <div className="pet-corner-root" ref={rootRef}>
      {toasts.map((toast) => {
        const kind = toast.payload.kind ?? 'info';
        const kindClass = `pet-corner--${kind}`;
        const title = toast.payload.title;
        const actions = (toast.payload.actions ?? []).slice(0, 2);
        return (
          <div
            key={toast.id}
            className={`pet-corner-card ${kindClass}`}
            data-toast-id={toast.id}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              const actionEl = target.closest('[data-corner-action]') as HTMLElement | null;
              if (actionEl) {
                const actionId = actionEl.dataset.cornerAction;
                if (actionId === 'close') {
                  dismissToast(toast.id);
                  return;
                }
                const action = (toast.payload.actions ?? []).find((a) => a.id === actionId);
                void fireAction(toast.id, {
                  type: action?.launch ? 'launch' : 'action',
                  actionId,
                  target: toast.payload.target,
                  source: toast.payload.source,
                  launch: action?.launch,
                });
                return;
              }
              // No [data-corner-action] hit: card body click → navigate.
              void fireAction(toast.id, {
                type: 'navigate',
                target: toast.payload.target,
                source: toast.payload.source,
              });
            }}
            role="presentation"
          >
            <button
              className="pet-corner-close"
              data-corner-action="close"
              aria-label="关闭"
            >✕</button>
            {title && (
              <div className="pet-corner-title" data-corner-action="navigate">{title}</div>
            )}
            <div className="pet-corner-text" data-corner-action="navigate">{toast.payload.text}</div>
            {actions.length > 0 && (
              <div className="pet-corner-actions">
                {actions.map((a) => (
                  <button
                    key={a.id}
                    className={`pet-corner-btn pet-corner-btn--${a.kind ?? 'ghost'}`}
                    data-corner-action={a.id}
                  >{a.label}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Re-export the shared types so consumers can import them from the corner
// module if they already hold a corner import (canonical site remains
// PetBubbleApp.tsx — these are type-only re-exports, no runtime cost).
export type { PetBubblePayload, PetBubbleActionEvent } from './PetBubbleApp';
