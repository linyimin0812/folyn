/**
 * Host-realm entry for the dbml extension (trusted tier).
 *
 * Registers the `dbml` file-type provider. dbml is a TEXT type with three
 * modes — `edit` (host CodeMirror shell-editor), `split` (CodeMirror | ER
 * preview), `preview` (ER diagram only). The ER preview component is
 * {@link DbmlFrame}, which delegates the actual @dbml/core parse + @antv/x6
 * render to the extension's iframe so those heavy deps never enter the host.
 *
 * Also contributes the `dbml-svg` + `dbml-png` exporters (manifest
 * `contributes.exporters`). Each handler spawns a hidden iframe at this
 * extension's own origin (`ctx.resolveAssetUrl('dbml-preview.html')` —
 * `folyn-extension://localhost/<id>/dbml-preview.html` on macOS/Linux,
 * `http://folyn-extension.localhost/<id>/dbml-preview.html` on Windows), posts the .dbml
 * content, waits for the iframe's x6 graph to render, then asks it to
 * serialize the graph (toSVGAsync / toPNGAsync). The @dbml/core + @antv/x6
 * runtime stays in the iframe bundle — never imported by the host module.
 * Same architecture as the rich-text exporter, except the heavy lifting
 * lives in the iframe rather than inline in the host module.
 *
 * `priority: 5000` — a specialized provider (installed), overrides the
 * generic file-viewer fallback (-1000).
 */
import type { ReactNode } from 'react';
import type {
  ExtensionModule,
  FileTypeProvider,
  ExtensionApi,
  ExtensionContext,
  ExporterHandler,
} from 'folyn-extension-sdk';
import { DbmlFrame } from './DbmlFrame';
import { setApi, setExtensionId, getExtensionId, setResolveAssetUrl, resolveExtensionAssetUrl } from './api';
import { DbmlIcon } from './icons';

const provider: FileTypeProvider = {
  id: 'dbml',
  priority: 5000,
  extensions: ['dbml'],
  icon: <DbmlIcon />,
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: DbmlFrame },
  ],
};

const READY = 'dbml:ready';
const OPEN = 'dbml:open';
const RENDERED = 'dbml:rendered';
const RENDER_ERROR = 'dbml:render-error';
const EXPORT_SVG = 'dbml:export-svg';
const EXPORT_SVG_RESULT = 'dbml:export-svg-result';
const EXPORT_PNG = 'dbml:export-png';
const EXPORT_PNG_RESULT = 'dbml:export-png-result';

/**
 * Render the .dbml `content` via the extension's preview iframe and ask x6
 * to serialize the graph. The iframe is the only place @dbml/core +
 * @antv/x6 are loaded, so the host never imports them — preserving the
 * bundle-size win from moving dbml into a standalone extension.
 *
 * Lifecycle: ready (iframe booted) → open (host posts content) → rendered
 * (graph committed) → export-{svg|png} (host asks for serialized output) →
 * export-{svg|png}-result (iframe ships back the SVG string or PNG data URL).
 * Any error or 30s timeout rejects and the iframe is torn down in finally.
 *
 * Returns: for 'svg' a standalone SVG string; for 'png' a `data:image/png`
 * data URL (caller decodes to bytes via {@link pngDataUrlToBlob}).
 */
async function renderDbmlViaIframe(
  content: string,
  format: 'svg' | 'png',
): Promise<string> {
  const extensionId = getExtensionId();
  if (!extensionId) throw new Error('dbml export: extension not activated');

  const iframe = document.createElement('iframe');
  iframe.src = resolveExtensionAssetUrl('dbml-preview.html');
  iframe.style.cssText =
    'position:absolute;left:-9999px;top:0;width:1024px;height:768px;border:none;visibility:hidden;';
  document.body.appendChild(iframe);

  const reqType = format === 'svg' ? EXPORT_SVG : EXPORT_PNG;
  const resType = format === 'svg' ? EXPORT_SVG_RESULT : EXPORT_PNG_RESULT;

  // ponytail: closure assigned synchronously inside the Promise executor,
  // so `cleanup` is set before any await resolves and the finally block
  // always sees it.
  let cleanup = () => {};
  try {
    return await new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('dbml export: timed out (30s)')),
        30000,
      );
      let opened = false;
      let requested = false;

      const onMessage = (ev: MessageEvent) => {
        if (ev.source !== iframe.contentWindow) return;
        const d = ev.data as { type?: string; data?: string; error?: string };
        switch (d.type) {
          case READY:
            iframe.contentWindow?.postMessage(
              { type: OPEN, content, theme: 'light' },
              '*',
            );
            opened = true;
            break;
          case RENDERED:
            // ponytail: the iframe re-renders on every state change; only
            // request output after the first render following OPEN so a
            // subsequent re-parse (e.g. debounce fire) doesn't fire a
            // second request before the first one's response lands.
            if (opened && !requested) {
              requested = true;
              iframe.contentWindow?.postMessage({ type: reqType }, '*');
            }
            break;
          case RENDER_ERROR:
            window.clearTimeout(timeout);
            reject(new Error(d.error || 'dbml export: parse error'));
            break;
          case resType:
            window.clearTimeout(timeout);
            if (d.data) resolve(d.data);
            else reject(new Error(d.error || 'dbml export: no output returned'));
            break;
        }
      };
      window.addEventListener('message', onMessage);
      cleanup = () => {
        window.clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
      };
    });
  } finally {
    cleanup();
    iframe.remove();
  }
}

/** Decode a `data:image/png;base64,...` data URL to a PNG Blob. */
function pngDataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

const dbmlSvgExporter: ExporterHandler = async (content) => {
  const svg = await renderDbmlViaIframe(content, 'svg');
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
};

const dbmlPngExporter: ExporterHandler = async (content) => {
  const dataUrl = await renderDbmlViaIframe(content, 'png');
  return pngDataUrlToBlob(dataUrl);
};

const module: ExtensionModule = {
  handlers: { dbml: provider },
  exporters: { dbmlSvg: dbmlSvgExporter, dbmlPng: dbmlPngExporter },
  activate(api: ExtensionApi, ctx: ExtensionContext) {
    setApi(api);
    setExtensionId(ctx.extensionId);
    setResolveAssetUrl(ctx.resolveAssetUrl);
  },
};

export default module;
