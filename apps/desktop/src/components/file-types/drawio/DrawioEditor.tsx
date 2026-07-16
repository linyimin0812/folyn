import { useRef, useCallback, useEffect, useState } from 'react';
import { DrawIoEmbed } from 'react-drawio';
import { useAppearanceStore } from '@/store/appearanceStore';
import type { EditorProps } from '../types';

// ponytail: online embed via https://embed.diagrams.net — requires internet at edit time.
// Ceiling: CDN downtime breaks the editor (file XML persists on disk, no data loss).
// Upgrade path: bundle drawio-desktop web assets (~30MB) into public/drawio/ and pass
// `baseUrl="/drawio/index.html"` to DrawIoEmbed. Defer until offline use is a real requirement.

export function DrawioEditor({ content, onChange }: EditorProps) {
  const theme = useAppearanceStore((s) => s.theme);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // loadedXml is the xml prop handed to DrawIoEmbed. The ref tracks the same
  // value without triggering re-renders. Two update sites:
  //   1. handleAutoSave — update the ref only (NOT setLoadedXml), so when our
  //      own onChange flows back as a new `content` prop via updateTabContent,
  //      content === loadedXmlRef.current and the effect below is a no-op —
  //      no iframe reload on user edits.
  //   2. the content-prop effect — when content changes externally (AI
  //      applyAcceptChange, file watcher, rpcBridge vault:insert-content) and
  //      differs from what we last loaded, setLoadedXml triggers DrawIoEmbed's
  //      internal useEffect (dep on xml) to reload the iframe.
  const [loadedXml, setLoadedXml] = useState(content);
  const loadedXmlRef = useRef(content);

  useEffect(() => {
    if (content !== loadedXmlRef.current) {
      // External content change (AI apply, file watcher, rpcBridge). The iframe
      // is about to reload with the new xml — cancel any pending autosave
      // timer first, otherwise it would fire onChangeRef with the user's stale
      // in-iframe edit AFTER the AI's content landed, overwriting the AI's
      // change on disk. The user's unsaved in-iframe edits are lost by design
      // (ponytail: no accept/reject UI for custom editors; undo in-editor).
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      loadedXmlRef.current = content;
      setLoadedXml(content);
    }
  }, [content]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleAutoSave = useCallback((data: { xml?: string }) => {
    if (!data?.xml) return;
    loadedXmlRef.current = data.xml;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onChangeRef.current(data.xml!);
    }, 1000);
  }, []);

  return (
    <div className="w-full h-full">
      <DrawIoEmbed
        autosave
        xml={loadedXml}
        urlParameters={{ dark: theme === 'dark' }}
        onAutoSave={handleAutoSave}
      />
    </div>
  );
}
