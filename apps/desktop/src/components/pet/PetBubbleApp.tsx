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
import { isTauri } from '@/utils/platform';
import { currentWindowScaleFactor } from '@/utils/windowScale';
import {
  computeBubblePosition,
  PET_SIZE_DEFAULT,
  type PetSize,
  type PetWorkArea,
  type Placement,
} from './petPosition';
import {
  BUILT_IN_TEMPLATES,
  getTemplateById,
  renderTemplate,
  sanitizeBubbleHtml,
  type BubbleTemplate,
} from './bubbleTemplate';
import { usePetStore } from '@/store/petStore';
import { hydrateAllStores } from '@/store/settingsPersistence';

/** Bubble kind — drives the accent color of the card. */
export type PetBubbleKind = 'info' | 'reminder' | 'message' | 'event';

/** Jump target carried by the bubble. The main-window listener routes by
 *  `kind`: schedule → schedule workbench, chat → pet-panel + session switch,
 *  task/file → open the file. `id` is the entity id (path / sessionId / etc). */
export interface PetBubbleTarget {
  kind: 'schedule' | 'chat' | 'task' | 'file';
  id: string;
}

/** External-launch spec. `type = "url"` opens http(s) in default browser;
 *  `type = "app"` opens a macOS app by name (subject to user whitelist —
 *  the main-window router checks via `open_external` invoke). */
export interface LaunchSpec {
  type: 'url' | 'app';
  value: string;
}

/** A single action button rendered in the bubble footer (max 2). `id` is
 *  opaque to the bubble — the main-window listener dispatches on it. */
export interface PetBubbleAction {
  id: string;
  label: string;
  kind?: 'primary' | 'ghost';
  /** Optional launch attached to this button — overrides payload.launch
   *  for this click. */
  launch?: LaunchSpec;
}

/** Payload for `pet://bubble-show`. Emitted by trigger sources (currently the
 *  Rust demo menu item; future: schedule reminder, pet-chat new message, task
 *  events, external push). `title` is optional but, when present, is clickable
 *  and jumps to `target`. `actions` are rendered as buttons. `placement`
 *  overrides `petStore.bubblePlacement` for this single notification (PRD
 *  pet-popover-corner, Decision C). */
export interface PetBubblePayload {
  text: string;
  title?: string;
  kind?: PetBubbleKind;
  source?: string;
  /** Arbitrary key-value passthrough from HTTP body — exposed to templates
   *  via `{{data.x}}` placeholders. */
  data?: Record<string, unknown>;
  /** Template id for this single notification; overrides the global
   *  `activeTemplateId`. Missing → fall back to active, then to `default`. */
  template?: string;
  /** Inline template draft for "preview before import" — when present, used
   *  directly instead of looking up `template` / active / default. Lets the
   *  BubbleTemplate AI Agent preview an unsaved draft without polluting
   *  userTemplates. */
  templateDraft?: BubbleTemplate;
  /** Placement override for this single notification; overrides the global
   *  `bubblePlacement`. Missing → fall back to `bubblePlacement`, then to
   *  `'top'`. 12 antd-style placements; see `Placement` in `petPosition.ts`. */
  placement?: Placement;
  target?: PetBubbleTarget;
  /** Top-level launch: clicking anywhere on the bubble (except close and
   *  action buttons) triggers it. */
  launch?: LaunchSpec;
  actions?: PetBubbleAction[];
}

/** Payload for `pet://bubble-action` — emitted by the bubble on title/action
 *  click, consumed by the main-window listener (App.tsx) which executes the
 *  jump and focuses the target window.
 *  - `type: 'navigate'` = title click (or default action).
 *  - `type: 'action'` = a named action button.
 *  - `type: 'launch'` = a launch-spec click (top-level launch or action with
 *    embedded launch). `launch` is the spec to open.
 *  - `type: 'authorize'` = user approved an unwhitelisted app; `mode` picks
 *    once-vs-whitelist; main window writes the whitelist and retries. */
export interface PetBubbleActionEvent {
  type: 'navigate' | 'action' | 'launch' | 'authorize';
  actionId?: string;
  target?: PetBubbleTarget;
  source?: string;
  launch?: LaunchSpec;
  authorize?: { app: string; mode: 'once' | 'whitelist' };
}

/** State held while the bubble waits for the user to authorize an unwhitelisted
 *  app. `source` lets the authorize event echo it back so downstream
 *  consumers preserve the original trigger attribution. */
