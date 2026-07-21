import { useRef, useCallback, useEffect, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useAppearanceStore } from '@/store/appearanceStore';
import {
  installAnchorDownloadInterceptor,
  installClipboardImageWritePatch,
} from '@/services/tauriBrowserShim';
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

export function ExcalidrawEditor({ content, tabId, onChange }: EditorProps) {
  const theme = useAppearanceStore((s) => s.theme);
  const excalidrawTheme = theme === 'dark' ? 'dark' : 'light';
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initializedRef = useRef(false);
  const [initialData] = useState(() => parseContent(content));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    initializedRef.current = false;
  }, [tabId]);

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
      onChangeRef.current(json);
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

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
      />
    </div>
  );
}
