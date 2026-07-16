// Pet host routing helpers (PRD: extract-pet-host-bridge-from-app).
//
// Pure async functions (no React) that route `pet://menu-action` and
// `pet://bubble-action` events to the main-window store actions / Tauri
// invoke / emit calls. Lifted verbatim from App.tsx :257-378 so behavior is
// unchanged; App.tsx still owns the inline copy until PR2 swaps it for
// `usePetHostBridge()`. The router is main-window-only — it reads
// navStore/petStore/editorStore/etc. and calls main-window services
// (editorIoService, requestNewItem) that secondary windows do not own.
//
// Spec: tauri-window-patterns.md (pet:// event channels, window isolation),
// hook-guidelines.md (data fetching via store getState + service functions).

import type { PetMenuAction } from '@/components/pet/PetContextMenu';
import type { PetBubbleActionEvent } from '@/components/pet/PetBubbleApp';
import { useNavStore } from '@/store/navStore';
import { usePetStore } from '@/store/petStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useSearchStore } from '@/store/searchStore';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { usePetChatStore } from '@/store/petChatStore';
import * as editorIoService from './editorIoService';
import { requestNewItem } from './newItemBridge';

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
  size?: 'small' | 'medium' | 'large',
): Promise<void> {
  switch (action) {
    case 'show-main':
      await focusMain();
      break;
    case 'new-note':
      requestNewItem('file');
      await focusMain();
      break;
    case 'toggle-ai':
      useEditorViewStateStore.getState().toggleAiPanel();
      await focusMain();
      break;
    case 'hide-pet':
      // Chinese-labeled sibling of `disable-pet` (PRD D1): same behavior,
      // distinct label. Falls through to the disable-pet branch.
    case 'disable-pet':
      usePetStore.getState().setPetModeEnabled(false);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('toggle_pet_mode');
      } catch {
        // Non-fatal; the menu bar item can still toggle it off.
      }
      break;
    case 'set-pet-size': {
      const level = size ?? 'medium';
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
  }
}

/** Route a `pet://bubble-action` jump. Verbatim port of App.tsx
 *  `handleBubbleAction` (:350-378): routes by `target.kind` to the schedule
 *  page / pet-panel chat session / editor file tab and brings the target
 *  window forward. */
export async function routePetBubbleAction(
  event: PetBubbleActionEvent,
): Promise<void> {
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
      usePetChatStore.getState().switchSession(target.id);
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
