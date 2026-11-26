// useOsFileDragDrop — OS file/folder drag-and-drop onto the main window (and
// research windows — the hook mounts at App level, both window kinds run the
// same shell). Extracted from App.tsx (split-oversized-p1-files).
//
// Returns `fileDragActive` for the full-window drop overlay; the overlay JSX
// stays in App.
//
// Spec: hook-guidelines.md (effect cleanup).
//
// ── Why native drag events (dragDropEnabled: true) ──
// The main + research windows enable Tauri's `dragDropEnabled`, so wry
// installs its NSDraggingDestination handler on the WKWebView and Tauri
// forwards `tauri://drag-enter/over/drop/leave` with REAL absolute paths —
// including folders, which HTML5 drops cannot deliver on macOS (WKWebView
// hands the page a File with name/size only and no path; a folder arrives as
// a zero-byte File with no extension, undetectable and unopenable — the
// "drag a folder into the window does nothing" bug).
//
// What the flip does NOT break (source-verified, wry 0.55.1 + WKWebView):
// in-page HTML5 DnD the page starts itself (rich-text node/table drag in the
// extension iframe, CodeMirror dragMovesSelection) runs through
// WKContentView's own drag machinery and does not pass through wry's outer
// handler. What it does remove: OS-originated drags landing on page
// elements as HTML5 drop targets — external drags are consumed at the
// AppKit level before WebKit sees them, so they land as window-level opens
// (this hook) instead. That is the intended behavior: files/folders dropped
// anywhere in the window open/register.

import { useEffect, useState } from 'react';
import * as editorIoService from '@/services/editorIoService';
import { isTauri } from '@/utils/platform';

export function useOsFileDragDrop() {
  const [fileDragActive, setFileDragActive] = useState(false);

  // ── OS file drag-and-drop onto the window (native Tauri events) ──
  // drag-enter shows the full-window overlay, drag-leave/drop clears it, and
  // drop routes the real absolute paths through the shared external-path
  // entry point: folders register as external folders (Files panel, with
  // duplicate/boundary toasts), files open as external tabs.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        unlisten = await getCurrentWebview().onDragDropEvent((evt) => {
          const event = evt.payload;
          if (event.type === 'drop') {
            setFileDragActive(false);
            void editorIoService.openExternalPaths(event.paths);
          } else {
            // enter / over keep the overlay up; leave clears it.
            setFileDragActive(event.type !== 'leave');
          }
        });
      } catch (err) {
        console.warn('[useOsFileDragDrop] native drag-drop listener failed:', err);
      }
      if (disposed) unlisten?.();
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return { fileDragActive };
}
