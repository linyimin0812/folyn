// Pet host routing helpers (PRD: extract-pet-host-bridge-from-app).
//
// Pure async functions (no React) that route `pet://menu-action` and
// `pet://bubble-action` events to the main-window store actions / Tauri
// invoke / emit calls. Lifted verbatim from App.tsx :257-378 so behavior is
// unchanged; App.tsx still owns the inline copy until PR2 swaps it for
// `usePetHostBridge()`. The router is main-window-only — it reads
// navStore/petStore/editorStore/etc. and calls main-window services
// (editorIoService) that secondary windows do not own.
//
// Spec: tauri-window-patterns.md (pet:// event channels, window isolation),
// hook-guidelines.md (data fetching via store getState + service functions).

import type { PetMenuAction } from '@/components/pet/PetContextMenu';
import type { PetBubbleActionEvent } from '@/components/pet/PetBubbleApp';
import { useNavStore } from '@/store/navStore';
import { usePetStore } from '@/store/petStore';
import { useSearchStore } from '@/store/searchStore';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useAiStore } from '@/store/aiStore';
import * as editorIoService from './editorIoService';

/** Focus the main editor window (show + setFocus). Swallows errors so a
 *  missing `core:window:allow-*` permission or a non-Tauri env does not
 *  break the routing path. Mirrors App.tsx `focusMain`. */
async function focusMain(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  } catch {
    // Non-fatal.
  }
}

/** Route a `pet://menu-action` payload. Verbatim port of App.tsx `handleAction`
 *  (:272-343): each action dispatches to store actions / services and focuses
 *  the main editor so it comes forward. */
export async function routePetMenuAction(
  action: PetMenuAction,
  size?: '50' | '75' | '100' | '125' | '150',
  opacity?: '25' | '50' | '75' | '100',
  clickThrough?: boolean,
): Promise<void> {
  switch (action) {
    case 'show-main':
      await focusMain();
      break;
    case 'hide-pet':
      // Toggle the pet visibility. The tray menu surfaces this as a
      // `CheckMenuItem` (checked = pet hidden) — mirroring the click-through
      // toggle pattern; the pet right-click popup uses a plain `MenuItem`
      // because you can't right-click a hidden pet. Both paths route through
      // this single handler. `toggle_pet_mode` (Rust) reads `pet.is_visible()`
      // and flips it, then emits `pet://visibility-changed` which syncs the
      // store. The optimistic `setPetModeEnabled` below mirrors the flip so
      // the UI updates before the round-trip lands.
      {
        const currentlyVisible = usePetStore.getState().petModeEnabled;
        usePetStore.getState().setPetModeEnabled(!currentlyVisible);
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('toggle_pet_mode');
        } catch {
          // Non-fatal; the menu bar item can still toggle it off.
        }
      }
      break;
    case 'set-pet-size': {
      const level = size ?? '100';
      usePetStore.getState().setPetSize(level);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        // Rust resizes the pet window + updates the shared size state so
        // the next right-click menu pre-checks the new radio item.
        await invoke('set_pet_size', { level });
        // Notify the pet window to re-clamp its position + re-scale the
        // mascot SVG (the pet window owns its own store instance + sprite
        // layer, so the main window cannot resize them directly).
        const { emit } = await import('@tauri-apps/api/event');
        await emit('pet://size-changed', { size: level });
      } catch {
        // Non-fatal; the settings still persisted, next launch restores.
      }
      break;
    }
    case 'set-pet-opacity': {
      const level = opacity ?? '100';
      usePetStore.getState().setPetOpacity(level);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        // Rust sets the pet NSWindow alpha + updates the shared opacity
        // state so the next right-click menu pre-checks the new radio item.
        await invoke('set_pet_opacity', { level });
      } catch {
        // Non-fatal; the settings still persisted, next launch restores.
      }
      break;
    }
    case 'toggle-pet-click-through': {
      const next = clickThrough ?? !usePetStore.getState().petClickThrough;
      usePetStore.getState().setPetClickThrough(next);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_pet_click_through', { enabled: next });
      } catch {
        // Non-fatal; the settings still persisted, next launch restores.
      }
      break;
    }
    case 'exit-app':
      try {
        // Flush persisted settings BEFORE invoking exit_app — Rust
        // `app.exit(0)` terminates the process before the reply is
        // delivered, so any pending debounced write (300ms in
        // storageClient) would be dropped. The window-close path is
        // covered by App.tsx's onCloseRequested listener; this covers
        // the pet right-click "退出应用" menu item.
        const { persistNow } = await import('../store/settingsPersistence');
        await persistNow();
        const { invoke } = await import('@tauri-apps/api/core');
        // Rust `exit_app` calls `app.exit(0)` — the process terminates
        // before the reply can be delivered, so this await never resolves.
        await invoke('exit_app');
      } catch {
        // Non-fatal; the user can still quit via the macOS app menu bar
        // (Quill → Quit Quill) if the invoke fails.
      }
      break;
    // ── Pet-panel launcher actions (PR1). Dispatched by the pet-panel
    // launcher grid via the same `pet://menu-action` channel. Each action
    // that targets the main editor focuses it so the editor comes forward.
    // `clip-from-url` is handled in-panel (PR2) — the listener just focuses
    // main as a no-op-ish fallback. ──
    case 'daily-note':
      void editorIoService.openDailyNote();
      await focusMain();
      break;
    case 'global-search':
      useSearchStore.getState().openPanel();
      await focusMain();
      break;
    case 'clip-from-url':
      // Handled inside the pet-panel (inline URL form, PR2). Focus main as a
      // safe fallback so the user sees the editor if the panel flow is
      // interrupted.
      await focusMain();
      break;
    case 'command-palette':
      useCommandPaletteStore.getState().toggle();
      await focusMain();
      break;
    case 'toggle-theme':
      useAppearanceStore.getState().toggleTheme();
      await focusMain();
      break;
    case 'open-ai-settings':
      // Secondary windows (voice-orb caption link, pet-panel chat CTA) emit
      // this because they cannot touch the main window's navStore directly
      // (separate JS realm). Routing here in the main window sets the page
      // + tab and focuses the editor so the user lands on model-services
      // settings (the chat/LLM tab — pet/voice CTAs are about chat config).
      useNavStore.getState().setCurrentPage('settings');
      useNavStore.getState().setSettingsTab('models');
      await focusMain();
      break;
  }
}

