/**
 * Host-realm entry (trusted tier). Registers one fallback FileType provider
 * per file family, each carrying its own {@link icon} and the same
 * {@link OfficeFrame} mode.
 *
 * Splitting by family (document / presentation / spreadsheet / pdf / archive
 * / …) keeps a distinct icon per kind — the app's `<FileIcon>` reads a
 * registered handler's `icon` at render time, and a single `office` provider
 * would force one icon for everything. The extensions each family claims are
 * declared in `manifest.json` (`contributes.fileTypes[]`); the host merges
 * them onto these providers at activation.
 *
 * The heavy renderers do NOT run here: {@link OfficeFrame} reads the file
 * bytes via the host capability `api.vault.readBinary` and hands them to the
 * extension's OWN `folyn-plugin://` iframe (`preview.html`), where the
 * @file-viewer renderers run with full Web Worker / WASM / code-splitting
 * support (their assets resolve against the plugin origin — impossible from a
 * blob-URL host module).
 */
import type { ReactNode } from 'react';
import type { PluginModule, FileTypeProvider, ExtensionApi, ExtensionContext } from 'folyn-extension-sdk';
import { OfficeFrame } from './OfficeFrame';
import { setApi, setExtensionId } from './api';
import {
  DocIcon, PresentationIcon, SpreadsheetIcon, PdfIcon, ArchiveIcon, EmailIcon,
  CadIcon, Model3dIcon, EbookIcon, ImageIcon, AudioIcon, VideoIcon, FontIcon,
  DataIcon, GenericFileIcon,
} from './icons';

/** Build a fallback provider: -1000 priority, one OfficeFrame preview mode. */
function provider(id: string, icon: ReactNode): FileTypeProvider {
  return {
    id,
    priority: -1000,
    extensions: [], // filled from the manifest at activation
    needsFileContent: false,
    defaultMode: 'preview',
    icon,
    modes: [{ id: 'preview', kind: 'component', component: OfficeFrame }],
  };
}

/** Family id → provider. The manifest's `contributes.fileTypes[]` entries
 * reference these ids via their `handler` field and supply the extensions. */
const handlers: PluginModule['handlers'] = {
  'office-document': provider('office-document', <DocIcon />),
  'office-presentation': provider('office-presentation', <PresentationIcon />),
  'office-spreadsheet': provider('office-spreadsheet', <SpreadsheetIcon />),
  'office-pdf': provider('office-pdf', <PdfIcon />),
  'office-archive': provider('office-archive', <ArchiveIcon />),
  'office-email': provider('office-email', <EmailIcon />),
  'office-cad': provider('office-cad', <CadIcon />),
  'office-3d': provider('office-3d', <Model3dIcon />),
  'office-ebook': provider('office-ebook', <EbookIcon />),
  'office-image': provider('office-image', <ImageIcon />),
  'office-audio': provider('office-audio', <AudioIcon />),
  'office-video': provider('office-video', <VideoIcon />),
  'office-font': provider('office-font', <FontIcon />),
  'office-data': provider('office-data', <DataIcon />),
  'office-misc': provider('office-misc', <GenericFileIcon />),
};

const pluginModule: PluginModule = {
  handlers,
  activate(api: ExtensionApi, ctx: ExtensionContext) {
    setApi(api);
    setExtensionId(ctx.extensionId);
  },
};

export default pluginModule;
