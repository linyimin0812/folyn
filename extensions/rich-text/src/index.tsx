/**
 * Host-realm entry for the rich-text extension (trusted tier). Phase 3:
 * swaps the Phase 2 StubEditor for the real RichTextEditor (moved from
 * apps/desktop/src/components/file-types/rich-text/) + registers the
 * rich-text → HTML exporter. The manifest declares `contributes.fileTypes`
 * (overwriting the builtin rich-text handler by id) + `contributes.exporters`
 * (rich-text-html). `activate` wires the SDK api + extensionId so the
 * editor + exporter can reach vault/storage/vaultConfig capabilities.
 *
 * ponytail: no iframe bundle — rich-text renders inline in the host React
 * tree (tiptap NodeViews share the host React instance via window.React).
 * No tailwind/postcss in the extension build; the host's tailwind.config.js
 * content array includes `extensions/rich-text/src/**` so the host's single
 * CSS bundle covers the editor's classes. KaTeX CSS is imported in the
 * host's main.tsx so it lands in the same global stylesheet.
 */
import type { ExtensionModule, FileTypeProvider, ExtensionApi, ExtensionContext, ExporterHandler } from 'folyn-extension-sdk';
import { setApi, setExtensionId } from './api';
import { RichTextEditor } from './RichTextEditor';
import { richTextToHtmlBlob } from './exporters/richtextHtml';
import { RichTextIcon } from './icons';

const provider: FileTypeProvider = {
  id: 'rich-text',
  extensions: ['richtext'],
  icon: <RichTextIcon />,
  needsFileContent: true,
  defaultMode: 'edit',
  modes: [{ id: 'edit', kind: 'component', component: RichTextEditor }],
};

// ponytail: the exporter handler signature is (content, ctx) => Blob | string.
// richTextToHtmlBlob(content, name, vaultRoot) returns a Blob; derive `name`
// from ctx.filePath (base name without extension). ctx.vaultRoot threads
// through so the exporter can inline vault-relative image srcs as base64.
const richtextHtmlExporter: ExporterHandler = async (content, ctx) => {
  const name = ctx.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'export';
  return richTextToHtmlBlob(content, name, ctx.vaultRoot);
};

const module: ExtensionModule = {
  handlers: { 'rich-text': provider },
  exporters: { richtextHtml: richtextHtmlExporter },
  activate(api: ExtensionApi, ctx: ExtensionContext) {
    setApi(api);
    setExtensionId(ctx.extensionId);
  },
};

export default module;
