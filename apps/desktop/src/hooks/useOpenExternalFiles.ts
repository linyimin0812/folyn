// useOpenExternalFiles — OS "Open With" / file-association launch: listens for
// `app://open-external-file` emits and drains the Rust-side pending buffer.
// Extracted from App.tsx (split-oversized-p1-files).
//
// Spec: hook-guidelines.md (effect cleanup, teardown-races-await guard).

import { useEffect } from 'react';
import * as editorIoService from '@/services/editorIoService';
import { useNavStore } from '@/store/navStore';
import { isTauri } from '@/utils/platform';

export function useOpenExternalFiles() {
  // ── OS "Open With" / file-association launch ──
  // When the OS launches Folyn to open a file (right-click → Open With →
  // Folyn, or double-click an associated file), the Rust side buffers the
  // paths in `PendingOpenFiles` AND emits `app://open-external-file` (from
  // `RunEvent::Opened` on macOS and the single-instance callback on both
  // platforms). We listen FIRST so warm-launch emits are never missed, then
  // drain the buffer so cold-launch paths (arrived before React mounted)
  // are recovered. Each path opens as a vault-independent external tab.
  // Safe to fire before `restoreOpenTabs` completes — `openFile` is
  // idempotent on the tab id.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const openPaths = (paths: string[]) => {
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop()!;
        void editorIoService.openFile(p, name);
      }
      if (paths.length > 0) {
        useNavStore.getState().setCurrentPage('editor');
      }
    };
    // Register the listener FIRST so warm-launch emits are never missed,
    // then drain the backend buffer (cold-launch paths that arrived before
    // React mounted). A path can be delivered twice (once via the event,
    // once via the drain) — `openFile` is idempotent on the tab id, so the
    // second delivery just re-activates the tab. The two steps are
    // independent: a failure in one must not disable the other (e.g. a
    // missing `drain_pending_open_files` on an older backend must not kill
    // the warm-launch listener).
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<string[]>('app://open-external-file', (e) => {
          openPaths(e.payload ?? []);
        });
      } catch (err) {
        console.warn('[App] open-external-file listener setup failed:', err);
      }
      if (cancelled) unlisten?.();
    })();
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const pending = await invoke<string[]>('drain_pending_open_files');
        openPaths(pending ?? []);
      } catch (err) {
        console.warn('[App] drain pending open files failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
