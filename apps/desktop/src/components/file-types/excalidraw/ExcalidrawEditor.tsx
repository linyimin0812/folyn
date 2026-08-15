import { useRef, useCallback, useEffect, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useAppearanceStore } from '@/store/appearanceStore';
import {
  installAnchorDownloadInterceptor,
  installClipboardImageWritePatch,
} from '@/services/tauriBrowserShim';
import { saveFile } from '@/services/editorIoService';
import type { EditorProps } from '../types';

function parseContent(content: string) {
  try {
    const data = JSON.parse(content);
    return {
      elements: data.elements || [],
      appState: data.appState || {},
      files: data.files || undefined,
    };
  } catch {
    return { elements: [], appState: {}, files: undefined };
  }
}

function serializeScene(elements: readonly any[], appState: any): string {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    elements: elements.filter((e: any) => !e.isDeleted),
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor || '#ffffff',
    },
  }, null, 2);
}

export function ExcalidrawEditor({ content, tabId, onChange }: EditorProps) {
  const theme = useAppearanceStore((s) => s.theme);
  const excalidrawTheme = theme === 'dark' ? 'dark' : 'light';
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initializedRef = useRef(false);
  const [initialData] = useState(() => parseContent(content));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest scene change not yet written to the store (pending the debounce).
  const pendingRef = useRef<{ elements: readonly any[]; appState: any } | null>(null);

  useEffect(() => {
    initializedRef.current = false;
  }, [tabId]);

  // Write the pending scene change to the store immediately, cancelling the
  // debounce. Used on Ctrl/Cmd+S (before saving) and on unmount so a trailing
  // change isn't dropped on tab switch/close.
  const flushPending = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    onChangeRef.current(serializeScene(pending.elements, pending.appState));
  }, []);

  const handleChange = useCallback((elements: readonly any[], appState: any) => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    pendingRef.current = { elements, appState };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      flushPending();
    }, 1000);
  }, [flushPending]);

  // Ctrl/Cmd+S must save THIS file's content to the vault, not trigger
  // Excalidraw's built-in "save to disk" (which the anchor-download shim turns
  // into a native save-as dialog). We intercept in the window capture phase —
  // before Excalidraw's own keydown handler or the app-wide Ctrl+S handler —
  // stop the event, flush the debounced scene into the store, then write the
  // file directly. `saveToActiveFile: false` below is a belt-and-suspenders:
  // it also removes Excalidraw's toolbar "Save" button (same save-as behavior).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        flushPending();
        void saveFile(tabId);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [flushPending, tabId]);

  // Flush the trailing debounced change on unmount (tab switch/close).
  useEffect(() => {
    return () => {
      flushPending();
    };
  }, [flushPending]);

  useEffect(() => {
    const cleanups = [
      installAnchorDownloadInterceptor(),
      installClipboardImageWritePatch(),
    ];
    return () => cleanups.forEach((c) => c());
  }, []);

  return (
    <div className="w-full h-full relative [&_.excalidraw]:w-full [&_.excalidraw]:h-full">
      <Excalidraw
        initialData={initialData}
        onChange={handleChange}
        theme={excalidrawTheme}
        UIOptions={{ canvasActions: { saveToActiveFile: false } }}
      />
    </div>
  );
}
