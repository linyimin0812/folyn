// useGlobalShortcuts — document-level keyboard shortcuts (Cmd+S save,
// Cmd+Shift+F search, focus mode, select-all, cursor-sync toggle, command
// palette). Extracted from App.tsx (split-oversized-p1-files).
//
// Spec: hook-guidelines.md (effect cleanup).

import { useEffect } from 'react';
import * as editorIoService from '@/services/editorIoService';import { useEditorStore } from '@/store/editorStore';
import { useSearchStore } from '@/store/searchStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useEditorPrefsStore } from '@/store/editorPrefsStore';
import { usePrefsStore, type ShortcutItem } from '@/store/prefsStore';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useDocLinkHistory } from '@/store/docLinkHistory';
import { eventMatchesShortcut } from '@/utils/shortcutAccelerator';
import { listenForForwardedKeys } from '@/utils/iframeShortcuts';
import { useNavStore } from '@/store/navStore';
import { getHandlerById, getSupportedModes } from '@/components/file-types/registry';

export function useGlobalShortcuts() {
  // ── Global Ctrl+S / Cmd+S and Cmd+Shift+F ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const activeTabId = useEditorStore.getState().activeTabId;
        if (activeTabId) {
          editorIoService.saveFile(activeTabId);
        }
      }
      // Global search (find in files) — Cmd/Ctrl+Shift+F.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        const { isOpen, openPanel, closePanel } = useSearchStore.getState();
        if (isOpen) {
          closePanel();
        } else {
          openPanel();
        }
      }
      // ESC exits focus mode (专注模式). Skipped when a modal layer that also
      // owns ESC (command palette, search panel) is open, so one ESC closes
      // that layer first instead of both at once.
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const { focusMode, setFocusMode } = useEditorViewStateStore.getState();
        if (
          focusMode &&
          !useCommandPaletteStore.getState().isOpen &&
          !useSearchStore.getState().isOpen
        ) {
          e.preventDefault();
          setFocusMode(false);
        }
      }
      // Focus mode — Cmd/Ctrl+Shift+Enter. Hides every sidebar/dock/topbar/
      // status bar so only the editor/preview area is visible.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key === 'Enter') {
        e.preventDefault();
        useEditorViewStateStore.getState().toggleFocusMode();
      }
      // Presentation mode (演示模式) — default Cmd/Ctrl+Shift+F5, rebindable via
      // Settings → Shortcuts (prefsStore `presentationMode` entry). Toggles the
      // fullscreen slide-deck overlay. Esc inside the overlay exits.
      const presentationModeShortcut = usePrefsStore
        .getState()
        .shortcuts.find((s: ShortcutItem) => s.id === 'presentationMode');
      if (presentationModeShortcut && eventMatchesShortcut(e, presentationModeShortcut.keys)) {
        e.preventDefault();
        useEditorViewStateStore.getState().togglePresentationMode();
      }
      // View mode cycle — default Cmd/Ctrl+Shift+Space, rebindable via
      // Settings → Shortcuts (prefsStore `cycleViewMode` entry). Steps the
      // active file through the modes its provider offers, in the topbar's
      // order (edit → split → preview), wrapping at the end.
      const cycleViewModeShortcut = usePrefsStore
        .getState()
        .shortcuts.find((s: ShortcutItem) => s.id === 'cycleViewMode');
      if (cycleViewModeShortcut && eventMatchesShortcut(e, cycleViewModeShortcut.keys)) {
        const { tabs, activeTabId, viewMode, setViewMode } = useEditorStore.getState();
        const activeTab = tabs.find((t) => t.id === activeTabId);
        const modes = getSupportedModes(activeTab ? getHandlerById(activeTab.fileType) : undefined);
        if (useNavStore.getState().currentPage === 'editor' && modes.length > 1) {
          e.preventDefault();
          setViewMode(modes[(modes.indexOf(viewMode) + 1) % modes.length]);
        }
      }
      // Cmd/Ctrl+A selects all in native <input>/<textarea>. CodeMirror has
      // its own Mod-a keymap that preventDefaults, so it never reaches here.
      // Tauri's Edit menu lacks a Select All item on purpose — adding
      // `.select_all()` regresses CodeMirror (menu accelerator intercepts
      // Cmd+A before the webview gets the keydown).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
        const el = e.target as HTMLElement | null;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          e.preventDefault();
          el.select();
        }
      }
      // Cursor sync toggle — default Cmd/Ctrl+Shift+I, rebindable via
      // Settings → Shortcuts (prefsStore `cursorSync` entry). Toggles preview
      // cursor-sync (scroll + highlight) in split mode. Default on.
      const cursorSyncShortcut = usePrefsStore
        .getState()
        .shortcuts.find((s: ShortcutItem) => s.id === 'cursorSync');
      if (cursorSyncShortcut && eventMatchesShortcut(e, cursorSyncShortcut.keys)) {
        e.preventDefault();
        const { cursorSyncPreview, setCursorSyncPreview } = useEditorPrefsStore.getState();
        setCursorSyncPreview(!cursorSyncPreview);
      }
      // Cmd/Ctrl+P (no Shift) toggles the command palette. Shift is reserved
      // (e.g. Cmd+Shift+P / Cmd+Shift+F), so this branch only fires without it.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'p'
      ) {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
      }
      // Back/forward along followed document links — Cmd/Ctrl+[ and ]. Skipped
      // in editable targets, where CodeMirror binds them to indent less/more.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === '[' || e.key === ']')) {
        const el = e.target as HTMLElement | null;
        if (!el?.isContentEditable && !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          const history = useDocLinkHistory.getState();
          if (e.key === '[') history.goBack();
          else history.goForward();
        }
      }
    };
    // Mouse side buttons (3 = back, 4 = forward) walk the same trail.
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      const history = useDocLinkHistory.getState();
      if (e.button === 3) history.goBack();
      else history.goForward();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mouseup', handleMouseUp);
    // Sandboxed preview iframes (HTML files) post their shortcut keys here;
    // they are replayed on this document and reach handleKeyDown above.
    const stopForwarding = listenForForwardedKeys();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mouseup', handleMouseUp);
      stopForwarding();
    };
  }, []);
}
