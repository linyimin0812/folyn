/**
 * Iframe-side DBML ER preview. Receives live `content` from the host wrapper
 * (DbmlFrame) via postMessage, renders it with the ported {@link ErDiagramX6}
 * (@dbml/core parse + @antv/x6 graph), and posts layout-meta write-back
 * (drag positions) back to the host so the editor content round-trips.
 *
 * Also answers host-posted 'dbml:export-svg' requests by calling
 * graph.toSVGAsync() and posting the resulting SVG string back. The host
 * extension module (extensions/dbml/src/index.tsx) uses this to implement
 * the `contributes.exporters` SVG format without bringing @dbml/core + x6
 * back into the app bundle.
 *
 * Runs at the plugin's `folyn-extension://` origin so the dynamic
 * `import('@dbml/core')` + `import('@antv/x6')` bare-specifier imports resolve.
 */
import { useEffect, useRef, useState } from 'react';
import type { Graph } from '@antv/x6';
import ErDiagramX6 from './view/ErDiagramX6';

const READY = 'dbml:ready';
const OPEN = 'dbml:open';
const CHANGE = 'dbml:change';
const RENDERED = 'dbml:rendered';
const RENDER_ERROR = 'dbml:render-error';
const EXPORT_SVG = 'dbml:export-svg';
const EXPORT_SVG_RESULT = 'dbml:export-svg-result';
const EXPORT_PNG = 'dbml:export-png';
const EXPORT_PNG_RESULT = 'dbml:export-png-result';

export function DbmlPreview(): React.JSX.Element {
  const [content, setContent] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  // Stashed by onGraphReady so the export-svg message handler can call
  // graph.toSVGAsync() without re-walking the DOM.
  const graphRef = useRef<Graph | null>(null);

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

  // ponytail: separate listener for export-{svg,png} requests so the OPEN
  // handler above stays a pure content-sync effect. Responds with the SVG
  // string from x6's toSVGAsync (content-bbox viewBox, not viewport), or the
  // PNG data URL from toPNGAsync — both use the same Export plugin registered
  // in ErDiagramX6's mount effect.
  useEffect(() => {
    const onMessage = async (ev: MessageEvent) => {
      const type = ev.data?.type;
      const g = graphRef.current;
      if (!g) {
        const resultType =
          type === EXPORT_SVG ? EXPORT_SVG_RESULT
          : type === EXPORT_PNG ? EXPORT_PNG_RESULT
          : null;
        if (resultType) {
          window.parent.postMessage({ type: resultType, error: 'graph not ready' }, '*');
        }
        return;
      }
      if (type !== EXPORT_SVG && type !== EXPORT_PNG) return;
      try {
        const data = type === EXPORT_SVG
          ? await g.toSVGAsync()
          : await g.toPNGAsync();
        window.parent.postMessage(
          { type: type === EXPORT_SVG ? EXPORT_SVG_RESULT : EXPORT_PNG_RESULT, data },
          '*',
        );
      } catch (e) {
        window.parent.postMessage(
          {
            type: type === EXPORT_SVG ? EXPORT_SVG_RESULT : EXPORT_PNG_RESULT,
            error: e instanceof Error ? e.message : String(e),
          },
          '*',
        );
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
        onGraphReady={(g) => { graphRef.current = g; }}
        onRendered={() => window.parent.postMessage({ type: RENDERED }, '*')}
        onParseError={(errors) =>
          window.parent.postMessage(
            { type: RENDER_ERROR, error: errors[0]?.message ?? 'parse error' },
            '*',
          )
        }
        onChange={(next: string) => {
          console.log('[dbml] iframe posting change (len)', next.length);
          window.parent.postMessage({ type: CHANGE, content: next }, '*');
        }}
      />
    </div>
  );
}
