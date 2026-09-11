/**
 * DbmlFrame — host-realm file-type mode for the dbml extension.
 *
 * dbml is a TEXT file-type with split edit/preview + drag-to-write-back layout
 * (unlike office which is read-only binary). So unlike OfficeFrame (which
 * reads bytes once), DbmlFrame forwards the LIVE editor content to the
 * extension's own `folyn-extension://` iframe and receives layout-meta
 * write-back from the iframe (drag positions) → `onChange` → editor.
 *
 * The heavy @dbml/core parser (antlr4, ~16M) + @antv/x6 graph render run
 * inside the iframe (real plugin origin — bare-specifier dynamic import of
 * @dbml/core resolves there). They never enter the host realm.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewProps } from 'folyn-extension-sdk';
import { getExtensionId } from './api';

const READY = 'dbml:ready';
const OPEN = 'dbml:open';
/** iframe → host: the (possibly meta-augmented) content to write back. */
const CHANGE = 'dbml:change';

export function DbmlFrame({ content, onChange }: PreviewProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  // Keep the latest content + onChange in refs so the postMessage effect can
  // fire on every change without re-creating the iframe / losing the handshake.
  const contentRef = useRef(content);
  contentRef.current = content;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const src = useMemo(
    () => `folyn-extension://localhost/${getExtensionId()}/dbml-preview.html`,
    [],
  );

  // Handshake: iframe posts `ready` once its script boots.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; content?: string } | null;
      if (d?.type === READY) setReady(true);
      if (d?.type === CHANGE && typeof d.content === 'string') {
        // iframe re-emitted content with an updated meta block (drag layout).
        onChangeRef.current?.(d.content);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Push live content (+ theme) whenever it changes (and once ready).
  useEffect(() => {
    if (!ready) return;
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    iframeRef.current?.contentWindow?.postMessage(
      { type: OPEN, content: contentRef.current, theme },
      '*',
    );
  }, [ready, content]);

  return (
    <div className="flex-1 h-full w-full overflow-hidden bg-panel">
      <iframe
        ref={iframeRef}
        src={src}
        sandbox="allow-scripts allow-same-origin"
        title="DBML ER diagram"
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  );
}
