import { useEffect, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { readFileByRoute } from '@/services/editorIoService';

interface ExcalidrawPreviewProps {
  filePath: string;
  alt?: string;
}

export function ExcalidrawPreview({ filePath }: ExcalidrawPreviewProps) {
  const [data, setData] = useState<{ elements: any[]; appState: any; files: any } | null>(null);
  const [error, setError] = useState<string>('');
  const theme = useAppearanceStore((s) => s.theme);
  const externalContentVersion = useDiffReviewStore((s) => s.externalContentVersion);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await readFileByRoute(filePath);
        const parsed = JSON.parse(json);
        if (!cancelled) {
          setData({
            elements: parsed.elements || [],
            appState: parsed.appState || {},
            files: parsed.files || undefined,
          });
          setError('');
        }
      } catch {
        if (!cancelled) setError(`Failed to load: ${filePath}`);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath, externalContentVersion]);

  if (error) return <span className="text-[var(--danger,#e53e3e)] text-[13px]">{error}</span>;
  if (!data) return <span className="text-[var(--t3)] text-[13px] italic">Loading diagram...</span>;
  return (
    <div className="w-full h-full relative [&_.excalidraw]:w-full [&_.excalidraw]:h-full">
      <Excalidraw
        initialData={data}
        theme={theme === 'dark' ? 'dark' : 'light'}
        viewModeEnabled
      />
    </div>
  );
}
