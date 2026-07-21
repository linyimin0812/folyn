import { useRef, useCallback, useEffect, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useAppearanceStore } from '@/store/appearanceStore';
import type { EditorProps } from '../types';

// ponytail: ExcalidrawImperativeAPI isn't in the package's public type exports
// (index.d.ts only re-exports the `Excalidraw` component). Pull it off the
// `excalidrawAPI` prop instead.
type ExcalidrawImperativeAPI = Parameters<
  NonNullable<React.ComponentProps<typeof Excalidraw>['excalidrawAPI']>
>[0];

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

export function ExcalidrawEditor({ content, tabId, onChange }: EditorProps) {
  const theme = useAppearanceStore((s) => s.theme);
  const excalidrawTheme = theme === 'dark' ? 'dark' : 'light';
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initializedRef = useRef(false);
  const [initialData] = useState(() => parseContent(content));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Imperative API + last-loaded content ref so AI apply / file-watcher / rpcBridge
  // changes can flow in via updateScene without remounting (matches DrawioEditor).
  //   1. handleChange — update loadedContentRef before firing onChangeRef, so when
  //      our own write bounces back as a new `content` prop, content === ref and
  //      the effect below is a no-op (no self-triggered re-sync).
  //   2. the content-prop effect — when content changes externally and differs
  //      from the ref, call updateScene with the parsed elements/appState.
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const loadedContentRef = useRef(content);
  const excalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);

  useEffect(() => {
    initializedRef.current = false;
  }, [tabId]);

  useEffect(() => {
    if (content === loadedContentRef.current) return;
    // External content change (AI apply, file watcher, rpcBridge). Cancel pending
    // autosave so the user's stale in-canvas edit doesn't overwrite the AI's
    // change after it lands (matches DrawioEditor). Unsaved edits lost by design.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    loadedContentRef.current = content;
    const { elements, appState } = parseContent(content);
    apiRef.current?.updateScene({ elements, appState });
  }, [content]);

  const handleChange = useCallback((elements: readonly any[], appState: any) => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const json = JSON.stringify({
        type: 'excalidraw',
        version: 2,
        elements: elements.filter((e: any) => !e.isDeleted),
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor || '#ffffff',
        },
      }, null, 2);
      // Track our own outgoing write so the content-prop effect treats the
      // inflight content as already loaded (no re-sync that would drop user edits).
      loadedContentRef.current = json;
      onChangeRef.current(json);
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return (
    <div className="w-full h-full relative [&_.excalidraw]:w-full [&_.excalidraw]:h-full">
      <Excalidraw
        initialData={initialData}
        onChange={handleChange}
        excalidrawAPI={excalidrawAPI}
        theme={excalidrawTheme}
      />
    </div>
  );
}
