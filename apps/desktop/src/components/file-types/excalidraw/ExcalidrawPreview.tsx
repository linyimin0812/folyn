import { useEffect, useState } from 'react';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { exportToSvg } from '@excalidraw/excalidraw';

interface ExcalidrawPreviewProps {
  filePath: string;
  alt?: string;
}

export function ExcalidrawPreview({ filePath, alt }: ExcalidrawPreviewProps) {
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [error, setError] = useState<string>('');
  const externalContentVersion = useEditorStore((s) => s.externalContentVersion);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await useVaultStore.getState().readFile(filePath);
        const data = JSON.parse(json);
        const svg = await exportToSvg({
          elements: data.elements || [],
          appState: { ...data.appState, exportWithDarkMode: false },
          files: data.files || null,
        });
        if (!cancelled) setSvgHtml(svg.outerHTML);
      } catch (err) {
        if (!cancelled) setError(`Failed to load: ${filePath}`);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath, externalContentVersion]);

  if (error) return <span className="text-[var(--danger,#e53e3e)] text-[13px]">{error}</span>;
  if (!svgHtml) return <span className="text-[var(--t3)] text-[13px] italic">Loading diagram...</span>;
  return (
    <div
      className="max-w-full overflow-hidden my-2 [&_svg]:max-w-full [&_svg]:h-auto"
      title={alt || filePath}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
}
