/**
 * Iframe-side DBML ER preview. Receives live `content` from the host wrapper
 * (DbmlFrame) via postMessage, renders it with the ported {@link ErDiagramX6}
 * (@dbml/core parse + @antv/x6 graph), and posts layout-meta write-back
 * (drag positions) back to the host so the editor content round-trips.
 *
 * Runs at the plugin's `folyn-extension://` origin so the dynamic
 * `import('@dbml/core')` + `import('@antv/x6')` bare-specifier imports resolve.
 */
import { useEffect, useState } from 'react';
import ErDiagramX6 from './view/ErDiagramX6';

const READY = 'dbml:ready';
const OPEN = 'dbml:open';
const CHANGE = 'dbml:change';

export function DbmlPreview(): React.JSX.Element {
  const [content, setContent] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    window.parent.postMessage({ type: READY }, '*');
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; content?: string; theme?: 'light' | 'dark' } | null;
      if (!d || d.type !== OPEN) return;
      if (typeof d.content === 'string') setContent(d.content);
      if (d.theme) {
        setTheme(d.theme);
        document.documentElement.dataset.theme = d.theme;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // ErDiagramX6 calls onChange with the (meta-augmented) content; forward to host.
  return (
    <div
      style={{ height: '100%', width: '100%', background: 'var(--bg, #fff)' }}
      data-viewer-theme={theme}
    >
      <ErDiagramX6
        key={theme}
        content={content}
        filePath=""
        vaultRoot=""
        onChange={(next: string) => {
          console.log('[dbml] iframe posting change (len)', next.length);
          window.parent.postMessage({ type: CHANGE, content: next }, '*');
        }}
      />
    </div>
  );
}