interface AuthorizeRequest {
  app: string;
  launch: LaunchSpec;
  source?: string;
}

/** Physical-position result from `get_pet_position` (physical px). */
interface PetPositionResult {
  x: number;
  y: number;
}

/**
 * Show the bubble: size to the template's preferred card, position it per
 * the resolved placement above/beside the pet, then reveal. Reads the pet's
 * physical position + the work area, computes a placement-aware logical
 * position (flipping/clamping per the 12 antd-style placements), converts to
 * physical, and sets it before `pet_bubble_show` so the bubble appears at the
 * right spot in one frame (no flash at the default origin — mirrors the
 * `pet-panel` open path).
 *
 * `bubbleSize` is the template's declared logical size (or the 320×120
 * default). The window is resized to that size in physical px before
 * `computeBubblePosition` runs so the flip/clamp math tracks the actual
 * card. The position math also uses the actual size so a tall Cloudia card
 * still clears the menu bar / flips below when needed.
 */
async function positionAndShowBubble(
  bubbleSize: { width: number; height: number },
  placement: Placement,
  petSize: PetSize,
): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const [petPos, workArea] = await Promise.all([
    invoke<PetPositionResult>('get_pet_position'),
    invoke<PetWorkArea>('pet_get_work_area'),
  ]);
  // Pet screen's scale — converts the pet's PHYSICAL position to logical.
  const screenSf = workArea.scale_factor || 1;
  // The BUBBLE window's own scale — converts the logical frame back to
  // physical for set_size / set_position. The two differ while the bubble
  // window is still on its old display (first show after the pet moves to a
  // different-DPI screen); mixing them made the first bubble half-size and
  // misplaced. See currentWindowScaleFactor.
  const winSf = await currentWindowScaleFactor(screenSf);
  // petPos is PHYSICAL px → logical for the math, then × winSf back to
  // physical for pet_bubble_set_position. See petPosition.ts unit contract.
  const petPosLogical = { x: petPos.x / screenSf, y: petPos.y / screenSf };
  const posLogical = computeBubblePosition(
    petPosLogical,
    workArea,
    petSize,
    bubbleSize,
    placement,
  );
  await invoke('pet_bubble_set_size', {
    width: Math.round(bubbleSize.width * winSf),
    height: Math.round(bubbleSize.height * winSf),
  });
  await invoke('pet_bubble_set_position', {
    x: Math.round(posLogical.x * winSf),
    y: Math.round(posLogical.y * winSf),
  });
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
 * event arrives; renders the active template (sanitized), runs the TTL, and
 * emits `pet://bubble-action` on title/action/launch click.
 *
 * Template selection order: `payload.template` (per-notification override) →
 * `activeTemplateId` (PR3 store slice) → `'default'`. The shell renders
 * `<div class="pet-bubble-root pet-bubble--{kind}">` so `--bubble-accent` is
 * set by kind (see pet.css); templates may use `var(--bubble-accent)`.
 *
 * Click handling uses event delegation: the root listens for `[data-action]`
 * clicks and emits `pet://bubble-action`. `data-action="close"` closes the
 * bubble locally; other ids route to the main window.
 */
