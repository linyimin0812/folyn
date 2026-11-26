// useOsFilePasteImport — OS file paste (Finder Cmd+C → Folyn Cmd+V): clipboard
// file refs captured on window focus, then handed to the shared import flow.
// Extracted from App.tsx (split-oversized-p1-files).
//
// The import flow itself (folder picker, conflict resolution, vault copy,
// toasts) lives in importFlowStore — this hook is only the paste *trigger*.
// Spec: hook-guidelines.md (effect cleanup).

import { useEffect, useRef } from 'react';
import { readClipboardFiles } from '@/services/clipboardFiles';
import { useImportFlowStore } from '@/store/importFlowStore';
import { isTauri } from '@/utils/platform';

export function useOsFilePasteImport() {
  // ── OS file paste (Finder Cmd+C → Folyn Cmd+V) ──
  // When the user copies a file in Finder/Explorer and pastes in Folyn, run
  // the shared import flow on each clipboard file.
  //
  // File refs on the clipboard can't be read synchronously via
  // `navigator.clipboard` (WKWebView/WebView2 only expose text/plain +
  // image/png), so the Rust `read_clipboard_files` command (arboard) does the
  // read. To avoid racing that async read against the paste event's narrow
  // synchronous preventDefault window, we refresh a cached file list on
  // window focus — the user must focus Folyn before pasting, which updates
  // the cache just-in-time.
  //
  // ponytail: "File wins" — when the cache is non-empty we preventDefault +
  // stopPropagation in capture so CodeMirror/ProseMirror bubble-phase paste
  // handlers never fire (they'd insert the filename as text). When the cache
  // is empty we no-op and the default text paste runs unchanged.
  // Split-screen edge case: copy a file in Finder while Folyn stays focused
  // (no focus event fires) → cache is stale → text paste runs instead of the
  // picker. Acceptable for MVP; a polling fallback can cover it if it bites.
  const clipboardFilesCache = useRef<string[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    const refresh = () => {
      void readClipboardFiles().then((p) => {
        clipboardFilesCache.current = p;
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const onPaste = (e: ClipboardEvent) => {
      const paths = clipboardFilesCache.current;
      if (paths.length === 0) return; // no file ref → default text paste
      e.preventDefault();
      e.stopImmediatePropagation();
      void useImportFlowStore.getState().startImport(paths).finally(() => {
        // ponytail: refresh async after this paste so a 2nd paste-without-
        // refocus (different file copied in place) sees the new clipboard.
        setTimeout(refresh, 0);
      });
    };
    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('paste', onPaste, true);
    };
  }, []);
}
