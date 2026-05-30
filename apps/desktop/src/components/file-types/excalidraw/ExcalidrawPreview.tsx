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

  if (error) return <span className="excalidraw-preview-error">{error}</span>;
  if (!svgHtml) return <span className="excalidraw-preview-loading">Loading diagram...</span>;
  return (
    <div
      className="excalidraw-preview"
      title={alt || filePath}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
}
