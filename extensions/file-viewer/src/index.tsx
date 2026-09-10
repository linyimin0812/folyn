/**
 * File Viewer extension entry (trusted tier).
 *
 * Contributes a fallback FileType provider (priority -1000) that renders
 * office / pdf / archive / dataset / media files via OfficeFileViewer.
 * The manifest declares the extensions + the `office` handler entry-ref.
 */
import type { PluginModule, FileTypeProvider, ExtensionApi } from 'folyn-plugin-sdk';
import { OfficeFileViewer } from './OfficeFileViewer';
import { setApi } from './api';

const officeProvider: FileTypeProvider = {
  id: 'office',
  // Fallback (doc §24): a specialized provider overrides this.
  priority: -1000,
  // Extensions are declared in the manifest; kept in sync here so resolution
  // works even before the manifest merge (defensive).
  extensions: [],
  needsFileContent: false,
  modes: [
    { id: 'preview', kind: 'component', component: OfficeFileViewer },
  ],
};

const pluginModule: PluginModule = {
  handlers: { office: officeProvider },
  activate(api: ExtensionApi) {
    setApi(api);
  },
};

export default pluginModule;
