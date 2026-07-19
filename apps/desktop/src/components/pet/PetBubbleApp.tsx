// Pet bubble notification window (PRD: pet-popup-bubble-notification).
//
// A transparent NSPanel window (`pet-bubble`) that pops a speech bubble above
// the pet when a `pet://bubble-show` event fires. The bubble renders a title
// (clickable → jump), body text, a ✕ close button, and up to 2 action buttons.
// Clicking the title or an action button emits `pet://bubble-action` (the MAIN
// window routes the jump) and closes the bubble. The bubble auto-dismisses
// after `BUBBLE_TTL_MS`.
//
// Contract: this module owns the `PetBubblePayload` / `PetBubbleAction` types
// shared with the Rust emit side (lib.rs demo) and the main-window listener
// (App.tsx). The payload shape is the contract — both sides must match.
//
// Window mutation (show/hide/position) goes through custom `pet_bubble_*`
// invoke commands (bypass the ACL); the bubble's capability file grants only
// `core:event` (listen + emit). The whole 320×120 window receives pointer
// events (no `setIgnoreCursorEvents` toggling — the visible card fills the
// window so the only transparent eaten area is the 4 rounded corner slivers
// for the bubble's 6s lifetime; see tauri-window-patterns.md "Click-Through"
// for why we don't toggle ignore-cursor-events on a static window).

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/utils/platform';
import {
  computeBubblePosition,
  PET_SIZE_DEFAULT,
  type PetWorkArea,
} from './petPosition';

/** Bubble kind — drives the accent color of the card. */
export type PetBubbleKind = 'info' | 'reminder' | 'message' | 'event';

/** Jump target carried by the bubble. The main-window listener routes by
 *  `kind`: schedule → schedule workbench, chat → pet-panel + session switch,
 *  task/file → open the file. `id` is the entity id (path / sessionId / etc). */
export interface PetBubbleTarget {
  kind: 'schedule' | 'chat' | 'task' | 'file';
  id: string;
}

/** A single action button rendered in the bubble footer (max 2). `id` is
 *  opaque to the bubble — the main-window listener dispatches on it. */
export interface PetBubbleAction {
  id: string;
  label: string;
  kind?: 'primary' | 'ghost';
}

/** Payload for `pet://bubble-show`. Emitted by trigger sources (currently the
 *  Rust demo menu item; future: schedule reminder, pet-chat new message, task
 *  events, external push). `title` is optional but, when present, is clickable
 *  and jumps to `target`. `actions` are rendered as buttons. */
export interface PetBubblePayload {
  text: string;
  title?: string;
  kind?: PetBubbleKind;
  source?: string;
  target?: PetBubbleTarget;
  actions?: PetBubbleAction[];
}

/** Payload for `pet://bubble-action` — emitted by the bubble on title/action
 *  click, consumed by the main-window listener (App.tsx) which executes the
 *  jump and focuses the target window. `type: 'navigate'` = title click (or
 *  default action), `type: 'action'` = a named action button. */
export interface PetBubbleActionEvent {
  type: 'navigate' | 'action';
  actionId?: string;
  target?: PetBubbleTarget;
  source?: string;
}

/** Auto-dismiss TTL. Slightly longer than the original 5s skeleton because the
 *  bubble now carries interactive actions the user may want to read first. */
export const BUBBLE_TTL_MS = 6000;

/** Physical-position result from `get_pet_position` (physical px). */
interface PetPositionResult {
  x: number;
  y: number;
}

/**
 * Show the bubble: position it above the pet, then reveal. Reads the pet's
 * physical position + the work area, computes a clamped logical position
 * (above the pet, flipped below if no room), converts to physical, and sets
 * it before `pet_bubble_show` so the bubble appears at the right spot in one
 * frame (no flash at the default origin — mirrors the `pet-panel` open path).
 */
