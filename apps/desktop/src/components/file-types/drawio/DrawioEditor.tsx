import { useRef, useCallback, useEffect, useState } from 'react';
import { DrawIoEmbed } from 'react-drawio';
import { useAppearanceStore } from '@/store/appearanceStore';
import type { EditorProps } from '../types';

// ponytail: online embed via https://embed.diagrams.net — requires internet at edit time.
// Ceiling: CDN downtime breaks the editor (file xml persists on disk, no data loss).
// Upgrade path: bundle drawio-desktop web assets (~30MB) into public/drawio/ and pass
// `baseUrl="/drawio/index.html"` to DrawIoEmbed. Defer until offline use is a real requirement.

export function DrawioEditor({ content, onChange }: EditorProps) {
  const theme = useAppearanceStore((s) => s.theme);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);

  // External content changes (AI apply, file watcher) bump externalContentVersion
  // in fileChangeApplier.apply / fileWatcher, which remounts this editor via
  // WorkArea's `key={tabId-externalContentVersion}` — so useState(content)
  // re-runs with the new content. No prop-sync effect needed here.
  // loadedXml is mount-only: updating it on user edits would trigger
  // DrawIoEmbed's internal useEffect(xml) and reload the iframe mid-edit.
  const [loadedXml] = useState(content);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleAutoSave = useCallback((data: { xml?: string }) => {
    if (!data?.xml) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onChangeRef.current(data.xml!);
    }, 1000);
  }, []);

  return (
    <div className="w-full h-full relative">
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          加载中…
        </div>
      )}
      <DrawIoEmbed
        key={theme}
        autosave
        xml={loadedXml}
        urlParameters={{ dark: theme === 'dark', spin: true }}
        onAutoSave={handleAutoSave}
        onLoad={() => setReady(true)}
      />
    </div>
  );
}
