// usePersistOnClose — flushes persisted settings (and open tabs) before the
// main window closes. Extracted from App.tsx (split-oversized-p1-files).
//
// Spec: hook-guidelines.md (effect cleanup, teardown-races-await guard).

import { useEffect } from 'react';
import * as editorIoService from '@/services/editorIoService';
import { persistNow } from '@/store/settingsPersistence';
import { usePetStore } from '@/store/petStore';
import { isTauri } from '@/utils/platform';

export function usePersistOnClose() {
  // ponytail: flush persisted settings before the window closes. The 300ms
  // debounce in storageClient would otherwise drop the last setter's write
  // if the user changes a setting and Cmd+Q / closes the window within
  // that window. pet menu "退出应用" goes through routePetMenuAction which
  // also awaits persistNow; this listener covers Cmd+Q and window-close.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        unlisten = await getCurrentWindow().onCloseRequested(async (e) => {
          e.preventDefault();
          try {
            // Flush open tabs first (sync, marks storage dirty), then
            // persistNow() flushes everything to disk. Without this, closing
            // a tab and quitting within the persist debounce window would
            // restore the closed tab on the next launch.
            editorIoService.saveOpenTabs();
            await persistNow();
          } catch (err) {
            console.warn('[App] persistNow on close failed:', err);
          }
          // ponytail: pet mode on → Rust's on_window_event owns the hide
          // (prevent_close + hide, and fullscreen-aware on macOS: hiding a
          // fullscreen window under macOSPrivateApi leaves a black fullscreen
          // Space behind, so Rust exits fullscreen + waits for the transition
          // before hiding). The webview stays alive after the window is
          // hidden, so the persistNow() flush above is not cut short. Pet off
          // → real close (app exits, pet window cleanup is automatic).
          const petOn = usePetStore.getState().petModeEnabled;
          if (!petOn) {
            await getCurrentWindow().destroy();
          }
        });
      } catch (err) {
        console.warn('[App] close-requested listener setup failed:', err);
      }
      if (cancelled) unlisten?.();
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
