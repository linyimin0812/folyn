/**
 * OfficeFrame — host-realm file-type mode. Renders the extension's OWN
 * `folyn-plugin://` iframe (`preview.html`) and hands it the file bytes.
 *
 * Why an iframe: the @file-viewer renderers need Web Workers + WASM, which
 * cannot load from a blob-URL host module. Inside the plugin-origin iframe
 * those assets resolve relatively, so every renderer (pptx / xlsx / pdf / cad
 * / …) works. The heavy code never runs in the host realm.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewProps } from 'folyn-extension-sdk';
import { getApi, getExtensionId } from './api';

const MESSAGE_TYPE = 'folyn-file-viewer:open';

export function OfficeFrame({ filePath }: PreviewProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);

  const src = useMemo(
    () => `folyn-plugin://localhost/${getExtensionId()}/preview.html`,
    [],
  );

  // Load the file bytes through the host capability (vault-scoped).
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setBytes(null);
    (async () => {
      try {
        const data = await getApi().vault.readBinary(filePath);
        if (cancelled) return;
        setBytes(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [filePath]);

  // The iframe posts `ready` once its script runs; we then push the bytes.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: string } | null;
      if (d?.type === 'folyn-file-viewer:ready') setReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Push bytes + name + theme whenever they change (and once ready).
  useEffect(() => {
    if (!ready || !bytes) return;
    const name = filePath.split('/').pop() || 'file';
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    iframeRef.current?.contentWindow?.postMessage(
      { type: MESSAGE_TYPE, name, bytes, theme },
      '*',
    );
  }, [ready, bytes, filePath]);

  if (error) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-[13px] text-red-500 px-6 text-center">
        无法加载文件：{error}
      </div>
    );
  }

  return (
    <div className="flex-1 h-full w-full overflow-hidden bg-panel">
      <iframe
        ref={iframeRef}
        src={src}
        sandbox="allow-scripts allow-same-origin"
        title="File Viewer"
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  );
}