/** Route a `pet://bubble-action` jump. Handles four event types:
 *  - `navigate`: title click with a target → main-window navigation.
 *  - `action`: named action button → caller-defined behavior (the main window
 *    routes by `target.kind` to schedule/chat/file).
 *  - `launch`: open an external URL or macOS app via `open_external`. If the
 *    app isn't on the whitelist, the Rust command returns `not_in_whitelist`
 *    and we emit `pet://bubble-authorize-request` so the bubble shows its
 *    authorize UI.
 *  - `authorize`: user approved an unwhitelisted app. `mode = 'whitelist'`
 *    writes the app to the store; both modes retry the launch with the app
 *    in the effective whitelist for this one call. */
export async function routePetBubbleAction(
  event: PetBubbleActionEvent,
): Promise<void> {
  // ponytail: branch on type first. Launch + authorize don't carry target,
  // so the legacy target.kind routing is only for navigate/action.
  if (event.type === 'launch') {
    await handleLaunch(event);
    return;
  }
  if (event.type === 'authorize') {
    await handleAuthorize(event);
    return;
  }
  const target = event.target;
  if (!target) {
    await focusMain();
    return;
  }
  switch (target.kind) {
    case 'schedule':
      useNavStore.getState().setCurrentPage('schedule');
      await focusMain();
      break;
    case 'chat':
      useAiStore.getState().switchSession(target.id);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('pet_panel_show');
      } catch {
        // Non-fatal — session still switched in-store.
      }
      break;
    case 'file':
    case 'task': {
      const name = target.id.split('/').pop() || target.id;
      await editorIoService.openFile(target.id, name);
      await focusMain();
      break;
    }
  }
}

/** Invoke `open_external` and emit an authorize-request back to the bubble if
 *  the app isn't whitelisted. Swallows errors so a non-Tauri env doesn't
 *  crash the routing path. */
async function handleLaunch(event: PetBubbleActionEvent): Promise<void> {
  if (!event.launch) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const { emit } = await import('@tauri-apps/api/event');
    const whitelist = usePetStore.getState().bubbleAppWhitelist;
    const result = await invoke<{ status: string; app?: string; reason?: string }>(
      'open_external',
      { target: event.launch, whitelist },
    );
    if (result.status === 'not_in_whitelist' && result.app) {
      await emit('pet://bubble-authorize-request', {
        app: result.app,
        launch: event.launch,
        source: event.source,
      });
    }
  } catch {
    // Non-fatal — the bubble stays open; user can retry.
  }
}

/** Authorize an unwhitelisted app, then retry the launch with the app in the
 *  effective whitelist for this one call. `mode = 'whitelist'` also writes
 *  to the store so future launches succeed without re-authorizing. */
async function handleAuthorize(event: PetBubbleActionEvent): Promise<void> {
  if (!event.authorize || !event.launch) return;
  const { app, mode } = event.authorize;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    // For 'once' mode we still need to allow this one attempt — pass the app
    // in the whitelist for this call only. For 'whitelist' mode we persist
    // AND pass in this call.
    const current = usePetStore.getState().bubbleAppWhitelist;
    const effective = current.includes(app) ? current : [...current, app];
    await invoke('open_external', { target: event.launch, whitelist: effective });
    if (mode === 'whitelist') {
      usePetStore.getState().addBubbleAppToWhitelist(app);
    }
  } catch {
    // Non-fatal — the bubble stays open; user can retry.
  }
}
