/**
 * Host-realm entry for the dbml extension (trusted tier).
 *
 * Registers the `dbml` file-type provider. dbml is a TEXT type with three
 * modes — `edit` (host CodeMirror shell-editor), `split` (CodeMirror | ER
 * preview), `preview` (ER diagram only). The ER preview component is
 * {@link DbmlFrame}, which delegates the actual @dbml/core parse + @antv/x6
 * render to the extension's iframe so those heavy deps never enter the host.
 *
 * `priority: 5000` — a specialized provider (installed), overrides the
 * generic file-viewer fallback (-1000).
 */
import type { ReactNode } from 'react';
import type { ExtensionModule, FileTypeProvider, ExtensionApi, ExtensionContext } from 'folyn-extension-sdk';
import { DbmlFrame } from './DbmlFrame';
import { setApi, setExtensionId } from './api';
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

const module: ExtensionModule = {
  handlers: { dbml: provider },
  activate(api: ExtensionApi, ctx: ExtensionContext) {
    setApi(api);
    setExtensionId(ctx.extensionId);
  },
};

export default module;