export function PetBubbleApp(): JSX.Element {
  const [bubble, setBubble] = useState<PetBubblePayload | null>(null);
  const [authorize, setAuthorize] = useState<AuthorizeRequest | null>(null);
  // Inline draft template (preview-before-import). Cleared on close and on
  // any subsequent bubble-show without a draft.
  const [draftTemplate, setDraftTemplate] = useState<BubbleTemplate | null>(null);
  const ttlRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ponytail: subscribe to user templates + active id. The bubble is a
  // separate window but petStore's storage backend (appDataDir/storage.json)
  // is shared, so hydration mirrors the main window's view. Settings UI
  // updates land here through the same storage events.
  const userTemplates = usePetStore((s) => s.bubbleUserTemplates);
  const activeTemplateId = usePetStore((s) => s.bubbleActiveTemplateId);

  // Clear the TTL timer (if any) without touching the bubble window.
  const clearTtl = () => {
    if (ttlRef.current) {
      clearTimeout(ttlRef.current);
      ttlRef.current = null;
    }
  };

  // Close: clear TTL, hide the window, drop the payload + authorize state.
  const close = () => {
    clearTtl();
    setBubble(null);
    setAuthorize(null);
    setDraftTemplate(null);
    void hideBubble();
  };

  // Fire a jump: emit `pet://bubble-action` to the main window. For launch
  // we keep the bubble open — if the app isn't whitelisted, the main window
  // emits `pet://bubble-authorize-request` back and the authorize UI must
  // render over the still-visible card (closing here would null `bubble`
  // and the `!bubble` short-circuit hides the authorize prompt — user sees
  // nothing and assumes the click did nothing). Success has no return
  // signal, so TTL or the ✕ button closes.
  const fireAction = async (event: PetBubbleActionEvent) => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://bubble-action', event);
    } catch {
      // Non-fatal — still close so the bubble doesn't stick.
    }
    if (event.type !== 'launch') close();
  };

  // Inject the CSP meta + the template's CSS into the bubble document head.
  // CSP is one-shot (set on first mount); CSS is re-injected when the template
  // changes. We don't use a `<style>` React element because the template CSS
  // may be large and we want to control injection timing exactly.
  useEffect(() => {
    if (!isTauri()) return;
    // CSP: blocks remote resources — img/font/@import — so a malicious
    // template can't exfiltrate via URL() or beacon a remote image.
    const cspId = 'pet-bubble-csp';
    if (!document.getElementById(cspId)) {
      const meta = document.createElement('meta');
      meta.id = cspId;
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";
      document.head.appendChild(meta);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlistenShow: (() => void) | null = null;
    let unlistenAuth: (() => void) | null = null;
    let unlistenSettings: (() => void) | null = null;
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
      unlistenShow = await listen<PetBubblePayload>('pet://bubble-show', (event) => {
        const payload = event.payload;
        if (!payload?.text) return;
        // Replace any in-flight bubble: clear the old TTL before showing the new.
        clearTtl();
        setAuthorize(null);
        setBubble(payload);
        // Resolve the template's preferred size (or the 320×120 default) so
        // the window matches the rendered card. Reading from petStore
        // `.getState()` (not the hook selector) so this closure always sees
        // the latest user templates + active id without re-subscribing the
        // effect.
        const store = usePetStore.getState();
        const templates = [...BUILT_IN_TEMPLATES, ...store.bubbleUserTemplates];
        // ponytail: a draft template (preview-before-import) bypasses the ID
        // lookup entirely — used directly for sizing + render so the preview
        // shows the unsaved JSON without polluting userTemplates.
        const tpl = payload.templateDraft ?? getTemplateById(
          payload.template ?? store.bubbleActiveTemplateId,
          templates,
        );
        setDraftTemplate(payload.templateDraft ?? null);
        const size = tpl.size ?? { width: 320, height: 120 };
        // Placement resolution: payload.placement → 'top'. Reading from
        // `.getState()` so this closure always sees the latest global default
        // without re-subscribing the effect.
        const placement = payload.placement ?? 'top';
        // petSize from the live store so the bubble math tracks the actual
        // mascot footprint — passing PET_SIZE_DEFAULT left larger pets ('125'
        // / '150') occluded by the bubble when shown below, because the gap
        // math used the smaller default window size.
        const petSize = store.petSize ?? PET_SIZE_DEFAULT;
        void positionAndShowBubble(size, placement, petSize);
        // ponytail: TTL shared with corner toast via store.cornerTtlMs. 'never'
        // = sticky (no auto-dismiss). Authorize flow doubles the TTL.
        const ttl = store.cornerTtlMs;
        if (ttl !== 'never') ttlRef.current = setTimeout(() => close(), ttl);
      });
      // Authorize channel: main window emits when an unwhitelisted app needs
      // user approval. The bubble switches to the authorize UI; the regular
      // bubble HTML is kept in `bubble` so the user has context.
      unlistenAuth = await listen<AuthorizeRequest>(
        'pet://bubble-authorize-request',
        (event) => {
          const req = event.payload;
          if (!req?.app || !req?.launch) return;
          clearTtl();
          setAuthorize(req);
          // Extend TTL so the user has time to decide; 'never' stays sticky.
          const ttl = usePetStore.getState().cornerTtlMs;
          if (ttl !== 'never') ttlRef.current = setTimeout(() => close(), ttl * 2);
        },
      );
      // Cross-window settings sync (mirrors PetCornerApp). The bubble
      // window holds its own petStore instance; without this listener it
      // would read default `petSize='100'` forever — see `loadSettings`
      // in settingsPersistence.ts for why this matters for the gap math.
      unlistenSettings = await listen<Record<string, unknown>>(
        'pet://settings-updated',
        (event) => {
          if (event.payload) hydrateAllStores(event.payload);
        },
      );
      if (cancelled) {
        unlistenShow();
        unlistenAuth();
        unlistenSettings?.();
      }
    })();

    return () => {
      cancelled = true;
      clearTtl();
      unlistenShow?.();
      unlistenAuth?.();
      unlistenSettings?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-inject template CSS when the active template changes. The CSS lives
  // in a single <style id="pet-bubble-template-css"> element so we replace
  // rather than stack.
  const allTemplates = [...BUILT_IN_TEMPLATES, ...userTemplates];
  // ponytail: preview draft takes precedence over the ID lookup so an
  // unsaved draft from the AI Agent chat renders without being added to
  // userTemplates.
  const activeTemplate: BubbleTemplate = draftTemplate ?? getTemplateById(
    bubble?.template ?? activeTemplateId,
    allTemplates,
  );
  useEffect(() => {
    const styleId = 'pet-bubble-template-css';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = activeTemplate.css;
  }, [activeTemplate]);

  // Hidden state: render nothing (the window itself is hidden via
  // pet_bubble_hide). When a payload arrives, React renders the card before
  // positionAndShowBubble reveals the window — so the first visible frame
  // already has content (no empty flash).
  if (!bubble) return <></>;

  const kind = bubble.kind ?? 'info';
  const kindClass = `pet-bubble--${kind}`;

  // Authorize UI overrides the template-rendered HTML when the main window
  // has asked for an unwhitelisted app approval. Hardcoded (not template-
  // rendered) because the authorize flow is a system-level concern — the
  // template should not be able to suppress or forge the security prompt.
  if (authorize) {
    return (
      <div className={`pet-bubble-root pet-bubble--event ${kindClass}`}>
        <div className="pet-bubble-card pet-bubble-authorize">
          <button
            className="pet-bubble-close"
            onClick={close}
            aria-label="关闭"
          >✕</button>
          <div className="pet-bubble-title">未授权应用</div>
          <div className="pet-bubble-text">
            允许通知打开应用「{authorize.app}」?
          </div>
          <div className="pet-bubble-actions">
            <button
              className="pet-bubble-btn pet-bubble-btn--ghost"
              onClick={() => void fireAction({
                type: 'authorize',
                authorize: { app: authorize.app, mode: 'once' },
                launch: authorize.launch,
                source: authorize.source,
              })}
            >本次允许</button>
            <button
              className="pet-bubble-btn pet-bubble-btn--primary"
              onClick={() => void fireAction({
                type: 'authorize',
                authorize: { app: authorize.app, mode: 'whitelist' },
                launch: authorize.launch,
                source: authorize.source,
              })}
            >允许并加入白名单</button>
          </div>
        </div>
      </div>
    );
  }

  const renderedHtml = sanitizeBubbleHtml(renderTemplate(activeTemplate, bubble));

  // ponytail: event delegation — one onClick on the root handles every
  // [data-action] inside the template. Close is handled locally; navigate
  // emits to main window (legacy title-jump behavior). Other actionIds
  // route to the main window. If payload.launch is set and the click target
  // isn't a [data-action], the click triggers the top-level launch.
  const onRootClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const actionEl = target.closest('[data-action]') as HTMLElement | null;
    if (actionEl) {
      const actionId = actionEl.dataset.action;
      if (actionId === 'close') {
        close();
        return;
      }
      if (actionId === 'navigate') {
        void fireAction({
          type: 'navigate',
          target: bubble.target,
          source: bubble.source,
        });
        return;
      }
      // Find the matching action by id to surface its launch (if any).
      const action = (bubble.actions ?? []).find((a) => a.id === actionId);
      void fireAction({
        type: action?.launch ? 'launch' : 'action',
        actionId,
        target: bubble.target,
        source: bubble.source,
        launch: action?.launch,
      });
      return;
    }
    // No [data-action] hit: top-level launch fires if present.
    if (bubble.launch) {
      void fireAction({
        type: 'launch',
        target: bubble.target,
        source: bubble.source,
        launch: bubble.launch,
      });
    }
  };

  return (
    <div
      className={`pet-bubble-root ${kindClass}`}
      onClick={onRootClick}
      role="presentation"
    >
      <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
    </div>
  );
}
