/**
 * Host-realm entry (trusted tier). Registers a fallback FileType provider whose
 * single mode is {@link OfficeFrame} — a tiny iframe wrapper.
 *
 * The heavy renderers do NOT run here: {@link OfficeFrame} reads the file bytes
 * via the host capability `api.vault.readBinary` and hands them to the
 * extension's OWN `folyn-plugin://` iframe (`preview.html`), where the
 * @file-viewer renderers run with full Web Worker / WASM / code-splitting
 * support (their assets resolve against the plugin origin — impossible from a
 * blob-URL host module).
 */
import type { PluginModule, FileTypeProvider, ExtensionApi, ExtensionContext } from 'folyn-plugin-sdk';
import { OfficeFrame } from './OfficeFrame';
import { setApi, setExtensionId } from './api';

/** Fallback provider — extensions/window are declared in the manifest. */
const officeProvider: FileTypeProvider = {
  id: 'office',
  priority: -1000,
  extensions: [],
  needsFileContent: false,
  defaultMode: 'preview',
  modes: [
    { id: 'preview', kind: 'component', component: OfficeFrame },
  ],
};

const pluginModule: PluginModule = {
  handlers: { office: officeProvider },
  activate(api: ExtensionApi, ctx: ExtensionContext) {
    setApi(api);
    setExtensionId(ctx.extensionId);
  },
};

export default pluginModule;