async function positionAndShowBubble(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const [petPos, workArea] = await Promise.all([
    invoke<PetPositionResult>('get_pet_position'),
    invoke<PetWorkArea>('pet_get_work_area'),
  ]);
  const sf = workArea.scale_factor || 1;
  // petPos is PHYSICAL px → logical for the math, then × sf back to physical
  // for pet_bubble_set_position. See petPosition.ts unit contract.
  const petPosLogical = { x: petPos.x / sf, y: petPos.y / sf };
  const posLogical = computeBubblePosition(petPosLogical, workArea, PET_SIZE_DEFAULT);
  const posPhysical = {
    x: Math.round(posLogical.x * sf),
    y: Math.round(posLogical.y * sf),
  };
  await invoke('pet_bubble_set_position', posPhysical);
  await invoke('pet_bubble_show');
}

/** Hide the bubble window. Swallows errors (e.g. window already hidden) so the
 *  TTL/click close paths never throw into React state. */
async function hideBubble(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pet_bubble_hide');
  } catch {
    // Non-fatal.
  }
}

/**
 * The bubble window root. Mounts only in the `pet-bubble` Tauri window (see
 * main.tsx `#/pet-bubble` route). Stays hidden until a `pet://bubble-show`
 * event arrives; renders the card, runs the TTL, and emits
 * `pet://bubble-action` on title/action click.
 */
export function PetBubbleApp(): JSX.Element {
  const { t } = useTranslation();
  const [bubble, setBubble] = useState<PetBubblePayload | null>(null);
  const ttlRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the TTL timer (if any) without touching the bubble window.
  const clearTtl = () => {
    if (ttlRef.current) {
      clearTimeout(ttlRef.current);
      ttlRef.current = null;
    }
  };

  // Close: clear TTL, hide the window, drop the payload. Safe to call repeatedly.
  const close = () => {
    clearTtl();
    setBubble(null);
    void hideBubble();
  };

  // Fire a jump: emit `pet://bubble-action` to the main window, then close.
  const fireAction = async (event: PetBubbleActionEvent) => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://bubble-action', event);
    } catch {
      // Non-fatal — still close so the bubble doesn't stick.
    }
    close();
  };

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      // Assert the NSPanel topmost level on mount (mirrors PetPanelApp — the
      // level persists across show/hide for the window's lifetime).
      try {
        await invoke('pet_set_topmost_level', { label: 'pet-bubble' });
      } catch {
        // Non-fatal (non-macOS / window not ready).
      }
      unlisten = await listen<PetBubblePayload>('pet://bubble-show', (event) => {
        const payload = event.payload;
        if (!payload?.text) return;
        // Replace any in-flight bubble: clear the old TTL before showing the new.
        clearTtl();
        setBubble(payload);
        void positionAndShowBubble();
        ttlRef.current = setTimeout(() => close(), BUBBLE_TTL_MS);
      });
      if (cancelled) unlisten();
    })();

    return () => {
      cancelled = true;
      clearTtl();
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hidden state: render nothing (the window itself is hidden via
  // pet_bubble_hide). When a payload arrives, React renders the card before
  // positionAndShowBubble reveals the window — so the first visible frame
  // already has content (no empty flash).
  if (!bubble) return <></>;

  const kindClass = `pet-bubble--${bubble.kind ?? 'info'}`;
  const hasJump = !!bubble.target;
  const actions = (bubble.actions ?? []).slice(0, 2);

  return (
    <div className={`pet-bubble-root ${kindClass}`}>
      <div className="pet-bubble-card">
        <button
          className="pet-bubble-close"
          title={t('pet:bubble.closeAria')}
          onClick={close}
          aria-label={t('pet:bubble.closeAria')}
        >
          ✕
        </button>
        {bubble.title && (
          <div
            className={`pet-bubble-title${hasJump ? ' pet-bubble-title--link' : ''}`}
            onClick={hasJump ? () => fireAction({ type: 'navigate', target: bubble.target, source: bubble.source }) : undefined}
            role={hasJump ? 'button' : undefined}
          >
            {bubble.title}
          </div>
        )}
        <div className="pet-bubble-text">{bubble.text}</div>
        {actions.length > 0 && (
          <div className="pet-bubble-actions">
            {actions.map((a) => (
              <button
                key={a.id}
                className={`pet-bubble-btn pet-bubble-btn--${a.kind ?? 'ghost'}`}
                onClick={() => fireAction({ type: 'action', actionId: a.id, target: bubble.target, source: bubble.source })}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
