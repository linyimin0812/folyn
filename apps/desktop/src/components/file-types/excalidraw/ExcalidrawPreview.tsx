import { useEffect, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useVaultStore } from '@/store/vaultStore';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import { useAppearanceStore } from '@/store/appearanceStore';

interface ExcalidrawPreviewProps {
  filePath: string;
  alt?: string;
}

// ponytail: render the real Excalidraw canvas in view-only mode instead of an
// exported SVG. Costs one full editor instance per embed (heavier than SVG),
// but gives native pan/zoom/scroll. If a markdown page embeds many diagrams
// and perf bites, fall back to SVG export for inline <img> and keep this for
// the file-preview directive — the split is already in MarkdownPreview.tsx.
export function ExcalidrawPreview({ filePath }: ExcalidrawPreviewProps) {
  const [data, setData] = useState<{ elements: any[]; appState: any; files: any } | null>(null);
  const [error, setError] = useState<string>('');
  const theme = useAppearanceStore((s) => s.theme);
  const externalContentVersion = useDiffReviewStore((s) => s.externalContentVersion);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await useVaultStore.getState().readFile(filePath);
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
    <div
      className="my-2 relative [&_.excalidraw]:w-full [&_.excalidraw]:h-full"
      style={{ height: 420 }}
    >
      <Excalidraw
        initialData={data}
        theme={theme === 'dark' ? 'dark' : 'light'}
        viewModeEnabled
      />
    </div>
  );
}
