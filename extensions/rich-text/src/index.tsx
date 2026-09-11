/**
 * Host-realm entry for the rich-text extension (trusted tier). Phase 2 stub:
 * the module exports a `rich-text` handler with StubEditor as a placeholder
 * edit-mode component. Phase 3 swaps StubEditor for RichTextEditor.
 *
 * ponytail: Phase 2 manifest omits `contributes.fileTypes` — the handler is
 * NOT registered (registerExtensionFileTypes early-returns on empty
 * contributes.fileTypes). Reason: OwnedRegistry.register overwrites by id,
 * so an extension handler with id `rich-text` would clobber the builtin
 * handler that activates later at boot. Deferring handler registration to
 * Phase 3 (where we also delete builtin) keeps builtin authoritative for
 * editing — no Phase 2 regression. The `handlers` map is dead code until
 * Phase 3 adds `contributes.fileTypes` to the manifest.
 */
import type { ExtensionModule, FileTypeProvider, ExtensionApi, ExtensionContext } from 'folyn-extension-sdk';
import { setApi, setExtensionId } from './api';

function StubEditor() {
  return <div className="p-4 text-t2">rich-text extension loaded (stub)</div>;
}

const provider: FileTypeProvider = {
  id: 'rich-text',
  extensions: ['richtext'],
  needsFileContent: true,
  defaultMode: 'edit',
  modes: [{ id: 'edit', kind: 'component', component: StubEditor }],
};

const module: ExtensionModule = {
  handlers: { 'rich-text': provider },
  activate(api: ExtensionApi, ctx: ExtensionContext) {
    setApi(api);
    setExtensionId(ctx.extensionId);
  },
};

export default module;
