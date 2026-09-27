// useOsFileDragDrop — OS file drag-and-drop onto the main window (plus
// forwarded drops from the sandboxed preview iframe). Extracted from App.tsx
// (split-oversized-p1-files).
//
// Returns `fileDragActive` for the full-window drop overlay; the overlay JSX
// stays in App.
//
// Spec: hook-guidelines.md (effect cleanup).

import { useEffect, useState } from 'react';
import * as editorIoService from '@/services/editorIoService';
import { useNavStore } from '@/store/navStore';
import { isTauri } from '@/utils/platform';

export function useOsFileDragDrop() {
  const [fileDragActive, setFileDragActive] = useState(false);

  // ── OS file drag-and-drop onto the window ──
  // When the user drags a file from the OS file manager (Finder / Explorer)
  // onto the window, the webview receives an HTML5 `drop` event. We open each
  // dropped file as a vault-independent external tab via `openDroppedFiles`,
  // which routes by platform: macOS gets the real path from WebKit's private
  // `File.path`; Windows (no path on the File object) stages the content into
  // `~/.folyn/drops/` and opens that staged copy (see editorIoService for why
  // `dragDropEnabled` can't be flipped on). A full-window overlay signals that
  // a file drop is pending so the user knows the window accepts files.
  useEffect(() => {
    if (!isTauri()) return;
    const isFileDrag = (e: DragEvent) => !!e.dataTransfer?.types?.includes('Files');
    // dragenter/dragleave fire per child element AND their order + relatedTarget
    // are not reliable across WKWebView/WebView2 — a depth counter desyncs
    // (leave fires before the matching enter when crossing children), so the
    // overlay flickers off mid-drag or stays stuck on after a cancelled drop.
    // Instead we drive the overlay off the reliable, continuously-firing
    // dragover: each dragover refreshes a short lease; when it expires (drop,
    // drag leaves the window, or the user drags back out) the overlay clears.
    let lease: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (!lease) setFileDragActive(true);
      else clearTimeout(lease);
      // 120ms > the dragover cadence on every platform, so the lease only lapses
      // once dragover actually stops (i.e. the drag has left the window or ended).
      lease = setTimeout(() => {
        lease = null;
        setFileDragActive(false);
      }, 120);
    };
    const disarm = () => {
      if (lease) { clearTimeout(lease); lease = null; }
      setFileDragActive(false);
    };
    const onDragOver = (e: DragEvent) => {
      // Allow a drop (default is to deny). Only signal allow when there are
      // files so we don't interfere with in-app HTML5 DnD (board cards).
      if (!isFileDrag(e)) return;
      e.preventDefault();
      arm();
    };
    // ponytail: single capture-phase drop listener. Capture runs BEFORE any
    // child React handler (CodeMirror/ProseMirror/rich-text onDrop), so a
    // child stopPropagation in bubble can't prevent us from preventDefault
    // AND reading dataTransfer. Per HTML5 spec dataTransfer is available
    // throughout the drop dispatch including capture phase — earlier worry
    // about capture-phase empty files was a misdiagnosis; the real culprit
    // for "only one file opens" was bubble onDrop being stopPropagation'd by
    // a mounted child after the first file's editor mounted.
    const onDrop = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
      disarm();
      if (!isFileDrag(e)) return;
      // Read from both .files and .items — WKWebView populates .files, but
      // fall back to .items (with getAsFile) when .files is empty so a real
      // file drop is never silently dropped.
      const dt = e.dataTransfer;
      const fromFiles = dt?.files ? Array.from(dt.files) : [];
      const fromItems = !dt?.items ? [] : Array.from(dt.items)
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      const arr = fromFiles.length > 0 ? fromFiles : fromItems;
      if (arr.length === 0) return;
      void editorIoService.openDroppedFiles(arr).then((n) => {
        if (n > 0) useNavStore.getState().setCurrentPage('editor');
      });
    };
    // ponytail: capture phase so our preventDefault runs BEFORE any child
    // React handler (CodeMirror/ProseMirror/preview drop handlers) that
    // might stopPropagation — otherwise the window bubble listener never
    // fires and WKWebView navigates to the dropped file.
    // ponytail: the markdown/html preview is a sandboxed <iframe> — a
    // separate document whose dragover/drop don't reach the parent window.
    // The iframe forwards 'folyn:file-drag-active' (arm the overlay) and
    // 'folyn:open-dropped-files' (open the files) via postMessage; handle
    // them here, reusing the same arm/disarm + openDroppedFiles path as
    // window drops. Files (not paths) are forwarded because a cross-origin
    // sandbox iframe can't read WebKit's private File.path.
    const onMsg = (e: MessageEvent) => {
      if (e.source === window) return;
      const data = e.data as { type?: string; files?: File[] } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'folyn:file-drag-active') {
        arm();
      } else if (data.type === 'folyn:open-dropped-files' && Array.isArray(data.files)) {
        // iframe (markdown/html preview) forwarded a drop as File objects —
        // the iframe is a separate document whose dragover/drop don't reach
        // the parent window, and a cross-origin (allow-scripts only) iframe
        // can't read WebKit's private File.path, so it ships the File objects
        // themselves. Route through the same openDroppedFiles path as a
        // window-level drop (macOS .path if present, else staging).
        disarm();
        void editorIoService.openDroppedFiles(data.files).then((n) => {
          if (n > 0) useNavStore.getState().setCurrentPage('editor');
        });
      }
    };
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('message', onMsg);
    return () => {
      if (lease) clearTimeout(lease);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
      window.removeEventListener('message', onMsg);
    };
  }, []);

  return { fileDragActive };
}
